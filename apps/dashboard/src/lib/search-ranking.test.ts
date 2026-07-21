import { describe, expect, it } from "vitest";
import { sortUnifiedSearchResults } from "./search-ranking";

describe("unified search ranking", () => {
  it("puts canonical, externally validated Supergirl films ahead of series and noisy matches", () => {
    const results = sortUnifiedSearchResults("Supergirl", [
      {
        id: "svet-series",
        title: "Supergirl",
        mediaType: "serial" as const,
        year: "2015",
        matchScore: 9_000,
      },
      {
        id: "making-of",
        title: "Supergirl: The Making of the Movie",
        mediaType: "movie" as const,
        year: "1985",
        matchScore: 3_000,
      },
      {
        id: "german",
        title: "Supergirl - Das Mädchen von den Sternen",
        mediaType: "movie" as const,
        year: "1971",
        matchScore: 3_000,
      },
      {
        id: "new-film",
        title: "Supergirl",
        mediaType: "movie" as const,
        year: "2026",
        matchScore: 5_440,
        searchSignals: { popularity: 363.8, voteCount: 500, releaseDate: "2026-06-24" },
      },
      {
        id: "classic-film",
        title: "Superdívka",
        alternateTitles: ["Supergirl"],
        mediaType: "movie" as const,
        year: "1984",
        matchScore: 5_323,
        searchSignals: { popularity: 5.4, voteCount: 711, releaseDate: "1984-07-01" },
      },
      {
        id: "random-short",
        title: "Supergirl",
        mediaType: "movie" as const,
        year: "2018",
        matchScore: 5_315,
        searchSignals: { popularity: 0.2, voteCount: 0, releaseDate: "2018-04-11" },
      },
    ]);

    expect(results.map((result) => result.id)).toEqual([
      "new-film",
      "classic-film",
      "svet-series",
      "random-short",
      "german",
      "making-of",
    ]);
  });

  it("does not penalize making-of content when the query explicitly asks for it", () => {
    const results = sortUnifiedSearchResults("Supergirl making of", [
      { id: "film", title: "Supergirl", mediaType: "movie" as const, year: "2026" },
      { id: "making", title: "Supergirl: The Making of the Movie", mediaType: "movie" as const, year: "1985" },
    ]);

    expect(results[0]?.id).toBe("making");
  });
});
