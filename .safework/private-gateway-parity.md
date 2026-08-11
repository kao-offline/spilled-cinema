# Private gateway parity

## Contract

- Goal: make private-node gateway requests recover from the same transient cached-route failures as public-server requests, and make local logout immediate.
- Primary metric: a cached gateway failure must be followed by one fresh-ticket attempt instead of surfacing an error immediately.
- Workload: status, account discovery, password login, authenticated playback, profile selection, and logout through the managed gateway.
- Baseline: at `56eec74`, `requestPublicGateway` falls through after a cached failure; `requestPrivateGateway` deletes its cache entry and throws.
- Target: deterministic scenario tests prove public and private requests share the same cached-attempt/fresh-attempt policy; local logout clears synchronously even if remote revocation never resolves.
- Guardrails: connection-code node identity binding, private capability tickets, node-local password checking, session validation, and existing playback behavior remain unchanged.
- Beta boundary: mocked gateway policy tests plus the existing private RPC/playback suite and dashboard production build.
- Escalation gate: no protocol, server, control-plane, or database changes unless client parity cannot be achieved safely.

## Safe-work state

- Repository: `SpilledCinema`
- Worktree: `SpilledCinema-home-private-node`
- Branch: `fix/private-gateway-parity`
- Base/recovery commit: `56eec74`
- Previous production deployment: `dpl_GA3oa4PJcu48UVTBjdgywN3jBwfa`
- Rollback: promote the previous Vercel deployment; no data migration is involved.

## System map and hypothesis

Both public and private traffic already use the same encrypted `sendGatewayRpc` WebSocket transport. They differ in discovery and ticket authorization by design. The reliability mismatch is client policy: public traffic retries after a stale cached session, while private traffic does not. The selected reversible change is to extract the per-candidate cached/fresh request policy and use it from both flows without weakening private ticket issuance.

## Verification and experiment log

- Extracted shared cached-request and fresh-ticket request primitives used by both public and private gateway calls.
- Private routing now retries its single bound node once with a fresh private ticket, equivalent to public routing falling through to another verified candidate.
- Controlled defect: reducing private attempts from two to one made the new transient-failure scenario fail on the first WebSocket error. The defect was restored and the scenario passed.
- Focused suite: 4 files, 13 tests passed, covering encrypted gateway compatibility, private retry, logout RPC, private session playback, and node RPC authentication.
- Dashboard production build passed.
- Browser failure simulation: with remote revocation intentionally left pending, logout removed local access and refresh state in 1 ms, never disabled the button, and returned the UI to the connection step.

## thinkBETTER iteration 1

- Baseline: private request surfaced the first gateway failure; logout blocked on remote revocation.
- Current best: private request uses shared public request primitives and a fresh-ticket retry; logout is local-first and remote-best-effort.
- Target: met by deterministic transient-failure and stalled-dependency scenarios.
- Guardrails: private tickets, connection-code identity binding, encrypted transport, node-local auth, authenticated playback tests, and production build all pass.
- Decision: `COMPLETE` for the client reliability boundary. No protocol or server change is needed.
