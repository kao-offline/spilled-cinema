# Safe-work record: IR remote prototype

## Intent

- Goal: Create the remote prototype, integrate configurable bindings into the dashboard, and provide one-command Raspberry Pi initialization.
- Scope: `testing/ir-remote-prototype/`, dashboard remote-input/search/player UI, and this record.
- Owner: Codex `/root`.

## Git state

- Repository: `C:/Users/hrdyk/Documents/PROJEKTY-MOJE/SpilledCinema`
- Integration worktree: `C:/Users/hrdyk/Documents/PROJEKTY-MOJE/SpilledCinema`
- Source worktree: `C:/Users/hrdyk/Documents/PROJEKTY-MOJE/SpilledCinema-ir-remote-prototype`
- Base branch/commit: `feat/home-playback-mobile` at `93c4b778738834e717a7318e1cc1100898c0200c`
- Integration branch: `feat/home-playback-mobile`
- Source branch: `feat/ir-remote-prototype`
- Prototype checkpoint commit: `ec23d628d032fb256891825ed0e2211226ee82bf`
- Integration commits: `42172fd`, `8ce5d27`
- Initial status: clean
- Remote branch/PR: none

## Environment

- Target: local dashboard integration and optional manual installation on a Raspberry Pi.
- External connections: none made.
- Processes/ports: none left running; documented receiver default is TCP 8765.
- Production deployment: none; dashboard source integration remains local to the task branch.

## Recovery

- Recovery point: base commit `93c4b778738834e717a7318e1cc1100898c0200c`.
- Data/config changes: none.
- Rollback: remove the task worktree/branch after preserving any wanted patch or commit.

## Verification

- Python unit suite: passed.
- Python compile/import smoke checks: passed.
- Dashboard focused tests: 9 passed.
- New dashboard files strict type-check: passed.
- Changed dashboard files ESLint: passed.
- Pi installer `bash -n`: passed.
- Full dashboard build: blocked by existing dependency/type errors in Noble hash imports, existing `RequestInit.cache` usage, and existing `node:sqlite` typings.
- Live original-worktree dev-server QA: passed; search footer, binding dialog, and TV Mode state toggle verified.
- Hardware verification: pending physical Raspberry Pi, Argon case, and remote.

## Next action

- Run the one-command initializer on the physical Pi and verify actual IR input.
- Do not deploy or merge without reviewing the documented pre-existing dashboard build blockers.
