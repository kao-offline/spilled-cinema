import corpus from "../src/server/__tests__/fixtures/search-corpus.json" with { type: "json" };
import { performance } from "node:perf_hooks";
import { explainUnifiedSearchResultScore, hasRequiredSearchTokenCoverage, sortUnifiedSearchResults } from "../src/lib/search-ranking.ts";

const candidates = corpus.titles.map((title) => ({ ...title, alternateTitles: title.aliases, mediaType: title.mediaType as "movie" | "serial" }));
const iterations = Math.max(1, Number.parseInt(process.argv.find((arg) => arg.startsWith("--iterations="))?.split("=")[1] ?? "100", 10));
let passed = 0;
const started = performance.now();

for (const scenario of corpus.queries) {
  let ranked = candidates;
  for (let iteration = 0; iteration < iterations; iteration += 1) {
    ranked = sortUnifiedSearchResults(scenario.query, candidates.filter((candidate) =>
      hasRequiredSearchTokenCoverage(scenario.query, [candidate.title, ...candidate.alternateTitles, candidate.year])));
  }
  const winner = ranked[0];
  const ok = winner?.id === scenario.expected && (scenario.reject ?? []).every((id) => !ranked.some((item) => item.id === id));
  if (ok) passed += 1;
  const detail = winner ? explainUnifiedSearchResultScore(scenario.query, winner) : null;
  console.log(`${ok ? "PASS" : "FAIL"}  ${scenario.query.padEnd(30)} expected=${scenario.expected.padEnd(26)} got=${winner?.id ?? "none"}`);
  if (!ok && winner) console.log("      score", detail, "top3", ranked.slice(0, 3).map((item) => item.id));
}

const elapsed = performance.now() - started;
console.log(`\n${passed}/${corpus.queries.length} passed | ${iterations} iterations | ${elapsed.toFixed(1)}ms total | ${(elapsed / (iterations * corpus.queries.length)).toFixed(3)}ms/query`);
process.exitCode = passed === corpus.queries.length ? 0 : 1;
