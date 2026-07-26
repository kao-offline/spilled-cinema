import type { ExploreAudioBucket, ExploreFacet, ExploreItem, ExploreSectionKey } from "../lib/types";
import { enrichArtwork, fetchTmdbMovieMetadata } from "./artwork";
import { cachedComputation, cachedFetchText, decodeHtml, normalizeDiscoveryText, stripTags, uniqueBy } from "./provider-discovery-shared";

const MOVIE_BASE_URL = "https://www.bombuj.si";
const SERIES_BASE_URL = "https://serialy.bombuj.si";
const FEED_TTL_MS = 10 * 60 * 1000;
const DETAIL_TTL_MS = 24 * 60 * 60 * 1000;
const BOMBUJ_GENRE_STOP_WORDS = new Set([
  "hbo",
  "cbs",
  "amc",
  "abc",
  "fox",
  "nbc",
  "tv",
  "hd",
  "film",
  "movie",
  "series",
]);

type BombujSectionResult = {
  items: ExploreItem[];
  genreFacets?: ExploreFacet[];
  stale: boolean;
};

function absoluteBombujUrl(url: string, baseUrl: string) {
  try {
    return new URL(url.startsWith("//") ? `https:${url}` : url, baseUrl).toString();
  } catch {
    return url;
  }
}

function parseBombujGenres(rawValue: string) {
  const stripped = rawValue
    .replace(/^\s*(?:\d{4}(?:\s*[-–/]\s*\d{4})?\s*)+/g, "")
    .trim();

  if (!stripped) {
    return [];
  }

  return uniqueBy(
    stripped
      .split(/[/,]/)
      .flatMap((part) => part.split(/\s+/))
      .map((entry) => entry.trim())
      .filter(Boolean)
      .filter((entry) => !/^\d{4}$/.test(entry))
      .filter((entry) => !BOMBUJ_GENRE_STOP_WORDS.has(normalizeDiscoveryText(entry))),
    (entry) => normalizeDiscoveryText(entry),
  );
}

function createMovieItem(input: {
  title: string;
  slug: string;
  posterUrl?: string | null;
  detailUrl?: string;
  year?: string | null;
  sectionKey: ExploreSectionKey;
}) {
  return {
    id: `bombuj-movie:${input.slug}:${input.sectionKey}`,
    title: input.title,
    slug: input.slug,
    importSlug: input.slug,
    provider: "bombuj" as const,
    mediaType: "movie" as const,
    detailUrl: input.detailUrl ?? `${MOVIE_BASE_URL}/online-film-${input.slug}`,
    posterUrl: input.posterUrl ?? null,
    year: input.year ?? null,
    yearLabel: input.year ?? null,
    genres: [],
    audioBuckets: ["all"],
    languages: [],
    directors: [],
    actors: [],
    sectionKeys: [input.sectionKey],
    inVault: false,
    availableNow: true,
  } satisfies ExploreItem;
}

