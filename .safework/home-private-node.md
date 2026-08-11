# Safe-work record: Home private node

- Branch: `feat/home-private-node`
- Base: `origin/release/private-node-beta27` (`5cc9cf5`)
- Worktree: `C:\Users\hrdyk\Documents\PROJEKTY-MOJE\SpilledCinema-home-private-node`
- Scope: Home connection/reconnection UI, private setup guide, Windows private-network defaults.
- Release extension: beta.28 adds connection-code-based remote administration from the app and an installer/test tutorial.
- Excluded: production deployment, control-plane schema changes, gateway secrets.
- Rollback: revert the feature commit; the previous beta.27 behavior remains intact.
- Verification: dashboard production build, connection-code scenarios, Windows privacy-default scenarios, desktop/mobile browser inspection.
- Beta.28 artifact: `apps/server-windows/release/Spilled-Server-Setup-0.2.0-beta.28-x64.exe` (116,303,729 bytes).
- Beta.28 SHA-256: `A67182BEA0A84C9796057D8684EF6F7F35DABA73C7F4001605618E8D0D01A59A`.
- Signing: unsigned; Windows SmartScreen behavior is documented in the test tutorial.
- Smoke: disposable server returned health/status `ok`, mode `local`, bound to `127.0.0.1`; temporary data removed.
- Previous known-good release: `v0.2.0-beta.27`; rollback by reinstalling that release and reverting beta.28 commits.
