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
- Server: Spilled Server `0.2.0-beta.37`, local health HTTP 200 on `127.0.0.1:8787`.
- Verifier: Spilled Verifier `1.1.7`.
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
- Cloudflare rollback versions: gateway `a9a0b01b-175e-4a4a-8a86-c3692be67e4e`; control-plane edge first healthy cutover `03585d2e-58f0-4e37-b3e1-b5babea20693`.

## Verification

- Passed: hosted snapshot export (252,662 documents), self-hosted import, environment-secret migration, authenticated candidate lookup, VPC/tunnel readiness, cold-backup recovery, server/verifier/gateway/edge builds, verifier scheduler scenarios, server privacy defaults, and gateway renewal smoke.
- Dashboard production build passed. The full dashboard test suite has one unrelated pre-existing search-ranking assertion failure; 274 of 275 tests pass.
- Pending: Windows packaging, installer canary, process-kill recovery, gateway reconnect, Vercel production environment cutover, and live dashboard verification.

## Next action

- Build and install server `0.2.0-beta.38` and verifier `1.1.8`, then validate automatic recovery and publish the release artifacts.
