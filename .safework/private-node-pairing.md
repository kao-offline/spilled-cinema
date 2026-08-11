# Safe-work record: private-node-pairing

## Intent

- Goal: Make private-node connection work through a human-readable connection code and encrypted gateway login, with no URL discovery required.
- Scope: Dashboard onboarding/login UI, private gateway RPC, node RPC surface, control-plane locator, focused tests and documentation.
- Owner: Codex `/root`.

## Git state

- Repository: `C:/Users/hrdyk/Documents/PROJEKTY-MOJE/SpilledCinema`
- Worktree: `C:/Users/hrdyk/Documents/PROJEKTY-MOJE/SpilledCinema-private-node-pairing`
- Base branch/commit: `fix/mobile-playback-stall` at `f53df161d83111fe0fa0d22cbf16210d02dd960b`
- Task branch: `feat/private-node-pairing`
- Starting commit: `f53df161d83111fe0fa0d22cbf16210d02dd960b`; the completed feature checkpoint is the task branch HEAD.
- Remote branch/PR: none.
- Checkpoint scope: private-node pairing implementation, tests, this task record, and the beta brief, committed as one logical change on the task branch.
- Preserved adjacent work: the source checkout has unrelated uncommitted playback/resolver work; it is untouched and excluded from this worktree.

## Environment

- Target: local implementation and isolated synthetic tests only; no deployment authorized.
- Account/project/context: repository code only.
- Identity/profile: local Git identity; no credentials inspected.
- Permissions: source write on the task branch; no cloud writes.
- Processes/ports: pre-existing listeners on 5173 owned by PIDs 24572 and 11760 were left untouched. The isolated browser beta used 127.0.0.1:5178; PID 23908 was ownership-verified and stopped, and the port was confirmed released.
- Data directory: disposable in-memory or temporary fixtures only.

## Recovery

- Checkpoint commits: base `f53df16`.
- Patch/archive: not required for the clean isolated worktree; the base commit is the recovery point.
- Bundle: not required before source-only reversible edits.
- Database/config snapshot: none; no live database or config changes authorized.
- Deployment previous version: not applicable.
- Rollback procedure: preserve any useful diff/commits, then remove the sibling worktree and delete only `feat/private-node-pairing` if explicitly requested.
- Restore verification: `git show f53df16` and the untouched source checkout retain the starting state.

## Verification

- Commands passed: scenario harness and controlled-failure proof; 16 focused tests; changed-file ESLint; dashboard/server production builds; Convex typecheck; `git diff --check`; desktop and mobile browser inspection.
- Commands blocked or failed: one broad `rg` included nonexistent paths and was rerun with scoped paths. The first RPC test load exposed an optional native WebRTC import and led to lazy loading for transfer-only calls. Repository-wide dashboard lint reports four pre-existing errors outside the task; changed files pass.
- Artifacts/logs: `docs/private-node-connection-beta.md`.

## Next action

- Exact next safe step: hand off the coordinated deployment order without deploying; pushing, PR creation, and production rollout require explicit authorization.
- Abort conditions: any need to expose account lists globally, weaken node-side authentication, deploy Convex/gateway/dashboard, or overwrite adjacent work.
- Handoff notes: private credentials remain node-local; the control plane stores only an opaque locator derived from the protected gateway enrollment credential plus routing metadata. Bootstrap ticket issuance requires both the resolved node ID and matching connection code.
