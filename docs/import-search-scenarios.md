# Import search scenarios

The table-driven suite in `apps/dashboard/src/lib/import-search.test.ts` covers
the deterministic boundary between import-box input and provider operations.

It checks Bombuj movie URLs, both Bombuj series URL shapes, SvetSerialu's three
known domains, URLs without a scheme, encoded slugs, ordinary title searches,
unsupported URLs, and provider diversity in the six visible import results.

Run only this suite:

```powershell
npx vitest run apps/dashboard/src/lib/import-search.test.ts
```

Add a URL by appending one `[input, expected]` row to `cases`. These tests do not
contact provider websites or prove that a provider is currently online; live
provider behavior remains covered by the server search/import paths and requires
network access plus the normal local credentials.

Cross-provider enrichment is covered in
`apps/dashboard/src/server/__tests__/unified-search-relevance.test.ts`. A strong
result whose normalized title differs from the raw query creates bounded probes
for providers that do not already contain that exact title/media/year identity.
The live probes are capped at one canonical query per seed, two seeds, and five
seconds per provider call. Exact unchanged queries do not create redundant work.
