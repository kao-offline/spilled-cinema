# Search Development Handoff

> Status snapshot as of 2026-08-09 (commit `48b755f`, release `v0.2.0-beta.19`).
> Written for a follow-up session continuing unified search work.

---

## 1. Current State

Unified search now tolerates small wording changes (typos, missing letters,
glued/split words, filler words) and groups cross-provider results transitively.
Shipped in server release **v0.2.0-beta.19**. The dashboard (browser-side grouping
+ ranking) is **not yet redeployed** to Vercel.

### What was done this sprint

| Change | Where | Deployed? |
|--------|-------|-----------|
| Fuzzy token matcher (`queryTokenCovered`) + expanded weak-token list | `apps/dashboard/src/lib/search-ranking.ts` | In installer (node bundle) ✅, dashboard ⏳ |
| `trimWeakSearchEdges` — strips leading/trailing filler from provider queries | `search-ranking.ts`, used in `packages/node-client/src/index.ts` | Installer ✅, dashboard ⏳ |
| Coverage gates delegate to fuzzy matcher; tolerate 1 miss in ≥3-token queries | `search-ranking.ts` | Installer ✅, dashboard ⏳ |
| `hasProviderSearchTokenCoverage` delegates to shared coverage (was exact/prefix-only) | `packages/node-client/src/index.ts` | Installer ✅ |
| Transitive merge grouping in `buildRemoteCommandResults` | `apps/dashboard/src/lib/command-search.ts` (committed `7047079`) | Browser-only — dashboard ⏳ |
| 13 relevance tests | `apps/dashboard/src/server/__tests__/unified-search-relevance.test.ts` | — |

### Key constraint
`search-ranking.ts` is bundled into **both** the node server (`standalone.mjs`, via
`node-client`) and the dashboard (browser). Changes must stay additive and keep
working in both bundles. See `AGENTS.md` for the full architecture.

---

## 2. How Search Works (data flow)

```
Browser (dashboard)
  └─ import-client.ts:283  POST /api/search  →  requestRuntimeJson (cascade)
        └─ gateway → node server  standalone.mjs  /api/search   (http-handlers.ts:716)
              └─ searchNode (packages/node-client)
                    └─ runParallelProviderSearch:
                         providerQuery = trimWeakSearchEdges(query)   ← new
                         searchVidking / searchSvetSerialu / searchBombuj (Promise.allSettled)
                         merge + re-attach cross-provider matches
                         hasProviderSearchTokenCoverage gate (fuzzy) ← new
Browser
  └─ buildRemoteCommandResults (command-search.ts)   ← transitive merge grouping
        └─ sortUnifiedSearchResults (search-ranking.ts)
```

**Two separate deploy surfaces:**
1. **Node** — `npm run build -w @spilledcinema/server` → `dist/standalone.mjs`, shipped via
   Windows installer (`apps/server-windows`, electron-builder NSIS).
2. **Dashboard** — Vercel deploy from `apps/dashboard`. Carries `command-search.ts`
   grouping + `search-ranking.ts` ranking used in the browser.

**Release process (AGENTS.md):** bump `apps/server-windows/package.json`, run
`npm run dist:windows -w @spilledcinema/server-windows`, commit + tag `vX.Y.Z-beta.N`,
push, `gh release create` with the exe + blockmap.

---

## 3. Key Functions in `apps/dashboard/src/lib/search-ranking.ts`

- `normalizeSearchText` — lowercases, strips diacritics (NFD), `&`→"and", strips
  `online-film-`/`online-serial-` prefixes, collapses non-alphanumerics to spaces.
