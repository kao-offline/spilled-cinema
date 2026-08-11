# Safe-work record: private-node beta.27 deployment

## Intent

- Goal: promote code-based private-node connection to production and install the matching Windows server build on the approved Windows 10 host.
- Scope: Convex control plane, Windows server installer, hosted dashboard. The gateway has no code change.
- Owner: Codex `/root`.

## Git state

- Repository/worktree: `C:/Users/hrdyk/Documents/PROJEKTY-MOJE/SpilledCinema-private-node-release`.
- Base: `origin/master` at `fe9e889` (the beta.26 production lineage).
- Branch: `release/private-node-beta27`.
- Feature integration: `686b9a1`.
- Release version: `0.2.0-beta.27`.
- Remote branch/PR: none at start.

## Environment

- Control plane: production `cheerful-lynx-4` / `https://cheerful-lynx-4.convex.site`.
- Dashboard: production `https://spilled.overload.studio` on Vercel.
- Windows host: approved wrapper target `DESKTOP-KOEDI91` (`10.0.1.10`), user `desktop-koedi91\kao`.
- Server API before change: HTTP 200, status `ok`, protocol 2, private auth enabled.
- Installed server before change: `0.2.0-beta.26`; identified process tree rooted at PID 13284 under the expected install path.
- Credentials: wrapper/provider-managed references only; values are never recorded or printed.

## Recovery

- Source rollback: base commit `fe9e889`; pairing checkpoint `2508f79`; release branch checkpoint will be recorded after validation.
- Windows rollback artifact: `C:/Users/kao/AppData/Local/Temp/Spilled-Server-Setup-0.2.0-beta.26-x64.exe`.
- Windows rollback SHA-256: `7B0E268584C07F820C31B72D842176FB3FA5283EF3CDAA1866DB42FEF3B2B6F0`.
- Installed beta.26 executable SHA-256: `9A188DB93EA08CD890A9E97433104D93EB1F81B5272B11BAC3FD927C064C29F3`.
- Application data: `%APPDATA%/Spilled Server` must remain untouched; NSIS is configured not to delete app data.
- Rollback procedure: run the retained beta.26 installer silently, then verify executable version and `/api/status` HTTP 200. Convex schema is additive/optional and remains compatible with beta.26. Vercel can be promoted back to its prior deployment.

## Rollout

1. Validate and checkpoint beta.27 source and immutable installer.
2. Deploy the additive Convex schema/actions.
3. Upload, hash-verify, and silently install beta.27 on the single approved host.
4. Verify version, process path, `/api/status`, connection code, and gateway reachability.
5. Deploy the dashboard to production and verify the public connect route.

## Abort conditions

- Wrong Convex deployment, Vercel project, Windows identity, executable path, or installer hash.
- Failed build/tests, destructive schema requirement, loss of `/api/status`, node identity change, missing private auth, or gateway link failing to recover.
- Any operation would expose credentials or overwrite `%APPDATA%/Spilled Server`.

## Deployment record

- Release source: `01740cb` before this record update; remote branch `origin/release/private-node-beta27`.
- Installer: `Spilled-Server-Setup-0.2.0-beta.27-x64.exe`, 116303617 bytes, SHA-256 `0D991CA182E49362C615E8B5A1CBA1839CE5C65CAEB2E22BF079A548361865C6`.
- Signature posture: unsigned, matching the retained beta.26 installer and installed executable.
- Convex: production deployment `cheerful-lynx-4` completed successfully; schema validation passed and only `nodeRegistrations.by_connection_code` was added.
- Windows canary: installer exit 0; executable version beta.27; scheduled task `Spilled Server Runtime` running; `/api/status` HTTP 200; original node identity preserved; private auth and connection code present.
- Production routing: connection-code resolver returned HTTP 200, the same node identity, and `online: true` without displaying the code.
- Vercel: production deployment `dpl_6eS8Jzra9TQZh883hoJRPnj9BQdF` READY and aliased to `https://spilled.overload.studio`.
- Browser acceptance: production `/connect` rendered and the real beta.27 node advanced to the watcher password/passkey login screen. The connection code was moved through local clipboard without being printed and the clipboard was cleared afterward.
- Verification: 17/17 focused tests, 5/5 deterministic scenarios plus controlled-failure proof, dashboard/server builds, Convex types, and isolated 350-episode import tests passed. Full-suite baseline still contains one unrelated unchanged search-ranking assertion failure.

## Incident record

- The first Vercel CLI attempt ran from `apps/dashboard` without ignored project-link metadata. It created project `dashboard` (`prj_88d1qRzvhxSkWQ9eYwBUIa0vkqGn`) and deployment `5MEdjzUUcL4WfYuWZHrWWEypBj8B`, which failed because monorepo parent packages were not uploaded.
- The existing `spilled-cinema` production project and alias were not changed by that failure.
- Corrective action: explicitly linked the release repository root to `spilled-cinema`, preserving its configured `apps/dashboard` root, then deployed successfully.
- Cleanup: after committing the incident record, removed only the newly created `dashboard` project; Vercel reported success. The incident record and provider logs remain as evidence.
