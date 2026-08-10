import { describe, expect, it } from "vitest";
import { mergeLatestEpisodeIntoSearchResults } from "../provider-search";
import type { ExploreItem, ProviderFeedResponse } from "../../lib/types";

function item(slug: string, episodeCode?: string): ExploreItem {
  return {
    id: `svet:${slug}:${episodeCode ?? "search"}`,
    title: slug === "silo" ? "Silo" : slug,
    slug,
    importSlug: slug,
    provider: "svetserialu",
    mediaType: "serial",
    detailUrl: `https://svetserialu.to/serial/${slug}`,
    genres: [],
    audioBuckets: ["all"],
    languages: [],
    directors: [],
    actors: [],
    sectionKeys: [],
    inVault: false,
    availableNow: true,
    episode: episodeCode ? { episodeCode } : undefined,
  };
}

describe("provider search freshness", () => {
  it("adds the newest live-feed episode to a shallow SvetSerialu search result", () => {
    const feed: ProviderFeedResponse = {
      generatedAt: 1,
      stale: false,
      moduleId: "svetserialu",
      feedId: "new-episodes",
      items: [item("silo", "s03e03"), item("silo", "s03e04")],
      continueCursor: null,
    };

    const [result] = mergeLatestEpisodeIntoSearchResults([item("silo")], feed);

    expect(result.episode?.episodeCode).toBe("s03e04");
    expect(result.detailUrl).toBe("https://svetserialu.to/serial/silo");
  });
});
