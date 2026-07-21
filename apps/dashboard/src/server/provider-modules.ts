import { cachedFetchText } from "./provider-discovery-shared";
import { getBombujMovieSections, getBombujSeriesSections, hydrateBombujItem } from "./bombuj-discovery";
import { fetchBombujMovie, searchBombuj } from "./bombuj";
import { hydrateSvetItem, parseSvetEpisodeCards } from "./svetserialu-discovery";
import {
  fetchSvetSerialuShow,
  fetchSvetSerialuText,
  searchSvetSerialu,
  type SvetSerialuCredentials,
} from "./svetserialu";
import { fetchVidkingTitle, searchVidking } from "./vidking";
import type { IntegrationId } from "../lib/integrations";
import {
  DEFAULT_PROVIDER_MODULES,
  hydrateProviderModules,
  type ProviderModuleRecord,
} from "../lib/provider-modules-shared";
import type {
  ExploreAudioBucket,
  ExploreItem,
  ProviderFeedResponse,
  ProviderModuleManifest,
} from "../lib/types";

const SVETSERIALU_BASE_URL = "https://svetserialu.to";
const PROVIDER_MODULES_PATH = "/server/provider-modules";

export type ProviderModuleAdapter = {
  moduleId: string;
  providerId: IntegrationId;
  getFeed?: (feedId: string, args: { cursor?: string | null; limit?: number; svetserialuCredentials?: SvetSerialuCredentials | null }) => Promise<ProviderFeedResponse>;
  search?: (query: string, args?: { svetserialuCredentials?: SvetSerialuCredentials | null }) => Promise<ExploreItem[]>;
  import?: (slug: string, mediaType?: "movie" | "serial", args?: { svetserialuCredentials?: SvetSerialuCredentials | null }) => Promise<unknown>;
  resolvePlayer?: (...args: unknown[]) => Promise<unknown>;
  download?: (...args: unknown[]) => Promise<unknown>;
};

function inferAudioBuckets(title: string) {
  const normalized = title.toLowerCase();
  const buckets: ExploreAudioBucket[] = ["all"];
  if (/\b(tit|titul|sub|subs|subtitle)\b/i.test(normalized)) {
    buckets.push("subtitles");
  }
  if (/\b(dab|dabing|dub)\b/i.test(normalized)) {
    buckets.push("dubbing");
  }
  if (buckets.length === 1) {
    buckets.push("subtitles");
  }
  return buckets;
}

function createSvetSearchItem(result: Awaited<ReturnType<typeof searchSvetSerialu>>[number]): ExploreItem {
  const audioBuckets = inferAudioBuckets(result.title);
  return {
    id: `svetserialu:search:${result.slug}`,
    title: result.title,
    slug: result.slug,
    importSlug: result.slug,
    provider: "svetserialu",
    mediaType: "serial",
    detailUrl: `${SVETSERIALU_BASE_URL}/serial/${result.slug}`,
    posterUrl: result.posterUrl ?? null,
    backdropUrl: null,
    year: result.year ?? null,
    yearLabel: result.year ?? null,
    description: null,
    genres: [],
    audioBuckets,
    languages: [],
    network: null,
    directors: [],
    actors: [],
    sectionKeys: [],
    inVault: false,
    availableNow: true,
    matchScore: result.matchScore,
    recommendationReasons: [],
  };
}

function createBombujSearchItem(result: Awaited<ReturnType<typeof searchBombuj>>[number]): ExploreItem {
  return {
    id: `bombuj:search:${result.mediaType ?? "unknown"}:${result.slug}`,
    title: result.title,
    slug: result.slug,
    importSlug: result.slug,
    provider: "bombuj",
    mediaType: result.mediaType ?? "movie",
    detailUrl: result.mediaType === "serial"
      ? `https://serialy.bombuj.si/serial-${result.slug}`
      : `https://www.bombuj.si/online-film-${result.slug}`,
    posterUrl: result.posterUrl ?? null,
    backdropUrl: null,
    year: result.year ?? null,
    yearLabel: result.year ?? null,
    description: null,
    genres: [],
    audioBuckets: ["all"],
    languages: [],
    network: null,
    directors: [],
    actors: [],
    sectionKeys: [],
    inVault: false,
    availableNow: true,
    matchScore: result.matchScore,
    recommendationReasons: [],
  };
}

async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  task: (item: T, index: number) => Promise<R>,
) {
  const results = new Array<R>(items.length);
  let cursor = 0;

  async function worker() {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await task(items[index], index);
    }
  }

  const workers = Array.from({ length: Math.min(concurrency, items.length) }, () => worker());
  await Promise.all(workers);
  return results;
}

async function hydrateFeedItem(item: ExploreItem, credentials?: SvetSerialuCredentials | null) {
  try {
    if (credentials) {
      return item;
    }
    const hydrated = await hydrateSvetItem(item);
    return hydrated.value;
  } catch {
    return item;
  }
}

async function hydrateBombujFeedItem(item: ExploreItem) {
  try {
    const hydrated = await hydrateBombujItem(item);
    return hydrated.value;
  } catch {
    return item;
  }
}

function parseProviderPageCursor(cursor: string | null | undefined) {
  const page = Number.parseInt(String(cursor ?? "0"), 10);
  return Number.isFinite(page) && page >= 0 ? page : 0;
}

