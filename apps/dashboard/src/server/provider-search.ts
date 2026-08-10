import type { ExploreItem, ProviderFeedResponse } from "../lib/types";
import { getProviderModuleAdapter } from "./provider-modules";
import { getRemoteProviderModuleAdapter } from "./remote-provider-modules";
import type { SvetSerialuCredentials } from "./svetserialu";

function episodeSortValue(item: ExploreItem) {
  const season = item.episode?.seasonNumber ?? 0;
  const episode = item.episode?.episodeNumber ?? 0;
  const code = item.episode?.episodeCode?.match(/s0*(\d+)e0*(\d+)/i);
  return {
    season: code ? Number.parseInt(code[1], 10) : season,
    episode: code ? Number.parseInt(code[2], 10) : episode,
  };
}

export function mergeLatestEpisodeIntoSearchResults(results: ExploreItem[], feed: ProviderFeedResponse) {
  const latestBySlug = new Map<string, ExploreItem>();
  for (const item of feed.items) {
    if (!item.episode) continue;
    const current = latestBySlug.get(item.slug);
    if (!current) {
      latestBySlug.set(item.slug, item);
      continue;
    }
    const left = episodeSortValue(current);
    const right = episodeSortValue(item);
    if (right.season > left.season || (right.season === left.season && right.episode > left.episode)) {
      latestBySlug.set(item.slug, item);
    }
  }

  return results.map((result) => {
    const latest = latestBySlug.get(result.slug);
    return latest
      ? {
          ...result,
          episode: latest.episode,
          availableNow: latest.availableNow,
          availability: latest.availability,
          availabilityReason: latest.availabilityReason,
          detailUrl: latest.detailUrl || result.detailUrl,
        }
      : result;
  });
}

async function enrichSvetSearchWithFreshEpisodes(
  results: ExploreItem[],
  adapter: NonNullable<ReturnType<typeof getProviderModuleAdapter>>,
  credentials?: SvetSerialuCredentials | null,
) {
  if (!adapter.getFeed || results.length === 0) return results;
  try {
    const feed = await adapter.getFeed("new-episodes", {
      cursor: null,
      limit: 48,
      fresh: true,
      svetserialuCredentials: credentials,
    });
    return mergeLatestEpisodeIntoSearchResults(results, feed);
  } catch {
    return results;
  }
}

export async function searchProviderModule(input: {
  moduleId: string;
  query: string;
  repositoryUrls?: string[];
  svetserialuCredentials?: SvetSerialuCredentials | null;
}): Promise<ExploreItem[]> {
  const adapter = getProviderModuleAdapter(input.moduleId);
  if (adapter?.search) {
    const results = await adapter.search(input.query, {
      svetserialuCredentials: input.svetserialuCredentials,
    });
    return input.moduleId === "svetserialu"
      ? await enrichSvetSearchWithFreshEpisodes(results, adapter, input.svetserialuCredentials)
      : results;
  }

  const remoteAdapter = await getRemoteProviderModuleAdapter({
    moduleId: input.moduleId,
    repositoryUrls: input.repositoryUrls,
  });
  if (remoteAdapter?.search) {
    return await remoteAdapter.search(input.query);
  }

  throw new Error(`Provider module "${input.moduleId}" does not expose search.`);
}
