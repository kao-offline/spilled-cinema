# Desktop connection modal and logout

- Date: 2026-08-11
- Branch: `fix/desktop-connect-modal-logout`
- Base checkpoint: `e941696`
- Production rollback checkpoint before this change: Vercel deployment `dpl_5dz2fvzyCh1LGQNfSn6U7cGZRyo2`

## Scope

- Keep the home page mounted when `/connect` is opened.
- Show private-node connection as a bounded, responsive modal.
- Remove the full-screen backdrop blur that caused expensive repaints.
- Add visible logout actions to the connected modal and Settings.
- Revoke the node access session when reachable, then always clear local access and refresh credentials.

## Verification

- Focused Vitest suite: 3 files, 8 tests passed.
- Dashboard production build passed.
- `git diff --check` passed.
- Desktop browser check at 1280x800: connection modal opened in 107.7 ms and closed in 79.7 ms; the home route stayed mounted.
- Mobile browser check at 430x932: no horizontal overflow, connection field remained within the viewport, body scrolling was contained, and backdrop filtering was `none`.
- Direct `/connect` check: modal opens over Home without also opening the welcome modal; closing replaces the route with `/`.
- Authenticated-state simulation: the connected view exposes a visible `Log out` action.
- Production deployment: `dpl_GA3oa4PJcu48UVTBjdgywN3jBwfa`, aliased to `https://spilled.overload.studio`.
- Live desktop check: the Home connection action opened the modal without navigation and with `backdrop-filter: none`.
- Live mobile check at 430x932: the card measured 406px wide with no horizontal overflow.

Chrome DevTools MCP was unavailable in this environment, so interaction timing and layout checks used the shared T3 browser preview rather than a DevTools performance trace.
