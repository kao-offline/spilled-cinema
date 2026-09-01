# Safe work record: private node login input hotfix

- Worktree: `C:\Users\hrdyk\Documents\PROJEKTY-MOJE\SpilledCinema-login-input`
- Branch: `fix/private-node-login-input`
- Base/recovery point: `073c614` (`v0.2.0-beta.39`)
- Production target: Vercel project `spilled-cinema`, alias `https://spilled.overload.studio`
- Scope: dashboard connection input only; no server, control-plane, schema, identity, or stored-data change
- Root cause: the controlled input rendered `displayLocator(code)` on every keystroke. Before a dot existed, that formatter discarded every non-hexadecimal character, so typing a username such as `kao` was immediately erased.
- Fix: preserve the raw locator draft while the user types; disable mobile capitalization, correction, and spellcheck for the machine-readable login.
- Rollback: promote the previous known-good Vercel deployment `ELELuQ3CuMiWhiuFo8Kpi98Rh4bg` if the hotfix fails production verification.

## Verification

- Focused private-node input scenarios passed, including exact assertions that the controlled field preserves the raw draft and no longer calls the recovery-code formatter while typing.
- 32 private-node connection and gateway tests passed.
- Dashboard TypeScript and production Vite build passed; local output uses `assets/index-B-Yg8eSX.js`.
- Collaborative-browser local test passed with actual individual key presses: the first `k` remained visible, the completed value was `kao.kao-home`, and the Connect button became enabled.
- The isolated local Vite process chain was stopped and port 4176 was verified free after the test.
- Pending: Vercel preview, preview connection verification, production deployment, and production connection verification.
