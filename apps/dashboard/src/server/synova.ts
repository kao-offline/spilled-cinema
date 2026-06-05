import type { ExploreItem } from "../lib/types";
import {
  absoluteUrl,
  cachedFetchText,
  decodeHtml,
  normalizeDiscoveryText,
  stripTags,
  uniqueBy,
} from "./provider-discovery-shared";
import {
  compareSearchScores,
  keepHighConfidenceSearchResults,
  scoreSearchCandidate,
} from "../lib/search-ranking";

const BASE_URL = "https://cinenova.store";
const EN_BASE_URL = `${BASE_URL}/en`;
const FEED_TTL_MS = 10 * 60 * 1000;
const SEARCH_TTL_MS = 5 * 60 * 1000;

type SynovaFeedId = "popular-movies" | "popular-tv";

function normalizeImageUrl(value: string | null | undefined) {
  if (!value) {
    return null;
  }
  const decoded = decodeHtml(value).trim();
  if (!decoded) {
    return null;
  }
  return decoded.startsWith("//") ? `https:${decoded}` : absoluteUrl(decoded, EN_BASE_URL);
}

function parseTitleParts(value: string) {
  const title = stripTags(value).replace(/\s*\((19|20)\d{2}\)\s*$/i, "").trim();
  const year = value.match(/\((19|20)\d{2}\)\s*$/)?.[0]?.replace(/[()]/g, "") ?? null;
  return { title, year };
}

function mediaTypeFromUrl(url: string) {
  return /\/tv\//i.test(url) ? "serial" as const : "movie" as const;
}

function slugFromUrl(url: string) {
  try {
    const parsed = new URL(url);
    const parts = parsed.pathname.split("/").filter(Boolean);
    const mediaIndex = parts.findIndex((part) => part === "movie" || part === "tv");
    if (mediaIndex >= 0) {
      return parts.slice(mediaIndex, mediaIndex + 3).join("/");
    }
  } catch {
    // Fall through to a stable text slug.
  }
  return normalizeDiscoveryText(url).replace(/\s+/g, "-");
}

function createSynovaItem(input: {
  title: string;
  detailUrl: string;
  posterUrl?: string | null;
  year?: string | null;
  sectionKey: "popular" | "newest" | "topOverall";
  index?: number;
}) {
  const mediaType = mediaTypeFromUrl(input.detailUrl);
  const slug = slugFromUrl(input.detailUrl);
  return {
    id: `synova:${slug}:${input.sectionKey}`,
    title: input.title,
    slug,
    importSlug: slug,
    provider: "synova" as const,
    mediaType,
    detailUrl: input.detailUrl,
    posterUrl: input.posterUrl ?? null,
    backdropUrl: null,
    year: input.year ?? null,
    yearLabel: input.year ?? null,
    description: null,
    genres: [],
    audioBuckets: ["all"],
    languages: [],
    network: null,
    directors: [],
    actors: [],
    sectionKeys: [input.sectionKey],
    inVault: false,
    availableNow: true,
    discoveryScore: input.index !== undefined ? Math.max(0, 1000 - input.index) : undefined,
    recommendationReasons: [],
  } satisfies ExploreItem;
}

export function parseSynovaCards(html: string, sectionKey: "popular" | "newest" | "topOverall" = "popular") {
  const articles = [...html.matchAll(/<article\b[\s\S]*?<\/article>/gi)];
  const items = articles.flatMap((articleMatch, index) => {
    const article = articleMatch[0];
    const href = article.match(/<a\b[^>]+href=["']([^"']*\/en\/(?:movie|tv)\/[^"']+)["'][^>]*>/i)?.[1];
    const rawTitle =
      article.match(/class=["'][^"']*_title[^"']*["'][^>]*title=["']([^"']+)["']/i)?.[1] ??
      article.match(/<a\b[^>]+title=["']([^"']+)["'][^>]*>/i)?.[1] ??
      article.match(/<h2\b[\s\S]*?<\/h2>/i)?.[0] ??
      "";
    if (!href || !rawTitle) {
      return [];
    }

    const { title, year } = parseTitleParts(rawTitle);
    if (!title) {
      return [];
    }

    const posterUrl = normalizeImageUrl(article.match(/<img\b[^>]+src=["']([^"']+)["']/i)?.[1]);
    return [
      createSynovaItem({
        title,
        detailUrl: absoluteUrl(href, EN_BASE_URL),
        posterUrl,
        year,
        sectionKey,
        index,
      }),
    ];
  });

  return uniqueBy(items, (item) => item.slug);
}

function getFeedUrl(feedId: SynovaFeedId) {
  if (feedId === "popular-tv") {
    return `${EN_BASE_URL}/tv-popular`;
  }
  return `${EN_BASE_URL}/movie-popular`;
}

export async function loadSynovaFeed(feedId: string, args: { cursor?: string | null; limit?: number }) {
  if (feedId !== "popular-movies" && feedId !== "popular-tv") {
    throw new Error(`Unsupported Synova feed "${feedId}".`);
  }

  const limit = Math.max(1, args.limit ?? 24);
  const page = Math.max(1, Number.parseInt(String(args.cursor ?? "1"), 10) || 1);
  const feedUrl = getFeedUrl(feedId);
  const separator = feedUrl.includes("?") ? "&" : "?";
  const { html, stale } = await cachedFetchText(`${feedUrl}${separator}page=${page}`, FEED_TTL_MS);
  const items = parseSynovaCards(html, "popular").slice(0, limit);

  return {
    generatedAt: Date.now(),
    stale,
    moduleId: "synova",
    feedId,
    items,
    continueCursor: items.length >= limit ? String(page + 1) : null,
  };
}

export async function searchSynova(query: string) {
  const normalizedQuery = query.trim();
  if (!normalizedQuery) {
    return [];
  }

  const candidates = await Promise.allSettled([
    cachedFetchText(`${EN_BASE_URL}/search/${encodeURIComponent(normalizedQuery)}`, SEARCH_TTL_MS),
    cachedFetchText(`${EN_BASE_URL}?search=${encodeURIComponent(normalizedQuery)}`, SEARCH_TTL_MS),
    cachedFetchText(`${EN_BASE_URL}?s=${encodeURIComponent(normalizedQuery)}`, SEARCH_TTL_MS),
  ]);

  const items = candidates.flatMap((candidate) => (
    candidate.status === "fulfilled" ? parseSynovaCards(candidate.value.html, "popular") : []
  ));

  return keepHighConfidenceSearchResults(
    uniqueBy(items, (item) => item.slug)
      .map((item, index) => ({
        ...item,
        matchScore: scoreSearchCandidate(query, [item.title, item.slug, item.year], index),
      }))
      .filter((item) => (item.matchScore ?? 0) > 0)
      .sort(compareSearchScores),
  ).slice(0, 12);
}
