# Safe-work record: IR remote prototype

## Intent

- Goal: Create an isolated Tkinter remote pad and Raspberry Pi Argon IR bridge prototype.
- Scope: `testing/ir-remote-prototype/` and this record only.
- Owner: Codex `/root`.

## Git state

- Repository: `C:/Users/hrdyk/Documents/PROJEKTY-MOJE/SpilledCinema`
- Worktree: `C:/Users/hrdyk/Documents/PROJEKTY-MOJE/SpilledCinema-ir-remote-prototype`
- Base branch/commit: `feat/home-playback-mobile` at `93c4b778738834e717a7318e1cc1100898c0200c`
- Task branch: `feat/ir-remote-prototype`
- Initial status: clean
- Remote branch/PR: none

## Environment

- Target: local prototype only; optional manual installation on a Raspberry Pi.
- External connections: none made.
- Processes/ports: none left running; documented receiver default is TCP 8765.
- Production application changes: none.

## Recovery

- Recovery point: base commit `93c4b778738834e717a7318e1cc1100898c0200c`.
- Data/config changes: none.
- Rollback: remove the task worktree/branch after preserving any wanted patch or commit.

## Verification

- Python unit suite: passed.
- Python compile/import smoke checks: passed.
- Hardware verification: pending physical Raspberry Pi, Argon case, and remote.

## Next action

- Copy the prototype folder to the Pi and verify actual IR scancodes with `ir-keytable -t`.
- Do not connect this prototype to SpilledCinema production code without a separate approved task.
