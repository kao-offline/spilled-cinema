# Private playback and public verification recovery

## Contract

- Goal: visibly play a real video through the production dashboard using the operator's Windows node, and make enabled public capabilities verifiable.
- Primary correctness gate: a real browser video element reaches a playing state with advancing `currentTime`; resolver success alone is insufficient.
- Secondary gate: the live node advertises enabled V2 capabilities and the verifier records at least the intended gateway capabilities as verified.
- Baseline: production private `player.playback.resolve` returns `No validated MP4/HLS/DASH source found`; Windows `/api/status` is 200 and reports public capabilities, while the verifier reports 0 verified and server logs contain capability-ticket mismatch closures.
- Guardrails: preserve private server data, identities, credentials, connection code, vault, and existing production rollback artifacts; do not weaken private session validation.

## Recovery

- Source base: `41edc4a` on isolated worktree `SpilledCinema-home-private-node`.
- Task branch: `fix/private-playback-verification`.
- Dashboard rollback: Vercel `dpl_HDaa2dJTdn5szuZWNzjfX1eBPLTB`.
- Windows rollback: retain the currently installed server and verifier installers/configuration before replacing either build.

## Evidence map

- The browser error is an application resolver rejection, not a gateway transport error.
- `apps/server-windows/main.js` sets `SPILLED_PUBLIC_CAPABILITIES` to an empty string. In `standalone.ts`, any defined value becomes an explicit V2 capability set, so the empty set overrides the public capability configuration shown by `/api/status`.
- `auth.logout` is mapped to `library.read` by the node runtime but the dashboard requests a `library.write` ticket, producing unauthorized-frame link closures.
- The verifier's default player probe uses an `example.com` placeholder and cannot establish real player functionality.

## Scenario matrix

1. Transport failure: retry with a fresh ticket.
2. Deterministic resolver rejection: do not retry or label it as a gateway failure.
3. Enabled public capability: advertised after Windows host startup and accepted by verifier.
4. Private playback: same resolver request contract as public playback, authenticated at the node.
5. Visual production beta: video is visible, unpaused, ready, and time advances.

