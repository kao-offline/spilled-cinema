# Safe-work record: Windows runtime reliability

## Intent

- Goal: stop the Windows server/verifier from degrading permanently, reduce control-plane quota pressure, and release a supervised Windows build.
- Scope: Windows Electron hosts, verifier scheduling, gateway/control-plane retry behavior, and capability-ticket rate-limit I/O.
- Owner: Codex `/root` for this task.

## Git state

- Repository: `C:\Users\hrdyk\Documents\PROJEKTY-MOJE\SpilledCinema-runtime-reliability`
- Base branch/commit: tag `v0.2.0-beta.37` at `dc6cf5305a0220a137ba8357dc6ce3bf7516e00a`
- Task branch: `fix/windows-runtime-reliability`
- Starting status: clean
- Remote: `origin` (`kao-offline/spilled-cinema`)

## Environment

- Windows canary: `DESKTOP-KOEDI91`, user `desktop-koedi91\kao`, reached through SSH alias `win10`.
- Server: Spilled Server `0.2.0-beta.38`, local readiness HTTP 200 on `127.0.0.1:8787`.
- Verifier: Spilled Verifier `1.1.8`.
- Control plane: self-hosted Convex on `DESKTOP-KOEDI91`, private ports 3210/3211.
- Public control-plane edge: `spilled-control-plane.hrdykrystof.workers.dev` through Workers VPC and named tunnel `5e8162cb-6c4f-435a-a7fb-54cb70eeed67`.
- Gateway: production worker `spilled-node-gateway.hrdykrystof.workers.dev`, health HTTP 200.

## Incident evidence

- Control-plane calls fail because Convex disabled the free deployment after its monthly limits were exceeded.
- August usage: 4,934,745 function calls and 15.13 GB database I/O; free included limits are 1,000,000 calls and 1 GB database I/O.
- The server's gateway handshake is surfaced as HTTP 401 because the gateway collapses control-plane 5xx failures into authorization failures.
- The verifier log reached about 207 MB after an earlier nested-timer retry storm. The installed verifier now emits one failed pass per minute, but one-minute full-capability verification remains above the sustainable free-plan call budget.
- Both Windows Scheduled Tasks had zero restart attempts, no logon trigger, and battery-stop defaults; the server task was not supervising the currently running server parent.

## Recovery

- Source rollback: deploy/build tag `v0.2.0-beta.37` (`dc6cf53`).
- Windows rollback artifacts already present on the canary include the beta.36 server backup and previous verifier installers under the user's temporary directory.
- Local SSH config ACL backup: `C:\Users\hrdyk\AppData\Local\Temp\spilled-ssh-acl-backup-20260831\config.acl`.
- Cloud rollback: record the current Cloudflare Worker version before deployment; redeploy the previous Git commit if health checks fail.
- Convex rollback: hosted snapshot and environment backup are under `%LOCALAPPDATA%\SpilledCinema\backups\convex-hosted`; the original hosted deployment remains unchanged. The self-hosted runtime keeps daily cold backups under `C:\ProgramData\SpilledCinema\Convex\backups\daily`.
- Cloudflare rollback versions: gateway before the direct service binding `e379c01d-073b-4cef-84da-927c00360a4f`; original gateway `a9a0b01b-175e-4a4a-8a86-c3692be67e4e`; control-plane edge first healthy cutover `03585d2e-58f0-4e37-b3e1-b5babea20693`.

## Verification

- Passed: hosted snapshot export (252,662 documents), self-hosted import, environment-secret migration, authenticated candidate lookup, VPC/tunnel readiness, cold-backup recovery, server/verifier/gateway/edge builds, verifier scheduler scenarios, server privacy defaults, and gateway renewal smoke.
- Dashboard production build passed. The full dashboard test suite has one unrelated pre-existing search-ranking assertion failure; 274 of 275 tests pass.
- Server and verifier NSIS installers completed, transferred with SHA-256 verification, and installed silently on the canary without changing the node database, identity, vault, or verifier credential.
- Both Windows tasks now have a logon trigger, a two-minute repeating watchdog trigger, 999 one-minute failure retries, battery-safe settings, and `IgnoreNew` instance handling.
- Child-process kill test passed: the server returned with a new PID and readiness HTTP 200; the verifier returned with a new PID on its bounded 30-second failure delay.
- Full process-tree kill test passed: the repeating task watchdog restored the verifier in about one minute and the server/readiness in about two minutes, despite Windows not honoring its ordinary restart-on-failure setting for a forced kill.
- Gateway uses a direct Cloudflare service binding to the control-plane edge. Production gateway version: `268b2c6b-7d80-4441-ab1c-aba96e040c38`.
- The canary gateway link is connected, the control plane reports one online node, and the verifier reports one verified live node plus seven offline imported nodes as degraded, with zero pass errors.
- Vercel production deployment `4S4omq9eyyG9B3mgkAVH6vhws8x6` is aliased to `https://spilled.overload.studio`; browser verification loaded the dashboard and returned the verified node through `/api/server/v2/discovery/nodes?capability=provider.feed`.
- The production browser resolved connection code `15DB-F67A-DA86-5792`, opened an authenticated `spilled-v2` WebSocket to the current gateway, listed both watcher accounts, and carried a password-login attempt through encrypted RPC to the node's credential rejection. This verifies the private login transport and node-local authentication boundary without changing user credentials.
- Release artifact SHA-256 values: server installer `6024EE412C881B1C85CD8D470FEAC288C30812F65628AA30F5E676834C6B2AF5`; verifier installer `FAA0DCD02819119B675F2F1DDF251BE3F4D29BAC748A1F4D77AAA8DA3FBCE0F8`.

## Next action

- Commit and publish tag `v0.2.0-beta.38` with the verified Windows artifacts.
