import type { ExploreAudioBucket, ExploreItem } from "../lib/types";
import { enrichArtwork } from "./artwork";
import { cachedComputation, cachedFetchText, normalizeDiscoveryText, stripTags, uniqueBy } from "./provider-discovery-shared";

const BASE_URLS = ["https://svetserialu.to", "https://svetserialu.io"];
const BASE_URL = BASE_URLS[0];
const FEED_TTL_MS = 10 * 60 * 1000;
const DETAIL_TTL_MS = 24 * 60 * 60 * 1000;

type SvetSectionResult = {
  items: ExploreItem[];
  stale: boolean;
};

function normalizeSvetUrl(url: string) {
  const withProtocol = url.startsWith("//") ? `https:${url}` : url;
  try {
    return new URL(withProtocol, BASE_URL).toString();
  } catch {
    return withProtocol;
  }
}

function createSvetItem(input: {
  title: string;
  slug: string;
  posterUrl?: string | null;
  detailUrl?: string;
  year?: string | null;
  sectionKey: "newest" | "latestEpisodes" | "novinky" | "genreBrowse";
  audioBuckets?: ExploreAudioBucket[];
  episodeCode?: string | null;
}) {
  return {
    id: `svet:${input.slug}:${input.sectionKey}:${input.episodeCode ?? "title"}`,
    title: input.title,
    slug: input.slug,
    importSlug: input.slug,
    provider: "svetserialu" as const,
    mediaType: "serial" as const,
    detailUrl: input.detailUrl ?? `${BASE_URL}/serial/${input.slug}`,
    posterUrl: input.posterUrl ?? null,
    year: input.year ?? null,
    yearLabel: input.year ?? null,
    genres: [],
    audioBuckets: input.audioBuckets?.length ? input.audioBuckets : ["all"],
    languages: [],
    network: null,
    directors: [],
    actors: [],
    sectionKeys: [input.sectionKey],
    inVault: false,
    availableNow: true,
    episode: input.episodeCode
      ? {
          episodeCode: input.episodeCode,
        }
      : undefined,
  } satisfies ExploreItem;
}

export function parseSvetEpisodeCards(html: string) {
  return uniqueBy(
    [...html.matchAll(/<a class="" href="\/serial\/([^"/]+)\/(s\d+e\d+)"[\s\S]*?<img src="([^"]+)" alt="([^"]+)"[\s\S]*?<span class="episode-time[^"]*">([^<]+)<\/span>/gi)].map(
      (match) => {
        const title = stripTags(match[4]).trim() || match[1].replace(/-/g, " ");
        const audioBuckets: ExploreAudioBucket[] = ["all"];
        const lower = match[0].toLowerCase();
        if (lower.includes("flagcz")) audioBuckets.push("dubbing");
        if (lower.includes("flagen")) audioBuckets.push("subtitles");
        return createSvetItem({
          title,
          slug: match[1],
          posterUrl: normalizeSvetUrl(match[3]),
          detailUrl: `${BASE_URL}/serial/${match[1]}`,
          sectionKey: "latestEpisodes",
          audioBuckets,
          episodeCode: match[2].toLowerCase(),
        });
      },
    ),
    (item) => item.id,
  );
}

export function parseSvetLatestShowsPage(html: string) {
  return uniqueBy(
    [...html.matchAll(/<a href="\/serial\/([^"]+)" class="single-resultNEW[\s\S]*?<img src="([^"]+)" alt="([^"]+)"[\s\S]*?<div class="years nunito">\s*<span>([^<]+)<\/span>[\s\S]*?<div class="langs">([\s\S]*?)<\/div>/gi)].map(
      (match) => {
        const audioBuckets: ExploreAudioBucket[] = ["all"];
        const lowerLangs = match[5].toLowerCase();
        if (lowerLangs.includes("flagcz")) audioBuckets.push("dubbing");
        if (lowerLangs.includes("flagen")) audioBuckets.push("subtitles");
        return createSvetItem({
          title: stripTags(match[3]).trim() || match[1].replace(/-/g, " "),
          slug: match[1],
          posterUrl: normalizeSvetUrl(match[2]),
          detailUrl: `${BASE_URL}/serial/${match[1]}`,
          year: stripTags(match[4]).trim(),
          sectionKey: "newest",
          audioBuckets,
        });
      },
    ),
    (item) => item.slug,
  );
}

