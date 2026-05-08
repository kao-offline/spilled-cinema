import type { ExploreItem, LibraryState, TrendingFeedResponse, TrendingItem, UserTasteProfile } from "../lib/types";
import { getExploreFeed } from "./explore-feed";
import { buildDiscoveryScore } from "./discovery-ranking";

export function buildTrendingScore(
  candidate: ExploreItem,
  librarySnapshot: LibraryState,
  tasteProfile: UserTasteProfile,
) {
  const result = buildDiscoveryScore({
    candidate,
    query: "",
    filters: {
      mediaTypes: [],
      providers: [],
      genres: [],
      audioBuckets: [],
      networks: [],
      sections: [],
      inVault: "all",
      availability: "all",
      personRole: "any",
    },
    librarySnapshot,
    tasteProfile,
  });

  return {
    score: result.totalScore,
    reasons: result.reasons,
  };
}

export async function getTrendingFeed(input: {
  mediaType?: "all" | "movie" | "serial";
  limit?: number;
  librarySnapshot: LibraryState;
  tasteProfile: UserTasteProfile;
}): Promise<TrendingFeedResponse> {
  const explore = await getExploreFeed({
    query: "",
    filters: {
      mediaTypes: input.mediaType && input.mediaType !== "all" ? [input.mediaType] : [],
      providers: [],
      genres: [],
      audioBuckets: [],
      networks: [],
      sections: ["newest", "popular", "latestEpisodes", "topToday", "topOverall", "novinky"],
      inVault: "all",
      availability: "available",
      personRole: "any",
    },
    librarySnapshot: input.librarySnapshot,
    tasteProfile: input.tasteProfile,
    limit: 120,
  });

  const items = explore.items
    .map((candidate) => {
      const { score, reasons } = buildTrendingScore(candidate, input.librarySnapshot, input.tasteProfile);
      return {
        ...candidate,
        score,
        recommendationReasons: reasons,
      } satisfies TrendingItem;
    })
    .filter((item) => item.score > 0 && item.availableNow)
    .sort((left, right) => right.score - left.score || left.title.localeCompare(right.title))
    .slice(0, input.limit ?? 24);

  return {
    generatedAt: Date.now(),
    items,
    source: "local",
    stale: explore.stale,
  };
}
