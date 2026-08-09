import { describe, expect, it } from "vitest";
import corpus from "./fixtures/search-corpus.json";
import { hasRequiredSearchTokenCoverage, sortUnifiedSearchResults } from "../../lib/search-ranking";

const candidates = corpus.titles.map((title) => ({
  ...title,
  alternateTitles: title.aliases,
  mediaType: title.mediaType as "movie" | "serial",
}));

describe("extensible search quality corpus", () => {
  for (const scenario of corpus.queries) {
    it(`${scenario.query} -> ${scenario.expected} [${scenario.tags.join(", ")}]`, () => {
      const eligible = candidates.filter((candidate) => hasRequiredSearchTokenCoverage(scenario.query, [
        candidate.title,
        ...candidate.alternateTitles,
        candidate.year,
      ]));
      const ranked = sortUnifiedSearchResults(scenario.query, eligible);
      expect(ranked[0]?.id).toBe(scenario.expected);
      for (const rejected of scenario.reject ?? []) {
        expect(ranked.map((candidate) => candidate.id)).not.toContain(rejected);
      }
    });
  }
});
