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
- Installer SHA-256: `7203D9BABADA173D2BFA370CB9CC4153ADDA4A430834047A24FBFC385A12FF88`.
- Windows/dashboard deployment and live `username.servername` verification are pending.