export function parseSvetDetail(html: string) {
  const title = stripTags(html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i)?.[1] ?? "");
  const altTitle = stripTags(html.match(/<h1[^>]*>[\s\S]*?<\/h1>\s*<h2[^>]*>([\s\S]*?)<\/h2>/i)?.[1] ?? "");
  const year = html.match(/\b(19|20)\d{2}(?:\s*-\s*(19|20)\d{2})?\b/)?.[0] ?? null;
  const genres = stripTags(html.match(/<\/h1>[\s\S]*?<div class="genre[^"]*">([\s\S]*?)<\/div>/i)?.[1] ?? "")
    .split(/\s{2,}|,/)
    .map((entry) => entry.trim())
    .filter(Boolean);
  const network = stripTags(html.match(/<\/h1>[\s\S]*?<div class="channel[^"]*">([\s\S]*?)<\/div>/i)?.[1] ?? "") || null;
  const description =
    stripTags(html.match(/<div class="description[^"]*">([\s\S]*?)<\/div>/i)?.[1] ?? "") ||
    stripTags(html.match(/<meta property="og:description"\s*content="([^"]+)"/i)?.[1] ?? "");
  const posterUrl =
    normalizeSvetUrl(html.match(/<meta property="og:image"\s*content="([^"]+)"/i)?.[1] ?? "") || null;

  const lower = html.toLowerCase();
  const audioBuckets: ExploreAudioBucket[] = ["all"];
  if (lower.includes("titulky")) audioBuckets.push("subtitles");
  if (lower.includes("dabing")) audioBuckets.push("dubbing");

  return {
    title,
    altTitle: altTitle || null,
    year,
    genres,
    network,
    description: description || null,
    posterUrl,
    audioBuckets: uniqueBy(audioBuckets, (entry) => entry),
  };
}

export async function hydrateSvetItem(item: ExploreItem) {
  return cachedComputation(`svet:detail:${item.slug}`, DETAIL_TTL_MS, async () => {
    let stale = false;
    let html = "";
    for (const baseUrl of BASE_URLS) {
      try {
        const result = await cachedFetchText(`${baseUrl}/serial/${item.slug}`, DETAIL_TTL_MS, {
          headers: {
            Referer: baseUrl,
          },
        });
        html = result.html;
        stale = stale || result.stale;
        break;
      } catch {
        // Try the next host.
      }
    }

    if (!html) {
      return item;
    }

    const detail = parseSvetDetail(html);
    const artwork = await enrichArtwork({
      mediaType: "tv",
      title: detail.title || item.title,
      altTitle: detail.altTitle,
      yearHint: detail.year ?? item.year ?? undefined,
      description: detail.description,
      currentPosterUrl: detail.posterUrl ?? item.posterUrl ?? null,
      currentBackdropUrl: item.backdropUrl ?? null,
    });

    return {
      ...item,
      title: detail.title || item.title,
      posterUrl: artwork.posterUrl ?? detail.posterUrl ?? item.posterUrl ?? null,
      backdropUrl: artwork.backdropUrl ?? item.backdropUrl ?? null,
      description: detail.description,
      year: detail.year ?? item.year ?? null,
      yearLabel: detail.year ?? item.yearLabel ?? null,
      genres: detail.genres,
      network: detail.network,
      audioBuckets: uniqueBy([...item.audioBuckets, ...detail.audioBuckets], (entry) => entry),
      availableNow: true,
      matchScore: stale ? item.matchScore : item.matchScore,
    } satisfies ExploreItem;
  });
}

export async function getSvetSections(): Promise<SvetSectionResult> {
  const [{ html: homeHtml, stale: homeStale }, { html: latestShowsHtml, stale: latestShowsStale }] = await Promise.all([
    cachedFetchText(`${BASE_URL}/`, FEED_TTL_MS),
    cachedFetchText(`${BASE_URL}/zoznam-serialov?posledne-pridane=true`, FEED_TTL_MS),
  ]);

  const latestEpisodes = parseSvetEpisodeCards(homeHtml);
  const latestShows = parseSvetLatestShowsPage(latestShowsHtml);
  const novinky = latestShows.slice(0, 12).map((item) => ({
    ...item,
    id: `svet:${item.slug}:novinky`,
    sectionKeys: ["novinky" as const],
  }));

  const genreBrowse = uniqueBy(
    latestShows
      .flatMap((show) => show.genres)
      .filter(Boolean)
      .slice(0, 16)
      .map((genre) =>
        createSvetItem({
          title: genre,
          slug: `genre:${normalizeDiscoveryText(genre)}`,
          detailUrl: `${BASE_URL}/zoznam-serialov`,
          sectionKey: "genreBrowse",
        }),
      ),
    (item) => item.slug,
  );

  return {
    items: uniqueBy([...latestEpisodes, ...latestShows, ...novinky, ...genreBrowse], (item) => item.id),
    stale: homeStale || latestShowsStale,
  };
}