async function loadSvetNewEpisodesFeed(cursor?: string | null, limit = 24, credentials?: SvetSerialuCredentials | null): Promise<ProviderFeedResponse> {
  const requestedLimit = Math.max(1, limit);
  const startPage = parseProviderPageCursor(cursor);
  const baseItems: ExploreItem[] = [];
  let stale = false;
  let nextPage = startPage;

  while (baseItems.length < requestedLimit) {
    let html: string;
    let pageStale = false;
    if (credentials) {
      html = await fetchSvetSerialuText(`${SVETSERIALU_BASE_URL}/?ajaxTVShows=true&page=${nextPage}`, SVETSERIALU_BASE_URL, credentials);
    } else {
      const result = await cachedFetchText(
        `${SVETSERIALU_BASE_URL}/?ajaxTVShows=true&page=${nextPage}`,
        4 * 60 * 1000,
      );
      html = result.html;
      pageStale = result.stale;
    }
    stale = stale || pageStale;

    const pageItems = parseSvetEpisodeCards(html);
    if (pageItems.length === 0) {
      break;
    }

    let addedCount = 0;
    for (const item of pageItems) {
      if (!baseItems.some((existing) => existing.id === item.id)) {
        baseItems.push(item);
        addedCount += 1;
      }
    }

    if (addedCount === 0) {
      break;
    }

    nextPage += 1;
  }

  const slice = baseItems.slice(0, requestedLimit);
  const items = await mapWithConcurrency(slice, 4, async (item) => await hydrateFeedItem(item, credentials));
  return {
    generatedAt: Date.now(),
    stale,
    moduleId: "svetserialu",
    feedId: "new-episodes",
    items,
    continueCursor: baseItems.length >= requestedLimit ? String(nextPage) : null,
  };
}

async function loadBombujFeed(feedId: string, cursor?: string | null, limit = 24): Promise<ProviderFeedResponse> {
  const requestedLimit = Math.max(1, limit);
  const page = parseProviderPageCursor(cursor);
  const source = feedId === "latest-movies"
    ? await getBombujMovieSections()
    : await getBombujSeriesSections();
  const sectionKey = feedId === "latest-movies" ? "newest" : "novinky";
  const baseItems = source.items.filter((item) => item.sectionKeys.includes(sectionKey));
  const start = page * requestedLimit;
  const slice = baseItems.slice(start, start + requestedLimit);
  const items = await mapWithConcurrency(slice, 4, hydrateBombujFeedItem);

  return {
    generatedAt: Date.now(),
    stale: source.stale,
    moduleId: "bombuj",
    feedId,
    items,
    continueCursor: start + requestedLimit < baseItems.length ? String(page + 1) : null,
  };
}

const providerAdapters: Record<string, ProviderModuleAdapter> = {
  vidking: {
    moduleId: "vidking",
    providerId: "vidking",
    async search(query) {
      return await searchVidking(query);
    },
    async import(slug, mediaType) {
      return await fetchVidkingTitle(slug, mediaType);
    },
  },
  svetserialu: {
    moduleId: "svetserialu",
    providerId: "svetserialu",
    async getFeed(feedId, args) {
      if (feedId !== "new-episodes") {
        throw new Error(`Unsupported SvetSerialu feed "${feedId}".`);
      }
      return await loadSvetNewEpisodesFeed(args.cursor, args.limit ?? 24, args.svetserialuCredentials);
    },
    async search(query, args) {
      const results = await searchSvetSerialu(query, args?.svetserialuCredentials);
      return results.map(createSvetSearchItem);
    },
    async import(slug, _mediaType, args) {
      return await fetchSvetSerialuShow(slug, args?.svetserialuCredentials);
    },
  },
  bombuj: {
    moduleId: "bombuj",
    providerId: "bombuj",
    async getFeed(feedId, args) {
      if (feedId !== "latest-movies" && feedId !== "latest-series") {
        throw new Error(`Unsupported Bombuj feed "${feedId}".`);
      }
      return await loadBombujFeed(feedId, args.cursor, args.limit ?? 24);
    },
    async search(query) {
      const results = await searchBombuj(query);
      return results.map(createBombujSearchItem);
    },
    async import(slug, mediaType) {
      return await fetchBombujMovie(slug, mediaType);
    },
  },
};

export function getProviderModuleAdapter(moduleId: string) {
  return providerAdapters[moduleId] ?? null;
}

export async function loadProviderModulesFromControlPlane() {
  const siteUrl = process.env.CONVEX_SITE_URL;
  if (!siteUrl) {
    return DEFAULT_PROVIDER_MODULES;
  }

  try {
    const response = await fetch(`${siteUrl.replace(/\/$/, "")}${PROVIDER_MODULES_PATH}`, {
      headers: {
        Accept: "application/json",
      },
    });

    if (!response.ok) {
      throw new Error(`Convex provider module lookup failed (${response.status}).`);
    }

    const payload = (await response.json()) as { modules?: ProviderModuleRecord[] };
    if (!Array.isArray(payload.modules) || payload.modules.length === 0) {
      return DEFAULT_PROVIDER_MODULES;
    }

    return hydrateProviderModules(payload.modules) as ProviderModuleManifest[];
  } catch {
    return DEFAULT_PROVIDER_MODULES;
  }
}
