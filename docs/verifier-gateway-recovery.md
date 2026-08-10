# Verifier and gateway recovery investigation

Date: 2026-08-10  
Branch: `fix/verifier-recovery`  
Production host: Windows node reached over SSH (credentials are intentionally not recorded)

## Optimization contract

- Goal: keep node gateway connectivity and capability verification self-recovering during prolonged gateway/control-plane failures.
- Primary metrics: one verifier interval for the life of the process; at most one immediate enrollment refresh per stalled reconnect episode; bounded gateway handshake attempts during a sustained failure.
- Workload: repeated verifier passes including a failed control-plane pass and recovery; node WebSocket handshakes receiving persistent HTTP 429 responses.
- Baseline: verifier timers grew from 1 to 2 after one tick; gateway failure probe produced 4 enrollment refresh callbacks and 7 handshakes in about 8 seconds.
- Target: timer count remains 1; enrollment refresh callbacks remain 1; reconnects return to exponential backoff; existing renewal and reconnect smoke behavior remains correct.
- Guardrails: no protocol, credential, heartbeat, capability, RPC, database, vault, or CORS changes; one live server runtime and one live verifier runtime; localhost status remains HTTP 200.
- Beta boundary: installed Windows applications on the production-shaped SSH host while the real gateway was returning Cloudflare Error 1027.
- Escalation gate: changing Cloudflare plan/billing or replacing the gateway architecture requires owner approval.

## System and failure map

```text
Verifier main pass
  -> control-plane candidate query
  -> ticket per capability
  -> client WebSocket upgrade to gateway
  -> encrypted RPC to node
  -> verification update

Node ManagedGatewayLink
  -> node WebSocket upgrade to gateway
  -> failure schedules exponential reconnect
  -> fourth consecutive failure asks enrollment watchdog to refresh once
  -> periodic enrollment watchdog remains available every 30 seconds
```

Two loops broke the bounded-recovery invariant:

1. `apps/verifier/src/index.ts` registered a new `setInterval` at the end of every invocation of `main()`. Fast passes could multiply permanent timers.
2. `apps/server/src/gateway-link.ts` invoked `onReconnectStalled` for every attempt at or above four. The callback refreshed enrollment and called `reconnectNow()`, cancelling the scheduled backoff and immediately repeating the failed gateway handshake.

The control plane continued to answer requests. The gateway returned HTTP 429 with Cloudflare Error 1027 before Worker application code executed.

## Baseline evidence

### Local probes

```text
npm run probe:scheduler -w @spilledcinema/verifier
FAIL: timersAfterStartup=1, timersAfterOneTick=2

npm run probe:gateway-backoff -w @spilledcinema/server
FAIL: requests=7, refreshes=4
```

### Cloudflare and host evidence

- Cloudflare Analytics API, 2026-08-10 UTC: 40,866 accepted `spilled-node-gateway` requests with status `clientDisconnected`, generally 40-70 new connections per minute, before quota cutoff.
- Public gateway request: HTTP 429, Error 1027.
- Control-plane protected endpoint: HTTP 401, proving the control-plane HTTP service itself was responsive.
- Installed versions before repair: Spilled Server `0.2.0-beta.24`, Spilled Verifier `1.1.3`.
- Logs before repair: server 1,204,413,273 bytes; verifier 204,109,739 bytes.
- Server tail repeatedly showed `reconnect stalled -> enrollment accepted -> connecting -> 429 -> close` with no sustained backoff.

## Research ledger

