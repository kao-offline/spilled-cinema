# Resolver performance program

## Optimization contract

Goal: import complete series metadata and external storage-player embeds, then resolve a selected player to validated playback.

- Primary metrics: p50 <= 3 seconds and p95 <= 10 seconds.
- Workload: live providers, direct node and gateway, series through 350 episodes, cold and warm process state.
- Correctness: 100% episode metadata and at least 99% of baseline-successful player/stream results.
- Guardrails: unchanged search/ranking behavior, bounded upstream concurrency, no increased 429/403/5xx rate, no credential leakage, and RSS below 768 MB.
- Beta boundary: disposable/local node plus explicit live canary runs. Production deployment is not part of the experiment.
- Rollback: `SPILLED_RESOLVER_PROFILE=baseline` retains the old import scheduler during beta.

## System map

```text
provider.import
  -> show + season pages
  -> episode pages (old concurrency: 3)
  -> storage source pages (nested concurrency: 4)
  -> external embed URLs
  -> artwork
  -> JSON -> optional encrypted gateway RPC

player.playback.resolve
  -> direct URL reuse or ordered players
  -> provider wrapper traversal
  -> HLS/MP4/DASH validation
  -> playback proxy URL
```

The current 330-episode vault record is about 1.30 MB before encryption, exceeding the gateway's one-megabyte frame budget after encryption/base64 expansion. The current playback resolver starts fallback work but waits for the active attempt before accepting a completed fallback.

## Live harness

The live harness deliberately requires `--live` and stores all successful and failed timings:

```powershell
npm run audit:resolver -w @spilledcinema/dashboard -- --live --mode playback --base-url http://127.0.0.1:8787 --vault C:\path\to\spilled-library --runs 20 --warmup 2 --report test-results/resolver-lab/playback
```

Import example:

```powershell
$env:SPILLED_TEST_SVETSERIALU_USERNAME="..."
$env:SPILLED_TEST_SVETSERIALU_PASSWORD="..."
npm run audit:resolver -w @spilledcinema/dashboard -- --live --mode import --slug murdoch-mysteries --runs 20 --report test-results/resolver-lab/import-large
```

Credentials are read only from environment variables and are never written to reports. The harness does not mutate the selected vault.

## Research ledger

| Source | Mechanism | Fit | Caveat | Local experiment |
|---|---|---|---|---|
| [Node.js fetch documentation](https://nodejs.org/dist/latest/docs/api/globals.html#fetch) | Undici-compatible configurable dispatcher | Direct | A new dispatcher is not automatically faster | First remove application queueing; only then compare pools |
| Node.js/Undici connection dispatch | Persistent connection reuse and bounded dispatch | Direct | Excess parallelism can amplify upstream failures | Sweep bounded concurrency and watch status rates |
| Dean and Barroso, [*The Tail at Scale*](https://research.google/pubs/the-tail-at-scale/) | Delayed hedges and tail-tolerant fan-out | Partial | Blind duplication adds provider load | Hedge only slow idempotent mirror GETs with a strict cap |
| [OpenTelemetry JavaScript guidance](https://opentelemetry.io/docs/languages/js/) | Correlated operation/stage measurements | Direct | A backend is unnecessary for the first experiment | Emit opt-in structured diagnostics first |

## Decision matrix

| Candidate | Expected effect | Risk | Gate |
|---|---:|---:|---|
| Flatten nested import queues | High | Medium | Preserve exact parsed output and provider error rates |
| Run artwork beside player work | Medium | Low | Exact artwork parity |
| Bounded delayed mirror hedge | Tail only | Medium | <=10% extra requests and no rate-limit regression |
| Custom Undici dispatcher | Unknown | Medium | Retain only for >=15% p95 improvement |
| Compress encrypted RPC response | High for large shows | Low | Backward-compatible protocol and frame <900 KiB |

## Experiment log

### Iteration 0

- Baseline command: the `audit:resolver` command above with `SPILLED_RESOLVER_PROFILE=baseline`.
- Current historical evidence: the old 766-episode audit completed in 261,033 ms at concurrency six but did not preserve successful latency values.
- Target: p50 <=3,000 ms, p95 <=10,000 ms, >=99% success.
- Decision: CONTINUE. Capture a new comparable baseline, then test the flattened scheduler as the first reversible hypothesis.

### Iteration 1 — fast beta (2026-08-10)

- Implemented a two-stage, globally bounded import scheduler: 24 episode-page requests followed by 64 source-page requests. Output is reassembled in source order and remains external embed URLs rather than prematurely resolved media URLs.
- Added an 8.5-second import deadline, overlapped artwork work, single-flight provider sessions, playback request coalescing, a 2.5-second preferred-player budget, and a 9.5-second playback deadline.
- Added opt-in gzip for encrypted responses over 64 KiB when it saves at least 10%. The request negotiation hint is deliberately excluded from request AAD so updated browsers remain compatible with older nodes; response encoding remains authenticated.
- Synthetic scale oracle: 350 ordered episodes, 350 external Filemoon embeds, bounded observed concurrency, passed.
- Live playback canary on a disposable local node and a real vault episode: first cold samples were 3,559 ms and 1,561 ms. After one explicit warm-up, five measured resolutions were all successful with p50 62 ms, p95 121 ms, max 121 ms.
- Live import was not executed because `SPILLED_TEST_SVETSERIALU_USERNAME` and `SPILLED_TEST_SVETSERIALU_PASSWORD` were absent. The harness refuses implicit provider access and never persists credentials.
- Search-focused regressions: 28/28 passed. Full dashboard suite: 244/245 passed; the sole failure is an existing making-of ranking assertion in untouched search-ranking code and reproduces in isolation.
- Decision: KEEP the beta implementation. Playback meets the goal in this canary and the large-import structural oracle passes. CONTINUE live import sampling before claiming the 350-episode p95 SLO in production.

## Scenario matrix

| Boundary | Normal | Edge/scale | Failure | Oracle |
|---|---|---|---|---|
| Import | small live series | 330-350 episodes | provider/deadline failure | ordered metadata and external embeds |
| Playback | active player succeeds | every vault provider | expired/malformed/unavailable source | validated media URL and stream type |
| Transport | direct local node | encrypted large gateway response | offline node/ticket failure | same decoded payload and bounded frame |

Live providers are nondeterministic. A run is evidence for the recorded date, environment, and provider state; it is not a permanent availability guarantee.
