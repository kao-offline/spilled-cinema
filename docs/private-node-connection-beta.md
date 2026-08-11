# Private node connection beta

## Optimization contract

- Goal: a new browser can connect and authenticate to a private Spilled node without knowing or entering a URL.
- Primary metric: zero required URL fields; at most three user actions from the connect screen to an authenticated profile after entering a valid connection code.
- Workload: hosted dashboard, an online gateway-linked private node, password or passkey login, plus local-node and legacy-URL fallback cases.
- Baseline: `SettingsView` requires `privateNodeInput`/`nodeUrl`; `private-node-client.ts` sends direct HTTP to that origin. Remote users must obtain a tunnel URL before account discovery or login.
- Target: valid code resolves exactly one online node; account discovery and password/passkey login travel through encrypted gateway RPC; local discovery fills the code automatically; unknown/offline codes fail with an actionable state; legacy URL connections remain readable.
- Guardrails: node-local credential verification, opaque non-public locator, capability-scoped signed tickets, encrypted payloads, no account-password storage in Convex, no listing of private nodes, no production deployment, existing public runtime cascade unchanged.
- Beta boundary: deterministic unit/scenario harness plus an isolated local dashboard preview with mocked control-plane/gateway cases; no production data.
- Escalation gate: global hosted accounts, cross-node identity federation, or deployment/migration requires explicit approval.

## System and stack map

```text
Connect screen
  -> normalize code / local auto-discovery
  -> control plane resolves code to one reachable node + transport identity
  -> control plane issues node/capability/action-scoped private ticket
  -> dashboard encrypts RPC to node X25519 key
  -> gateway relays opaque frame
  -> node verifies ticket, decrypts, and verifies password/passkey locally
  -> dashboard stores nodeId + short-lived node session (legacy nodeUrl optional)
```

Measured bottleneck: human routing, not network latency. The current boundary blocks before authentication because `nodeUrl` is mandatory. Existing gateway encryption, reachability heartbeat, private tickets, and node-local auth rule out a new hosted credential system as unnecessary. The display code is derived from the protected gateway enrollment credential, so it cannot be reconstructed from a node ID published for public capabilities.

## Baseline report

- Commit/environment: `f53df16`, Windows PowerShell, isolated worktree.
- Evidence commands: `rg -n "privateNodeInput|nodeUrl" apps/dashboard/src/components/SettingsView.tsx apps/dashboard/src/lib/private-node-client.ts`; architecture trace through `convex/http.ts`, `apps/dashboard/src/lib/v2-gateway-client.ts`, `apps/server/src/v2-rpc.ts`, and `apps/node/src/runtime.ts`.
- Baseline result: one required manual URL before status/account/login; remote auth calls bypass the already-running encrypted gateway and depend on a public tunnel origin.
- Known variance: none for the static interaction count; live gateway latency will be observed separately and is not the primary target.

## Research ledger

| Source | Date verified | Mechanism | Fit | Caveat / local test |
|---|---|---|---|---|
| Jellyfin Quick Connect, https://jellyfin.org/docs/general/server/quick-connect/ | 2026-08-11 | Short code removes server/address typing and keeps authorization on an authenticated boundary. | Strong UX fit | Jellyfin uses two-device approval; Spilled still requires node-local password/passkey. Test code normalization, unknown, and offline states. |
| IETF RFC 8628, https://www.rfc-editor.org/info/rfc8628/ | 2026-08-11 | Separate human code from high-entropy device/routing identity; codes are bounded and brute-force protected. | Partial architectural fit | This is not OAuth device authorization. Preserve the locator/auth distinction and never treat the code as a credential. |
| Plex server claiming, https://support.plex.tv/articles/218136308-why-is-there-an-unclaimed-media-server-on-my-network/ | 2026-08-11 | Link a server to a user-facing identity so clients do not manage raw addresses. | Partial fit | A global hosted account would expand trust and migration scope. Validate the smaller locator approach first. |

## Hypotheses and decision matrix