| Source | Verified | Mechanism | Fit | Caveat / local test |
|---|---|---|---|---|
| [Cloudflare Workers limits](https://developers.cloudflare.com/workers/platform/limits/) | 2026-08-10 | Free accounts share 100,000 requests/day; Error 1027 after exhaustion; reset at 00:00 UTC | Direct | Account quota cannot be restored by an application deploy; validate after reset |
| [Cloudflare Workers pricing](https://developers.cloudflare.com/workers/platform/pricing/) | 2026-08-10 | A WebSocket upgrade counts as one Worker request; messages do not | Direct | Reconnect frequency, not RPC frame volume, was the quota driver |
| [Node.js timers](https://nodejs.org/api/timers.html) | 2026-08-10 | Every `setInterval` call creates another repeated callback | Direct | Instrument the compiled verifier entry point and count registrations |
| [Convex indexes](https://docs.convex.dev/database/reading-data/indexes/) | 2026-08-10 | Index ordering is stable and `_creationTime` is an implicit tie-breaker | Partial | Candidate fairness was reviewed but was not needed for this incident |
| [Cloudflare Durable Object alarms](https://developers.cloudflare.com/durable-objects/api/alarms/) | 2026-08-10 | Alarm failures retry with bounded exponential backoff; recurring work should explicitly reschedule | Partial | Existing heartbeat alarm was not the observed reconnect source |

## Decision matrix

| Candidate | Evidence | Cost | Risk | Reversible | Decision |
|---|---|---:|---:|---|---|
| Register the verifier interval once, outside `main()` | Probe reproduced 1 -> 2 timers | Low | Low | Yes | Implemented |
| Fire stalled-enrollment refresh only when attempt count reaches four | Live logs and probe reproduced immediate loop | Low | Low | Yes | Implemented |
| Change heartbeat/lease timing | No evidence heartbeat caused 1027 | Medium | High | Yes | Rejected |
| Change control-plane candidate schema/index | Possible future fairness improvement, not incident cause | Medium | Medium | Yes | Deferred |
| Upgrade Cloudflare plan | Removes daily cap but does not repair runaway clients | Billing change | Medium | Yes | Requires owner approval; not used |

## Experiment and beta results

```text
npm run probe:gateway-backoff -w @spilledcinema/server
PASS: requests=5, enrollmentRefreshes=1, observationMs=13000

npm run build -w @spilledcinema/verifier
npm run probe:scheduler -w @spilledcinema/verifier
PASS: startup, failed-pass, recovery-pass; timersAfterRecovery=1

node scripts/smoke-gateway-renewal.mjs
PASS: applications=4, connections=2

git diff --check
PASS
```

Windows installers were built and installed:

- Spilled Server `0.2.0-beta.25`
- Spilled Verifier `1.1.4`

Rollback copies of both prior `app.asar` bundles and both new installers are stored on the host under `%LOCALAPPDATA%\Temp\SpilledFix-20260810`.

Live guardrails after installation:

- One server runtime and one verifier runtime.
- `http://127.0.0.1:8787/api/status` returned HTTP 200 with `status: ok`.
- Server log growth was about 2.5 KB over the first few post-install minutes despite persistent gateway 429 responses.
- Verifier log added only its startup marker during the observation window.
- The gateway cannot complete a production connection until the already-exhausted Free-plan allowance resets at 00:00 UTC.

## thinkBETTER iteration 1

Goal: eliminate self-amplifying verifier and node retry loops and restore automatic gateway recovery.  
Baseline: 1 -> 2 verifier timers per completed tick; 4 refresh callbacks / 7 gateway requests in ~8 seconds; production gateway Error 1027.  
Current best: one verifier timer; one stalled refresh; 5 requests over 13 seconds under persistent 429; live local status 200.  
Target: met for bounded scheduling, reconnect behavior, local health, and failure guardrails.  
Primary delta: repeated immediate retries reduced to capped exponential backoff; verifier interval registration remains constant.  
Guardrails: focused build/probes and renewal smoke pass; installed data paths preserved; no protocol/control-plane/gateway deployment changes.  
Evidence: commands and results above.  
Research update: Cloudflare confirms Error 1027 is daily account quota exhaustion and resets at 00:00 UTC.  
Decision: CONTINUE.  
Why: code and production-shaped failure beta pass, but a successful real gateway reconnection can only be observed after the external quota reset.  
Next hypothesis or approval needed: after 00:00 UTC, the existing backoff should connect automatically and the next verifier pass should restore capability status; if the account still approaches 100,000 requests/day without a reconnect storm, inspect other account Workers or approve a Paid-plan decision.
