# Responsive UI scenario harness

This focused Vitest matrix checks the observable contracts behind the responsive homepage:

- phone, desktop, 1080p TV, 4K TV, and data-saver artwork delivery tiers;
- independent SvetSerialu and Bombuj feed/filter persistence;
- homepage provider-tab restoration;
- malformed and stale browser-storage fallback.

Run every scenario:

```powershell
npm test -w @spilledcinema/dashboard -- src/lib/__tests__/ui-scenarios.test.ts
```

Run one group:

```powershell
npm test -w @spilledcinema/dashboard -- src/lib/__tests__/ui-scenarios.test.ts -t "artwork tier"
```

Add a scenario by extending the table in `ui-scenarios.test.ts` or adding a focused storage invariant. The harness uses an isolated in-memory storage fixture and never writes browser or production data. It does not measure Core Web Vitals or GPU frame timing; those require a configured Chrome DevTools performance integration and representative TV hardware.
