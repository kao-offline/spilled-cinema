# Safe work record: private provider homepage feeds

- Worktree: `C:\Users\hrdyk\Documents\PROJEKTY-MOJE\SpilledCinema-provider-tabs`
- Branch: `fix/private-provider-home-feeds`
- Base/recovery commit: `b34a2f6`
- Production dashboard before change: Vercel deployment `5RuBgT2TB1eWoU4cgCqGMuYPXzyL`
- Windows rollback release: `v0.2.0-beta.39`, installer SHA-256 `6629D7E9EACFE8BBCA31E0BCFF65661E3A4B50790BEC8105693DD7CC1BEFB3BC`
- Scope: authenticated provider feed/search/import routing in the dashboard and Windows node runtime; no schema or stored-data migration
- Root cause: after private login, provider homepage traffic still requested public `provider.*` tickets. The node's privacy defaults intentionally do not advertise public fetch capabilities, so no public candidate could serve the logged-in tabs.
- Fix: route logged-in provider operations through existing private `library.read`/`library.write` tickets, include the node session token, and validate that token before invoking provider handlers.
- Security boundary: the new private RPC method aliases reject missing, expired, revoked, or scope-incompatible node sessions; the public provider capability paths remain unchanged.
- Rollback: redeploy Vercel deployment `5RuBgT2TB1eWoU4cgCqGMuYPXzyL` and reinstall beta.39 if beta.40 fails verification.

## Verification

- Direct pre-change diagnostics on `DESKTOP-KOEDI91`: Bombuj latest movies returned 4 items in 835 ms; SvetSerialu new episodes returned 4 items in 182 ms. This isolated the fault to hosted routing rather than either provider parser.
- 45 focused dashboard/private-gateway tests passed, including logged-in feed/search/import routing and existing connection/gateway coverage.
- Encrypted node transport integration passed for the new `library.provider.feed` alias under a private `library.read` ticket.
- The server executor test confirms all three private provider aliases validate the node access token before invoking their handlers.
- Dashboard and server production builds passed; dashboard output uses `assets/index-CFZJnBbz.js`.
- Windows privacy-default and private-playback scenario checks passed unchanged.
- Windows beta.40 installer built successfully with SHA-256 `A8E9BB9F82C452788836C47884A4499B89C073C86E0D6E8DDB86D39E5267F35A`.
- Beta.40 installed silently on `DESKTOP-KOEDI91`; installer exited 0, scheduled runtime task is running, config hash was preserved, and all 12 post-install health probes retained node `node_b9909ae5609efe5f05d5d53d` / network name `kao-home`.
- A second post-install check passed 5/5 status probes. Bombuj `latest-movies` returned 4 live items in 686 ms and SvetSerialu `new-episodes` returned 4 live items in 180 ms.
- Vercel preview deployment: `EvMLf3FYZmxzkKLYoLKhCUoZiFnc`.
- Vercel production deployment: `4Hg9y4JPF9yxPiD16KkeECxGSSTk`, aliased to `https://spilled.overload.studio`, serving `assets/index-CJKmC6dU.js`.
- Production browser verification confirmed that the visible SvetSerialu and Bombuj homepage controls switch to the correct feed/search surfaces. The shared verification browser has no private-node login, so authenticated feed contents were verified through the encrypted private-RPC integration tests and the live post-install provider probes instead of accessing the user's private session.
