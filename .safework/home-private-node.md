# Safe-work record: Home private node

- Branch: `feat/home-private-node`
- Base: `origin/release/private-node-beta27` (`5cc9cf5`)
- Worktree: `C:\Users\hrdyk\Documents\PROJEKTY-MOJE\SpilledCinema-home-private-node`
- Scope: Home connection/reconnection UI, private setup guide, Windows private-network defaults.
- Release extension: beta.28 adds connection-code-based remote administration from the app and an installer/test tutorial.
- Excluded: production deployment, control-plane schema changes, gateway secrets.
- Rollback: revert the feature commit; the previous beta.27 behavior remains intact.
- Verification: dashboard production build, connection-code scenarios, Windows privacy-default scenarios, desktop/mobile browser inspection.
