import { describe, expect, it } from "vitest";
import { buildFacetCounts, matchesFacetGroupExcept, matchesFilters } from "../explore-feed";
import type { ExploreFilters, ExploreItem } from "../../lib/types";

const baseItem: ExploreItem = {
  id: "item-1",
  title: "Severance",
  slug: "severance",
  importSlug: "severance",
  provider: "svetserialu",
  mediaType: "serial",
  detailUrl: "https://svetserialu.to/serial/severance",
  genres: ["Sci-Fi", "Drama"],
  audioBuckets: ["all", "subtitles"],
  languages: [],
  directors: ["Ben Stiller"],
  actors: ["Adam Scott"],
  sectionKeys: ["newest", "genreBrowse"],
  inVault: false,
  availableNow: true,
  network: "Apple TV+",
};

function createFilters(change?: Partial<ExploreFilters>): ExploreFilters {
  return {
    mediaTypes: [],
    providers: [],
    genres: [],
    audioBuckets: [],
    networks: [],
    sections: [],
    inVault: "all",
    availability: "all",
    personRole: "any",
    ...change,
  };
}

describe("explore feed helpers", () => {
  it("builds provider-scoped facets without flattening provider metadata", () => {
    const counts = buildFacetCounts([
      baseItem,
      {
        ...baseItem,
        id: "item-2",
        provider: "bombuj",
        title: "The Matrix",
        slug: "the-matrix",
        importSlug: "the-matrix",
        mediaType: "movie",
        detailUrl: "https://www.bombuj.si/online-film-the-matrix",
        genres: ["Sci-Fi"],
        audioBuckets: ["all", "dubbing"],
        sectionKeys: ["popular"],
        network: undefined,
      },
    ], createFilters());

    expect(counts.providers.map((entry) => entry.key)).toEqual(expect.arrayContaining(["svetserialu", "bombuj"]));
    expect(counts.genres.find((entry) => entry.label === "Sci-Fi")).toBeTruthy();
    expect(counts.audioBuckets.find((entry) => entry.key === "dubbing")?.provider).toBe("bombuj");
  });

  it("keeps facet counts stable while excluding the active group from self-filtering", () => {
    const items: ExploreItem[] = [
      baseItem,
      {
        ...baseItem,
        id: "item-2",
        title: "Foundation",
        slug: "foundation",
        importSlug: "foundation",
        provider: "bombuj",
        mediaType: "serial" as const,
        detailUrl: "https://www.bombuj.si/serial-foundation",
        genres: ["Sci-Fi"],
        sectionKeys: ["popular"],
        network: "Apple TV+",
      },
      {
        ...baseItem,
        id: "item-3",
        title: "Silo",
        slug: "silo",
        importSlug: "silo",
        provider: "svetserialu",
        detailUrl: "https://svetserialu.to/serial/silo",
        genres: ["Sci-Fi"],
        network: "Apple TV+",
        audioBuckets: ["all", "dubbing"],
      },
    ];

    const filters = createFilters({
      providers: ["svetserialu"],
      genres: ["Sci-Fi"],
    });

    const counts = buildFacetCounts(items, filters);

    expect(counts.providers.find((entry) => entry.key === "bombuj")?.count).toBe(1);
    expect(matchesFacetGroupExcept("providers", items[1], filters)).toBe(true);
    expect(matchesFilters(items[1], filters)).toBe(false);
  });

  it("matches provider-specific filters only when the item exposes them", () => {
    expect(matchesFilters(baseItem, createFilters({ sections: ["genreBrowse"] }))).toBe(true);
    expect(matchesFilters(baseItem, createFilters({ audioBuckets: ["dubbing"] }))).toBe(false);
    expect(matchesFilters({ ...baseItem, inVault: true }, createFilters({ inVault: "yes" }))).toBe(true);
    expect(matchesFilters(baseItem, createFilters({ personQuery: "stiller", personRole: "director" }))).toBe(true);
    expect(matchesFilters({ ...baseItem, year: undefined }, createFilters({ yearMin: 2020 }))).toBe(false);
  });
});