function createSeriesItem(input: {
  title: string;
  slug: string;
  posterUrl?: string | null;
  detailUrl?: string;
  year?: string | null;
  sectionKey: ExploreSectionKey;
  audioBuckets?: ExploreAudioBucket[];
  episodeCode?: string | null;
  episodeImportSlug?: string | null;
}) {
  return {
    id: `bombuj-series:${input.slug}:${input.sectionKey}:${input.episodeCode ?? "title"}`,
    title: input.title,
    slug: input.slug,
    importSlug: input.episodeImportSlug ?? input.slug,
    provider: "bombuj" as const,
    mediaType: "serial" as const,
    detailUrl: input.detailUrl ?? `${SERIES_BASE_URL}/serial-${input.slug}#serial`,
    posterUrl: input.posterUrl ?? null,
    year: input.year ?? null,
    yearLabel: input.year ?? null,
    genres: [],
    audioBuckets: input.audioBuckets?.length ? input.audioBuckets : ["all"],
    languages: [],
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

export function parseBombujMovieBrowsePage(html: string, sectionKey: ExploreSectionKey) {
  const matches = [...html.matchAll(
    /<a\b[^>]*href=["']([^"']*online-film-[^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi,
  )];

  return uniqueBy(
    matches.flatMap((match) => {
      const detailUrl = absoluteBombujUrl(match[1], MOVIE_BASE_URL);
      const slug = detailUrl.split("/").pop()?.replace(/^online-film-/i, "") ?? "";
      const cardHtml = match[2] ?? "";
      const images = [...cardHtml.matchAll(/<img\b[^>]*src=["']([^"']+)["'][^>]*>/gi)];
      const cover = images.find((image) => /\/images\/covers\//i.test(image[1])) ?? images.at(-1);
      if (cover && /\/images\/slide\//i.test(cover[1])) {
        return [];
      }
      const title =
        cardHtml.match(/<div\b[^>]*font-size\s*:\s*(?:18|23)px[^>]*>([\s\S]*?)<\/div>/i)?.[1] ??
        cover?.[0].match(/\balt=["']([^"']+)["']/i)?.[1] ??
        "";
      return [createMovieItem({
        title: stripTags(title).trim() || slug.replace(/-/g, " "),
        slug,
        posterUrl: cover ? absoluteBombujUrl(cover[1], MOVIE_BASE_URL) : null,
        detailUrl,
        year: slug.match(/(19|20)\d{2}/)?.[0] ?? null,
        sectionKey,
      })];
    }),
    (item) => item.slug,
  );
}

function parseBombujNovinkyList(html: string, sectionKey: ExploreSectionKey, baseUrl: string, mediaType: "movie" | "serial") {
  const matches = [...html.matchAll(/<a href="([^"]+)"><b>([^<]+)<\/b>\s*(?:\(([^)]+)\))?/gi)];

  return uniqueBy(
    matches.map((match) => {
      const detailUrl = absoluteBombujUrl(match[1], baseUrl);
      const slug = detailUrl
        .split("/")
        .pop()
        ?.replace(/^online-film-/i, "")
        .replace(/^serial-/i, "")
        .replace(/#serial$/i, "") ?? "";

      return mediaType === "movie"
        ? createMovieItem({
            title: stripTags(match[2]).trim() || slug.replace(/-/g, " "),
            slug,
            detailUrl,
            year: match[3] ?? null,
            sectionKey,
          })
        : createSeriesItem({
            title: stripTags(match[2]).trim() || slug.replace(/-/g, " "),
            slug,
            detailUrl,
            year: match[3] ?? null,
            sectionKey,
          });
    }),
    (item) => item.slug,
  );
}

export function parseBombujSeriesCardGrid(html: string, sectionKey: ExploreSectionKey) {
  const matches = [
    ...html.matchAll(
      /<a href="([^"]*serial-([^"#?]+)(?:#[^"]*)?)"[^>]*>[\s\S]*?<img[^>]+src="([^"]+)"[\s\S]*?<div style="float:left[^"]*?">([\s\S]*?)<\/div>/gi,
    ),
  ];

  return uniqueBy(
    matches.map((match) =>
      createSeriesItem({
        title: stripTags(match[4]).trim() || match[2].replace(/-/g, " "),
        slug: match[2],
        posterUrl: absoluteBombujUrl(match[3], SERIES_BASE_URL),
        detailUrl: absoluteBombujUrl(match[1], SERIES_BASE_URL),
        year: match[2].match(/(19|20)\d{2}/)?.[0] ?? null,
        sectionKey,
      }),
    ),
    (item) => item.slug,
  );
}

export function parseBombujSeriesLatestEpisodes(html: string, audioBucket: ExploreAudioBucket) {
  const matches = [
    ...html.matchAll(
      /<a href="([^"]*\/serial\/(?:(?:([^"/]+)\/(s\d+e\d+))|([^"#?]+?)-(\d+x\d+))(?:#[^"]*)?)"[^>]*>\s*<div[^>]*class="hover_serial"[\s\S]*?<div style="float:left;overflow:hidden;height:35px;">([\s\S]*?)<\/div>/gi,
    ),
  ];

  return uniqueBy(
    matches.map((match) => {
      const slug = match[2] ?? match[4] ?? "";
      const episodeCode = match[3] ?? match[5] ?? null;
      return createSeriesItem({
        title: stripTags(match[6]).trim() || slug.replace(/-/g, " "),
        slug,
        detailUrl: `${SERIES_BASE_URL}/serial-${slug}#serial`,
        sectionKey: "latestEpisodes",
        audioBuckets: audioBucket === "all" ? ["all"] : [audioBucket],
        episodeCode,
        episodeImportSlug: episodeCode ? `${slug}-${episodeCode}` : null,
      });
    }),
    (item) => `${item.slug}:${item.episode?.episodeCode ?? "title"}`,
  );
}

export function parseBombujDetailMetadata(html: string) {
  const title =
    stripTags(html.match(/<title>([\s\S]*?)<\/title>/i)?.[1] ?? "") ||
    stripTags(html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i)?.[1] ?? "");
  const description =
    stripTags(html.match(/zdroj: csfd\.cz[\s\S]*?<br(?:\s*\/)?>\s*([\s\S]*?)<\/div>/i)?.[1] ?? "") ||
    stripTags(html.match(/<meta property="og:description"\s*content="([^"]+)"/i)?.[1] ?? "");
  const genreLine = stripTags(html.match(/<\/h1>[\s\S]*?<br>\s*([^<]+)<br>/i)?.[1] ?? "");
  const genres = parseBombujGenres(genreLine);
  const year = html.match(/\b(19|20)\d{2}(?:\s*-\s*(19|20)\d{2})?\b/)?.[0] ?? null;
  const directors = stripTags(html.match(/ReÅ¾isÃ©r:\s*<\/[^>]+>\s*([^<]+)</i)?.[1] ?? "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
  const actors = stripTags(html.match(/Herci:\s*<\/[^>]+>\s*([^<]+)</i)?.[1] ?? "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
  const posterUrl = html.match(/<meta property="og:image"\s*content="([^"]+)"/i)?.[1] ?? null;
  const bucketHints = stripTags(html).toLowerCase();
  const audioBuckets: ExploreAudioBucket[] = ["all"];
  if (bucketHints.includes("dabing")) audioBuckets.push("dubbing");
  if (bucketHints.includes("titul")) audioBuckets.push("subtitles");
  if (bucketHints.includes("bez titul")) audioBuckets.push("no_subtitles");

  return {
    title,
    description: description || null,
    genres,
    year,
    directors,
    actors,
    posterUrl: posterUrl ? absoluteBombujUrl(posterUrl, MOVIE_BASE_URL) : null,
    audioBuckets: uniqueBy(audioBuckets, (entry) => entry),
  };
}

function parseBombujSeriesGenreFacets(html: string): ExploreFacet[] {
  return uniqueBy(
    [...html.matchAll(/href="([^"]*\/zoznam-serialov\/podla-zanru\/[^"]*zaner=([^"&]+)[^"]*)"[^>]*>\s*<span[^>]*>([^<]+)<\/span>/gi)]
      .flatMap((match) => {
        const value = decodeHtml(match[2]).trim();
        const label = stripTags(match[3]).trim();
        const normalizedLabel = normalizeDiscoveryText(label);
        if (!value || !label || normalizedLabel.startsWith("vsetky serialy") || normalizedLabel.startsWith("s dabingom")) {
          return [];
        }

        return [{
          key: normalizeDiscoveryText(value),
          label,
          count: 0,
          provider: "bombuj" as const,
        } satisfies ExploreFacet];
      }),
    (entry) => `${entry.provider}:${entry.key}`,
  );
}

export async function hydrateBombujItem(item: ExploreItem) {
  return cachedComputation(`bombuj:detail:${item.mediaType}:${item.slug}`, DETAIL_TTL_MS, async () => {
    const detailUrl =
      item.mediaType === "movie"
        ? `${MOVIE_BASE_URL}/online-film-${item.slug}`
        : `${SERIES_BASE_URL}/serial-${item.slug}#serial`;
    if (item.mediaType === "movie") {
      const tmdbDetail = await fetchTmdbMovieMetadata({
        title: item.title,
        yearHint: item.year ?? undefined,
        description: item.description ?? null,
      });

      if (tmdbDetail) {
        const artwork = await enrichArtwork({
          mediaType: "movie",
          title: tmdbDetail.title || item.title,
          yearHint: tmdbDetail.year ?? item.year ?? undefined,
          description: item.description ?? null,
          currentPosterUrl: item.posterUrl ?? null,
          currentBackdropUrl: item.backdropUrl ?? null,
        });

        return {
          ...item,
          title: tmdbDetail.title || item.title,
          detailUrl,
          posterUrl: artwork.posterUrl ?? item.posterUrl ?? null,
          backdropUrl: artwork.backdropUrl ?? item.backdropUrl ?? null,
          bannerUrl: artwork.bannerUrl ?? (item as typeof item & { bannerUrl?: string | null }).bannerUrl ?? null,
          description: item.description,
          genres: tmdbDetail.genres,
          year: tmdbDetail.year ?? item.year ?? null,
          yearLabel: tmdbDetail.year ?? item.yearLabel ?? null,
          directors: tmdbDetail.directors,
          actors: tmdbDetail.actors,
          audioBuckets: uniqueBy([...item.audioBuckets], (entry) => entry),
        } satisfies ExploreItem;
      }
    }

    const { html } = await cachedFetchText(detailUrl, DETAIL_TTL_MS, {
      headers: {
        Referer: item.mediaType === "movie" ? `${MOVIE_BASE_URL}/uvodna.php` : `${SERIES_BASE_URL}/`,
      },
    });

    const artwork = await enrichArtwork({
      mediaType: item.mediaType === "movie" ? "movie" : "tv",
      title: item.title,
      yearHint: item.year ?? undefined,
      description: item.description ?? null,
      currentPosterUrl: item.posterUrl ?? null,
      currentBackdropUrl: item.backdropUrl ?? null,
    });

    const detail = parseBombujDetailMetadata(html);

    return {
      ...item,
      title: detail.title || item.title,
      detailUrl,
      posterUrl: artwork.posterUrl ?? detail.posterUrl ?? item.posterUrl ?? null,
      backdropUrl: artwork.backdropUrl ?? item.backdropUrl ?? null,
      bannerUrl: artwork.bannerUrl ?? (item as typeof item & { bannerUrl?: string | null }).bannerUrl ?? null,
      description: detail.description,
      genres: detail.genres,
      year: detail.year ?? item.year ?? null,
      yearLabel: detail.year ?? item.yearLabel ?? null,
      directors: detail.directors,
      actors: detail.actors,
      audioBuckets: uniqueBy([...item.audioBuckets, ...detail.audioBuckets], (entry) => entry),
    } satisfies ExploreItem;
  });
}

export async function getBombujMovieSections(forceFresh = false): Promise<BombujSectionResult> {
  const [{ html: latestHtml, stale: latestStale }, { html: popularHtml, stale: popularStale }, { html: todayHtml, stale: todayStale }, { html: overallHtml, stale: overallStale }, { html: genreHtml, stale: genreStale }] = await Promise.all([
    cachedFetchText(`${MOVIE_BASE_URL}/zanre/obr/all.php?page=1&sort=id&title=1&zaner=all#obrazkove-zoradenie`, FEED_TTL_MS, undefined, forceFresh),
    cachedFetchText(`${MOVIE_BASE_URL}/uvodna.php`, FEED_TTL_MS, undefined, forceFresh),
    cachedFetchText(`${MOVIE_BASE_URL}/zanre/obr/all.php?page=1&sort=todayviews&title=1&zaner=all#obrazkove-zoradenie`, FEED_TTL_MS, undefined, forceFresh),
    cachedFetchText(`${MOVIE_BASE_URL}/zanre/obr/all.php?page=1&sort=views&title=1&zaner=all#obrazkove-zoradenie`, FEED_TTL_MS, undefined, forceFresh),
    cachedFetchText(`${MOVIE_BASE_URL}/zanre/obr/`, FEED_TTL_MS, undefined, forceFresh),
  ]);

  const latest = parseBombujMovieBrowsePage(latestHtml, "newest");
  const popular = parseBombujMovieBrowsePage(popularHtml, "popular");
  const topToday = parseBombujMovieBrowsePage(todayHtml, "topToday");
  const topOverall = parseBombujMovieBrowsePage(overallHtml, "topOverall");
  const novinky = parseBombujNovinkyList(popularHtml, "novinky", MOVIE_BASE_URL, "movie");

  const genreOptions = [...genreHtml.matchAll(/zaner=([^"&]+)[^>]*>([^<]+)<\/option/gi)]
    .map((match) => ({
      value: decodeHtml(match[1]).trim(),
      label: stripTags(match[2]).trim(),
    }))
    .filter((entry) => entry.value && entry.label && !entry.label.startsWith("---"))
    .slice(0, 18);

  const genreBrowse = genreOptions.map((entry) =>
    createMovieItem({
      title: entry.label,
      slug: `genre:${normalizeDiscoveryText(entry.value)}`,
      detailUrl: `${MOVIE_BASE_URL}/zanre/obr/index.php?page=1&sort=id&title=1&zaner=${encodeURIComponent(entry.value)}#obrazkove-zoradenie`,
      sectionKey: "genreBrowse",
    }),
  );

  return {
    items: uniqueBy([...latest, ...popular, ...topToday, ...topOverall, ...novinky, ...genreBrowse], (item) => item.id),
    genreFacets: genreOptions.map((entry) => ({
      key: normalizeDiscoveryText(entry.value),
      label: entry.label,
      count: 0,
      provider: "bombuj" as const,
    })),
    stale: latestStale || popularStale || todayStale || overallStale || genreStale,
  };
}

export async function getBombujSeriesSections(forceFresh = false): Promise<BombujSectionResult> {
  const [
    { html: seriesHomeHtml, stale: seriesHomeStale },
    { html: topTodayHtml, stale: topTodayStale },
    { html: topOverallHtml, stale: topOverallStale },
    { html: latestSubsHtml, stale: latestSubsStale },
    { html: latestDubHtml, stale: latestDubStale },
    { html: latestRawHtml, stale: latestRawStale },
    { html: genreBrowseHtml, stale: genreBrowseStale },
  ] = await Promise.all([
    cachedFetchText(`${SERIES_BASE_URL}/`, FEED_TTL_MS, undefined, forceFresh),
    cachedFetchText(`${SERIES_BASE_URL}/paginate/data4.php?page=1`, FEED_TTL_MS, {
      headers: { Referer: `${SERIES_BASE_URL}/` },
    }, forceFresh),
    cachedFetchText(`${SERIES_BASE_URL}/paginate/data3.php?page=1`, FEED_TTL_MS, {
      headers: { Referer: `${SERIES_BASE_URL}/` },
    }, forceFresh),
    cachedFetchText(`${SERIES_BASE_URL}/index.php?page=1&type=2#nove`, FEED_TTL_MS, undefined, forceFresh),
    cachedFetchText(`${SERIES_BASE_URL}/index.php?page=1&type=3#nove`, FEED_TTL_MS, undefined, forceFresh),
    cachedFetchText(`${SERIES_BASE_URL}/index.php?page=1&type=4#nove`, FEED_TTL_MS, undefined, forceFresh),
    cachedFetchText(`${SERIES_BASE_URL}/zoznam-serialov/podla-zanru/`, FEED_TTL_MS, undefined, forceFresh),
  ]);

  const latestSeries = parseBombujSeriesCardGrid(seriesHomeHtml, "newest");
  const topToday = parseBombujSeriesCardGrid(topTodayHtml, "topToday");
  const topOverall = parseBombujSeriesCardGrid(topOverallHtml, "topOverall");
  const novinky = parseBombujNovinkyList(seriesHomeHtml, "novinky", SERIES_BASE_URL, "serial");
  const latestEpisodes = uniqueBy(
    [
      ...parseBombujSeriesLatestEpisodes(seriesHomeHtml, "all"),
      ...parseBombujSeriesLatestEpisodes(latestSubsHtml, "subtitles"),
      ...parseBombujSeriesLatestEpisodes(latestDubHtml, "dubbing"),
      ...parseBombujSeriesLatestEpisodes(latestRawHtml, "no_subtitles"),
    ],
    (item) => item.id,
  );

  return {
    items: uniqueBy([...latestSeries, ...topToday, ...topOverall, ...novinky, ...latestEpisodes], (item) => item.id),
    genreFacets: parseBombujSeriesGenreFacets(genreBrowseHtml),
    stale:
      seriesHomeStale ||
      topTodayStale ||
      topOverallStale ||
      latestSubsStale ||
      latestDubStale ||
      latestRawStale ||
      genreBrowseStale,
  };
}

export async function searchBombujPeople(query: string) {
  if (!query.trim()) {
    return [];
  }

  const { html } = await cachedFetchText(
    `${MOVIE_BASE_URL}/zanre/index2.php?query=${encodeURIComponent(query.trim())}`,
    FEED_TTL_MS,
  );

  return uniqueBy(
    [...html.matchAll(/<a href="([^"]+online-film-[^"]+)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?ReÅ¾isÃ©r:\s*([^<]+)[\s\S]*?Herci:\s*([^<]+)/gi)].map(
      (match) => {
        const detailUrl = absoluteBombujUrl(match[1], MOVIE_BASE_URL);
        const slug = detailUrl.split("/").pop()?.replace(/^online-film-/i, "") ?? "";
        const title = stripTags(match[2]).trim() || slug.replace(/-/g, " ");
        return {
          ...createMovieItem({
            title,
            slug,
            detailUrl,
            sectionKey: "popular",
          }),
          directors: stripTags(match[3])
            .split(",")
            .map((entry) => entry.trim())
            .filter(Boolean),
          actors: stripTags(match[4])
            .split(",")
            .map((entry) => entry.trim())
            .filter(Boolean),
        } satisfies ExploreItem;
      },
    ),
    (item) => item.slug,
  ).slice(0, 12);
}
