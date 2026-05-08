import { requestRuntimeJson } from "./local-api";
import type {
  ExploreFeedResponse,
  ExploreFilters,
  TrendingFeedResponse,
  UserTasteProfile,
} from "./types";
import type { ExploreMediaType, LibraryState } from "./types";

export type ExplorePersonSuggestion = {
  id: string;
  name: string;
  role: "actor" | "director" | "any";
  department?: string | null;
  knownFor: string[];
};

export async function fetchExploreFeed(input: {
  query: string;
  filters: ExploreFilters;
  sections?: string[];
  cursor?: string | null;
  limit?: number;
  librarySnapshot: LibraryState;
  tasteProfile: UserTasteProfile;
}) {
  const response = await requestRuntimeJson<ExploreFeedResponse & { error?: string }>("/api/explore/feed", {
    method: "POST",
    body: input,
  });

  if (!response.ok || !response.data?.items) {
    throw new Error(response.data?.error ?? "Failed to load Explore feed.");
  }

  return response.data;
}

export async function fetchTrendingFeed(input: {
  mediaType?: ExploreMediaType | "all";
  limit?: number;
  librarySnapshot: LibraryState;
  tasteProfile: UserTasteProfile;
}) {
  const response = await requestRuntimeJson<TrendingFeedResponse & { error?: string }>("/api/trending/feed", {
    method: "POST",
    body: input,
  });

  if (!response.ok || !response.data?.items) {
    throw new Error(response.data?.error ?? "Failed to load Trending feed.");
  }

  return response.data;
}

export async function fetchExplorePeopleSuggestions(input: {
  query: string;
  role?: "actor" | "director" | "any";
  limit?: number;
}) {
  const response = await requestRuntimeJson<{ suggestions?: ExplorePersonSuggestion[]; error?: string }>("/api/explore/people", {
    method: "POST",
    body: input,
  });

  if (!response.ok || !response.data?.suggestions) {
    throw new Error(response.data?.error ?? "Failed to load people suggestions.");
  }

  return response.data.suggestions;
}
