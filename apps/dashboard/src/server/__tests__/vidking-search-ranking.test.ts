import { describe, expect, it } from "vitest";
import { keepHighConfidenceSearchResults, sortUnifiedSearchResults } from "../../lib/search-ranking";
import { createVidkingSearchItem } from "../vidking";

const exact1899 = {
  id: "tmdb:tv:90669",
  title: "1899",
  originalTitle: "1899",
  mediaType: "serial" as const,
  year: "2022",
  posterUrl: null,
  source: "tmdb" as const,
  matchScore: 5331,
};

const unrelated1899 = {
  id: "tmdb:movie:262860",
  title: "Fête de Paris 1899: Concours d'automobiles fleuries (départ)",
  originalTitle: null,
  mediaType: "movie" as const,
  year: null,
  posterUrl: null,
  source: "tmdb" as const,
  matchScore: 1521,
};

describe("VidKing numeric-title ranking", () => {
  it("keeps TMDB 1899 as the strongest VidKing candidate", () => {
    const items = [exact1899, unrelated1899]
      .map((candidate, index) => createVidkingSearchItem(candidate, index, "1899"))
      .filter((item): item is NonNullable<typeof item> => Boolean(item));
    expect(keepHighConfidenceSearchResults(items)[0]?.slug).toBe("tv/90669");
  });

  it("does not interpret a standalone numeric title as a release-year request", () => {
    const ranked = sortUnifiedSearchResults("1899", [
      { title: unrelated1899.title, mediaType: "movie" as const, year: null },
      { title: "1899", mediaType: "serial" as const, year: "2022" },
    ]);
    expect(ranked[0]?.title).toBe("1899");
  });

  it("still uses a four-digit year when a title precedes it", () => {
    const ranked = sortUnifiedSearchResults("Dune 1984", [
      { title: "Dune", mediaType: "movie" as const, year: "2021" },
      { title: "Dune", mediaType: "movie" as const, year: "1984" },
    ]);
    expect(ranked[0]?.year).toBe("1984");
  });
});