| Candidate | Mechanism | Expected user gain | Cost / risk | Reversible | Decision |
|---|---|---:|---|---|---|
| A. Connection code + gateway auth | Resolve a non-secret identity locator, then authenticate on-node over encrypted RPC | URL fields 1 -> 0; hosted and local share one flow | Small indexed schema addition and RPC surface | Yes | Selected |
| B. Hosted global accounts and node ownership | Convex account owns nodes and issues user claims | Potential one-click login | New identity authority, migrations, recovery and privacy surface | No/expensive | Reject for this pass |
| C. Publicly enumerate private nodes | List reachable nodes then choose one | Removes typing | Leaks private topology and enables account probing | Technically | Reject |
| D. QR/invite deep links only | Encode nodeId/invite in links | Near-zero typing for invited users | Does not solve owner/new-device entry alone | Yes | Additive follow-up in selected design |

First experiment: derive and register a 64-bit opaque display locator from the protected gateway enrollment credential, resolve it only by exact lookup, then route existing node-local auth methods through private gateway tickets. Failed experiment conditions: any login credential leaves the node, locators can be reconstructed or enumerated, public capability behavior changes, or legacy connections stop loading.

## Prioritized scenario matrix

| Scenario | Setup | Oracle |
|---|---|---|
| Valid formatted code | Online registered node | Resolves one nodeId; no URL requested |
| Valid compact/lowercase code | Same node | Normalizes to the same locator |
| Unknown code | No matching registration | `not_found`, no candidate/account data |
| Known offline node | Expired heartbeat | `offline`, no ticket issued |
| Bad password | Reachable node/account | Generic auth error; no session persisted |
| Passkey success/cancel | Reachable node with passkey | Session persisted on success; cancellation remains recoverable |
| Repeated resolve/login | Same fixture | Deterministic and isolated; no leaked state |
| Legacy saved URL | Existing v1 localStorage record | Still loads and can use direct fallback |
| Local server present | localhost probe succeeds | Code/identity prefilled without manual address |

## Experiment log

### Iteration 0 — baseline

- Baseline: one mandatory URL entry and direct HTTP private auth.
- Current best: baseline.
- Target: zero URL knowledge and gateway auth with the guardrails above.
- Decision: CONTINUE.
- Next hypothesis: the existing node identity, private tickets, and gateway RPC can support a locator-only control-plane addition without introducing hosted user accounts.

### Iteration 1 — code-based gateway login

- Change: added a `/connect` flow, exact connection-code resolution, private gateway RPC for status/account/password/passkey operations, and backward-compatible saved connections.
- Result: URL fields 1 -> 0. A valid remote path is code entry -> connect -> sign in; a local node can prefill the code. Desktop beta kept every primary action visible.
- Regression: the first 390 x 844 mobile preview pushed the primary actions below the initial viewport.
- Decision: CONTINUE with a constrained mobile layout.

### Iteration 2 — mobile and trust-boundary hardening

- Change: tightened mobile spacing, moved primary actions into the initial viewport, derived the locator from the protected gateway enrollment credential instead of public identity, and required the exact code again when issuing a private bootstrap ticket.
- Result: the 390 x 844 beta shows code input, connect, local-find, and recoverable error state without scrolling. A public node ID alone cannot issue a private ticket. Password/passkey material is carried only inside the existing end-to-end encrypted node RPC and verified by the node runtime.
- Decision: STOP. The primary interaction target and guardrails pass in the defined beta boundary; production rollout remains a separate authorized operation.

## Beta/final record

- Primary metric: PASS — zero required URL fields in the new flow; three actions after code entry for password login (connect, choose if needed, sign in), with local auto-discovery available.
- Browser beta: PASS at 1280 x 800 and 390 x 844. Unknown/unavailable service errors are actionable and do not reveal control-plane configuration.
- Deterministic harness: PASS, 5/5 normalization/format scenarios. Controlled wrong-oracle self-test was detected without modifying source.
- Focused tests: PASS, 16 assertions across connection contracts, gateway resolution/crypto/RPC mapping, and node auth lifecycle.
- Builds/types: dashboard production build PASS; server TypeScript + bundled build PASS; Convex TypeScript PASS; `git diff --check` PASS.
- Lint: changed dashboard files PASS. Repository-wide dashboard lint remains blocked by four pre-existing errors in `ToastHost.tsx` and `intro-skip.ts`, outside this task.
- Known boundary: the successful remote WebSocket path is covered compositionally (browser/node crypto interoperability, resolver behavior, private RPC dispatch, and node auth lifecycle); it was not exercised against production because no deployment or production-data use was authorized.
- Rollout dependency: deploy the Convex schema/actions, then an updated node/server, then the dashboard. Old saved URL records and the legacy settings fallback remain supported during rollout.
