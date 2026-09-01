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
- Vercel preview `5tRDfWuo4wFxHzS8mvtUooE9urb7` built successfully. Its UI was protected by Vercel preview access, so the shared browser could not enter it; no production traffic was routed there.
- Production deployment `5RuBgT2TB1eWoU4cgCqGMuYPXzyL` built successfully and was aliased to `https://spilled.overload.studio`; the deployed application bundle is `assets/index-D_Utg5r3.js`.
- Live production key-by-key test passed: after pressing only `k`, the input value remained `k`; after the remaining individual key presses it contained `kao.kao-home`, and Connect securely was enabled.
- The first production connection attempt coincided with a transient node-offline response. Read-only checks confirmed both Windows runtime tasks running, the control plane ready, and the public resolver returning `kao-home` online. Retrying the unchanged form succeeded immediately.
- Final production connection verification passed: the deployed site showed `NODE VERIFIED · KAO-HOME`, `Sign in as kao`, and the viewing-password input.
- Branch commit deployed: `802c37b`. Previous production deployment `ELELuQ3CuMiWhiuFo8Kpi98Rh4bg` remains the rollback handle.