- `trimWeakSearchEdges(value)` — trims leading/trailing `WEAK_SEARCH_TOKENS`
  ("the friends show" → "friends"); **preserves mid-title prepositions** ("game of
  thrones" intact). Returns original if nothing trimmed or everything is weak.
- `WEAK_SEARCH_TOKENS` — articles, `cz`/`czech`, `download`, `dubbed`, `english`,
  `episode(s)`, `film`, `free`, `full`, `hd`, `movie(s)`, `online`, `season(s)`,
  `serial`, `series`, `show(s)`, `stream`, `tv`, `watch(ing)`.
- `queryTokenCovered(queryToken, candidateToken)` — boolean "close enough" matcher:
  exact, prefix either way (≥4), glued containment (query ≥5 chars), Levenshtein
  ≤2 if either ≥6 chars else ≤1.
- `hasSignificantSearchTokenMatch` / `hasRequiredSearchTokenCoverage` — boolean
  gates. Coverage adds compact equality ("spiderman"=="spider man") and tolerates
  **1 miss for queries with ≥3 tokens**.
- `scoreSearchCandidate` — ranks using `effectiveQueryTokens` (weak tokens filtered
  out; falls back to all tokens if none significant). Exact +1200, compact +1080,
  prefix +760, etc. Distance-1/2 typo = 46. First-token bonus 70/35. Index tiebreak.
- `unifiedSearchResultScore` — metadata boost layer on top: exact/alias/prefix
  bonuses (50k/48k/24k/22k/12k), popularity/voteCount/year/recency boosts, noise
  penalty (`SEARCH_NOISE_PATTERN`), provider matchScore tiebreak (≤1000).
- `keepHighConfidenceSearchResults` — filters below 45% of top score when top ≥5000.
- `compareSearchScores` / `sortUnifiedSearchResults` — sorters.

---

## 4. Grouping (transitive merge) in `command-search.ts`

`buildRemoteCommandResults` (line 245) builds groups. Each result sorted by
`sortUnifiedSearchResults`; for each, find all existing groups sharing
`sameRemoteIdentity` and collapse them together (handles A-B, B-C chains). If a
group moves, it's hoisted to front.

`sameRemoteIdentity` (line 164): mediaType must match; years must be within ±1 (if
both known); any title key intersects (`resultTitleKeys`).

---

## 5. Node-Side Re-attachment in `packages/node-client`

`runParallelProviderSearch` (index.ts ~line 148):
- `providerQuery = trimWeakSearchEdges(query)` sent to all three providers.
- Ranking still uses the full `query` for relevance.
- `hasProviderSearchTokenCoverage(query, [title, slug, ...alternateTitles])` gates
  each provider result via the fuzzy coverage matcher.

---

## 6. Tests

`apps/dashboard/src/server/__tests__/unified-search-relevance.test.ts` — 13 tests:
exact title, substring rejection (Silo vs Zběsilost), multi-word prefix, small
typos, one-letter omission, filler words, unrelated-with-shared-filler rejection,
split↔glued both directions, requires-all-significant-tokens for short queries,
tolerates-one-miss in longer queries, exact > typo scoring, word-order swap scoring.

Run: `npx vitest run apps/dashboard/src/server/__tests__/unified-search-relevance.test.ts`
All 13 pass (verified 2026-08-09).

### Live verification (real providers, run via node with `--env-file=.env.local`)
All passed:
- `avengrs endgam` → Avengers: Endgame
- `game of thron` → Game of Thrones
- `breking bad` → Breaking Bad
- `the friends show` → Přátelé (previously missing entirely)
- `spiderman` → Spider-Man

---

## 7. Open Items / Next Steps

1. **Redeploy dashboard to Vercel** (`npx vercel deploy --prod` from `apps/dashboard`)
   so browser-side grouping + fuzzy ranking go live. **Not done yet** — the released
   installer ships node-side fixes only.
2. **Consider `keepHighConfidenceSearchResults` interaction with fuzzy matching** —
   wider fuzzy matches mean more borderline results; threshold behavior should be
   re-audited against real queries.
3. **Typo tolerance tuning** — `queryTokenCovered` glued containment requires query
   ≥5 chars; verify no false positives ("silo" swallowing unrelated titles) beyond
   the existing Zběsilost test.
4. **Provider query trimming edge cases** — verify `trimWeakSearchEdges` behavior for
   single-word queries and queries that are entirely weak tokens.
5. **Performance** — Levenshtein is O(n·m) per token pair; watch search latency with
   many candidate results.

---

## 8. Related Files

| File | Role |
|------|------|
| `apps/dashboard/src/lib/search-ranking.ts` | All ranking/coverage/fuzzy logic; bundled by node + dashboard |
| `apps/dashboard/src/lib/command-search.ts` | Browser-side grouping (`buildRemoteCommandResults`, `sameRemoteIdentity`) |
| `packages/node-client/src/index.ts` | `searchNode`, `runParallelProviderSearch`, coverage gate |
| `apps/server/src/http-handlers.ts:716` | `/api/search` route handler |
| `apps/dashboard/src/lib/import-client.ts:283` | Dashboard search client call |
| `apps/dashboard/src/server/__tests__/unified-search-relevance.test.ts` | 13 tests |
| `apps/server/package.json` | Build: tsc + esbuild → `dist/standalone.mjs` |
| `apps/server-windows/package.json` | Installer version + electron-builder config |

## 9. Environment / Gotchas

- TMDB creds live in `.env.local`; any live-repro script must run with `--env-file=.env.local`.
- Windows PowerShell; use `npx` commands from repo root or the right workspace dir.
- `dist/` and `server-windows/server/` are gitignored — the installer payload is
  regenerated by `prepare:payload`.
- `AGENTS.md` is authoritative for architecture and the "easy to break" list
  (CORS on browser-file, playback proxy URL, subtitle proxy 403s, heartbeat TTL,
  localhost probe spam, vault logging, gateway secrets, Convex deployment target).
