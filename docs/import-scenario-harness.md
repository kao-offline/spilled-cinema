# Import scenario harness

The focused import matrix validates the client-side boundary before any provider request is made:

- rapid repeated clicks on the same title produce one started request and one duplicate decision;
- a different title is blocked while the current import is active;
- releasing the active request restores clean repeatability;
- grouped search candidates select one usable source, never the whole group;
- existing direct slugs and provider matches are recognized before import;
- source keys normalize whitespace and case.
- the shared homepage source contract always contains Home, SvetSerialu, and Bombuj;
- provider filters and the selected homepage source survive a remount;
- provider cards carry `importing`, `added`, `already`, `busy`, and `error` states and disable repeat activation while importing.

Run the matrix:

```powershell
npm test -w @spilledcinema/dashboard -- src/lib/__tests__/import-guard.test.ts
npm test -w @spilledcinema/dashboard -- src/lib/__tests__/ui-scenarios.test.ts
```

Run one scenario:

```powershell
npm test -w @spilledcinema/dashboard -- src/lib/__tests__/import-guard.test.ts -t "rapid double click"
```

Add cases as table entries or focused invariants in `import-guard.test.ts`. The suite is deterministic, uses no network or production storage, and intentionally does not claim that an upstream provider import itself succeeds; production provider calls remain covered by their existing integration boundary.

The browser pass should cover both phone and desktop layouts. On phone, confirm that all three source tabs are visible, change a provider feed and anime filter, reload, and confirm all selections remain active. Double-click one unimported provider card and confirm that the card disables immediately, one bottom import popup reports the duplicate guard, and the final state changes to Added/In vault. Clicking that card again must open the existing library detail instead of sending another provider request.
