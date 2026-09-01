# Safe work record: private node network names

- Branch: `feat/private-node-network-names`
- Worktree: `C:\Users\hrdyk\Documents\PROJEKTY-MOJE\SpilledCinema-node-names`
- Base: `8427954` (the currently deployed private-login recovery stack)
- Production scope: self-hosted Convex control plane, Vercel dashboard, Windows server runtime
- Windows release: `0.2.0-beta.39`
- Compatibility rule: existing 16-character connection codes remain valid as a recovery locator
- Data migration: widen-only schema change; existing nodes do not require a backfill

## Intended behavior

- A node may claim one lowercase, globally unique network name.
- A name remains owned by that node while it is offline; heartbeat expiry never releases it.
- A node may atomically replace its own name, but may never take another node's name.
- Viewers can locate an account with `username.servername` and then authenticate against the node.
- Older nodes and saved browser sessions continue to work through their connection code.

## Rollback

- Revert the feature commit(s) and redeploy the prior dashboard/server/control-plane bundle.
- The additive `nodeNetworkNames` table may remain unused; removing it is not required for rollback.
- No connection code, node identity, account, session, or library data is rewritten by this feature.

## Verification evidence

- Canonical locator tests: 32 focused dashboard tests passed, including name validation, `username.servername` parsing, connection-code compatibility, and network-name resolution.
- Server TypeScript and production bundle build passed.
- Dashboard TypeScript and production Vite bundle build passed.
- Setup wizard scenarios passed (configured, fresh, and script-safe bootstrap).
- Local credential recovery scenarios passed unchanged.
- Convex code generation and strict TypeScript check passed against the self-hosted instance.
- Fresh cold backup `20260901-090331` created on `DESKTOP-KOEDI91`; manifest is present (3,092 bytes, 13 files) and the backend returned ready afterward.
- Self-hosted Convex deployment succeeded against `127.0.0.1:43210` through the SSH forward; schema validation passed and no indexes were deleted.
- Public edge checks returned the expected 404 for an unclaimed valid name and 400 for a reserved name.
- Windows privacy-default checks passed and the beta.39 NSIS installer built successfully.
- Pre-install inspection found the live beta.38 process returning a DPAPI CLR initialization error from `/api/status`. The old store launched PowerShell for every secret read and permanently cached a rejected initialization promise.
- DPAPI storage now decrypts its master key once per process, shares concurrent initialization, keeps the key only in memory, retries transient PowerShell/CLR failures, times out hung helpers, and clears rejected initialization for later recovery.
- DPAPI stress scenarios passed: 12 serialized writes, 120 concurrent reads, restart decryption, and no plaintext `.active` key file.
- The initial beta.39 installer hash was superseded before deployment. Final rebuilt installer SHA-256: `6629D7E9EACFE8BBCA31E0BCFF65661E3A4B50790BEC8105693DD7CC1BEFB3BC`.
- Remote beta.39 installer hash matched, silent installation exited `0`, the scheduled task is running with 999 restart attempts, configuration hash was preserved, and 12/12 status probes returned the existing node ID `node_b9909ae5609efe5f05d5d53d` and connection code `15DB-F67A-DA86-5792`.
- The live node claimed `kao-home`; both local status and the public resolver return that name, the same node ID, and `online: true`.
- A post-deploy control-plane outage exposed a failed startup-only backend task (last result `1`). A recurring two-minute SYSTEM watchdog and post-backup readiness/retry loop were installed, with rollback copies retained as `*.pre-beta39`.
- Controlled recovery drill passed: the Convex backend was stopped, the watchdog returned exit `0`, local port 3210 recovered, the public edge recovered, and `kao-home` returned online again.
- Windows/dashboard deployment and live `username.servername` verification are pending.
