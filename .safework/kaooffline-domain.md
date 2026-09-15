# Safe-work record: kaooffline-domain

## Intent

- Goal: Serve the SpilledCinema dashboard from both existing and new production domains.
- Scope: Vercel custom domain, Cloudflare DNS, node CORS, extension permissions, and passkey origin selection.
- Owner: Codex `/root`.

## Git state

- Repository: `C:/Users/hrdyk/Documents/PROJEKTY-MOJE/SpilledCinema`
- Worktree: `C:/Users/hrdyk/Documents/PROJEKTY-MOJE/SpilledCinema-kao-domain`
- Base branch/commit: `feat/home-playback-mobile` at `6eae196b901bacd221261876ea96a88738ab65cf`
- Task branch: `feat/kaooffline-domain`
- Current source checkpoint: `ea50435b0587543aa8f06e4c3c05064d68aad74d`
- Remote branch: `origin/feat/kaooffline-domain`

## Environment

- Target: Vercel production project `spilled-cinema` and Cloudflare zone `kaooffline.top`.
- Verified existing production domain: `https://spilled.overload.studio`.
- New domain: `https://spilled.kaooffline.top`.
- Cloudflare DNS required by Vercel: DNS-only `A` record to `76.76.21.21`.

## Recovery

- Source recovery point: base commit `6eae196b901bacd221261876ea96a88738ab65cf`.
- Previous Vercel production deployment: `dpl_6VNztk4Mchd3Gpksaqb3hqktdnLn`.
- Preview deployment: `dpl_6R8gHzg9rJosrokAFEbimJcQEtF2`.
- Remove the new Vercel binding with `vercel domains rm spilled.kaooffline.top --yes`.
- Remove the Cloudflare `spilled` DNS record to roll back DNS after confirming its record ID.
- Restore production with `vercel rollback dpl_6VNztk4Mchd3Gpksaqb3hqktdnLn` if promotion is unhealthy.

## Verification

- Server, extension, and dashboard production builds passed locally on 2026-09-15.
- CORS smoke check returned `200` and the matching allow-origin header for both dashboard domains; an unrelated origin returned `403`.
- Vercel preview `dpl_6R8gHzg9rJosrokAFEbimJcQEtF2` reached `READY`.
- All workspace build scripts passed on 2026-09-15.
- All 299 dashboard tests passed across 54 test files.
- Original production domain checks passed for the app shell, PWA manifest/service worker, generic API health, TMDB lookup, artwork metadata/search, library navigation, settings tabs, support content, and 430px mobile layout without horizontal overflow.
- Production control-plane health responds, but reports zero active nodes. Runtime-backed provider feeds/search/import/playback are therefore unavailable independently of the domain change.
- `spilled.kaooffline.top` currently resolves through Cloudflare proxy addresses and serves an unrelated Quickhost login response. The existing `spilled` record must be replaced with Vercel's DNS-only record by the domain owner.

## Next action

- In Cloudflare DNS, replace the existing `spilled` record with DNS-only `A spilled 76.76.21.21`, then verify Vercel domain/SSL status. No dashboard promotion is required because the custom domain is attached to the existing production project.
