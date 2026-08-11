# Safe-work record: private-login playback

## Contract

- Goal: a browser signed into a private node can resolve and play HLS/MP4 while every public capability remains disabled.
- Primary boundary: hosted browser -> encrypted gateway RPC -> node resolver -> node browser-file proxy -> media element.
- Baseline: current private login is ignored by `requestRuntimeJson`; zero playback RPCs reached the node. A production-shaped direct-HLS probe returned `200` but produced a relative playback URL. Private discovery resolved the correct node but intentionally returned no endpoint URL.
- Target: player requests use the saved watcher session; node validation is mandatory; resolver budget is at least 90 seconds; the encrypted response contains an absolute node proxy URL; a fixture HLS playlist and segment can be fetched through that URL.
- Guardrails: no UI additions, no anonymous/public capability enabled, connection code remains a locator only, desktop/direct playback remains compatible, no production credentials or media URLs recorded.
- Recovery: source commit `0bcc6ec`, dashboard deployment `dpl_FdDzy4492NMX5pWnUwXQRvv8FUBA`, control-plane pre-beta.31 whitelist, and beta.30 Windows installer.

## System map and evidence

- Direct desktop path works because a relative `/api/download-full/browser-file` URL resolves against the node origin.
- Private discovery hides `endpointUrl`, so a relative URL from a gateway response resolves against the hosted dashboard instead.
- The runtime tracks dynamically created tunnel endpoints, but `buildPlaybackProxyPath` reads only `process.env.SPILLED_NODE_ENDPOINT_URL`; the two values diverge in production.
- Browser/player calls reserve 90 seconds, while private tickets and node `player.resolve` policy currently cap work at 30 seconds.
- Server log inspection found a healthy managed gateway but no playback RPC on the rolled-back public-only path.

## Ranked hypotheses

1. Synchronizing the runtime endpoint into playback URL construction will make the encrypted resolver response point at the node proxy rather than Vercel.
2. A watcher-token check plus private `player.resolve` ticket will make all-private nodes reachable without enabling anonymous sharing.
3. Aligning private ticket and node policy limits to 90 seconds will prevent slow valid resolvers from being discarded after 30 seconds.

The three changes are one coherent transport boundary: routing without authorization is unsafe; authorization without the endpoint cannot deliver media; both without the correct budget still reject valid playback.

## Scenario matrix

- Authenticated playback/resolve/clean-resolve -> private player RPC with access token.
- Missing/invalid session -> rejected before player handler.
- Private player ticket -> 90-second duration.
- Node player policy -> 90-second duration.
- Dynamic endpoint present -> absolute node proxy URL.
- Dynamic endpoint absent -> relative fallback retained for direct/hosted compatibility.
- HLS playlist -> node proxy rewrites segment URLs and the segment returns successfully.
- Controlled defect -> wrong endpoint or 30-second expectation must fail the harness.

## Experiment log

- Focused private playback suite: 4 files, 38 tests passed.
- Scenario harness: all nine normal checks passed.
- Harness self-test: the deliberate 30-second expectation produced exactly one failure and the harness detected it.
- Production dashboard build: passed.
- Production server build: passed.
- Deployment gate still required: live node resolver must return an absolute node URL, then playlist and rewritten segment requests must both succeed.
- Beta.32 live gate failed: its resolver still returned a relative proxy URL even though runtime status held an absolute endpoint. Bundle inspection showed lazy resolver initialization could overwrite the startup-time endpoint assignment. Beta.33 re-applies the tracked endpoint at each playback/download operation boundary.
- Beta.33 live gate passed on the Windows server: resolver `200`, absolute playback URL on the active node endpoint, master playlist `200`, all followed playlist URIs routed through `/api/download-full/browser-file`, one rewritten variant level, and media segment `200`.
