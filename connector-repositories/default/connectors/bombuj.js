const MOVIE_BASE_URL = "https://www.bombuj.si";
const SERIES_BASE_URL = "https://serialy.bombuj.si";

function decodeHtml(value) {
  return String(value || "")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ");
}

function stripTags(value) {
  return decodeHtml(String(value || "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ")).trim();
}

function absoluteUrl(value, baseUrl) {
  try {
    return new URL(value.startsWith("//") ? `https:${value}` : value, baseUrl).toString();
  } catch {
    return value;
  }
}

function normalizeText(value) {
  return stripTags(value)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function scoreSearchCandidate(query, fields, index = 0) {
  const q = normalizeText(query);
  if (!q) return 0;
  const tokens = q.split(/\s+/).filter(Boolean);
  const haystack = fields.map(normalizeText).join(" ");
  if (!haystack) return 0;
  let score = Math.max(0, 100 - index);
  if (haystack === q) score += 500;
  if (haystack.includes(q)) score += 220;
  for (const token of tokens) {
    if (haystack.includes(token)) score += 80;
  }
  return tokens.some((token) => haystack.includes(token)) ? score : 0;
}

async function fetchText(url, init) {
  const response = await fetch(url, {
    redirect: "follow",
    ...init,
    headers: {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
      Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "Accept-Language": "sk-SK,sk;q=0.9,cs;q=0.8,en;q=0.7",
      ...(init?.headers ?? {}),
    },
  });
  if (!response.ok) {
    throw new Error(`Request failed: ${response.status} ${response.statusText} for ${url}`);
  }
  return response.text();
}

function createItem(input) {
  return {
    id: `bombuj:${input.mediaType}:${input.slug}:${input.sectionKey}`,
    title: input.title,
    slug: input.slug,
    importSlug: input.slug,
    provider: "bombuj",
    mediaType: input.mediaType,
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
    matchScore: input.matchScore,
    recommendationReasons: [],
  };
}

function parseMovieCards(html, sectionKey = "newest") {
  const matches = [...String(html || "").matchAll(
    /<a href="([^"]+online-film-[^"]+)"[^>]*>\s*(?:<div[^>]*>\s*)*<img[^>]+src="([^"]+)"[\s\S]*?<div[^>]*font-size:18px[^>]*>([\s\S]*?)<\/div>/gi,
  )];
  const items = matches.map((match, index) => {
    const detailUrl = absoluteUrl(match[1], MOVIE_BASE_URL);
    const slug = detailUrl.split("/").pop()?.replace(/^online-film-/i, "") ?? "";
    return createItem({
      title: stripTags(match[3]) || slug.replace(/-/g, " "),
      slug,
      mediaType: "movie",
      detailUrl,
      posterUrl: absoluteUrl(match[2], MOVIE_BASE_URL),
      year: slug.match(/(19|20)\d{2}/)?.[0] ?? null,
      sectionKey,
      matchScore: Math.max(0, 1000 - index),
    });
  });
  return Array.from(new Map(items.map((item) => [item.slug, item])).values());
}

function parseSeriesCards(html, sectionKey = "newest") {
  const matches = [...String(html || "").matchAll(
    /<a href="([^"]*serial-([^"#?]+)(?:#[^"]*)?)"[^>]*>[\s\S]*?<img[^>]+src="([^"]+)"[\s\S]*?<div style="float:left[^"]*?">([\s\S]*?)<\/div>/gi,
  )];
  const items = matches.map((match, index) => {
    const detailUrl = absoluteUrl(match[1], SERIES_BASE_URL);
    const slug = match[2];
    return createItem({
      title: stripTags(match[4]) || slug.replace(/-/g, " "),
      slug,
      mediaType: "serial",
      detailUrl,
      posterUrl: absoluteUrl(match[3], SERIES_BASE_URL),
      year: slug.match(/(19|20)\d{2}/)?.[0] ?? null,
      sectionKey,
      matchScore: Math.max(0, 1000 - index),
    });
  });
  return Array.from(new Map(items.map((item) => [item.slug, item])).values());
}

function parseSuggestionResults(html, baseUrl, mediaType, query) {
  const matches = [...String(html || "").matchAll(
    /<a href="([^"]+online-(?:film|serial)-[^"]+)"[^>]*>\s*<img[^>]+src="([^"]+)"[\s\S]*?<span class="nazov">([\s\S]*?)<\/span>/gi,
  )];
  return matches.map((match, index) => {
    const detailUrl = absoluteUrl(match[1], baseUrl);
    const rawSlug = detailUrl.split("/").pop() ?? "";
    const slug = rawSlug.replace(/^online-(film|serial)-/i, "");
    const rawTitle = stripTags(match[3]);
    const year = rawTitle.match(/\((19|20)\d{2}\)\s*$/)?.[0]?.replace(/[()]/g, "") ?? null;
    const title = rawTitle.replace(/\s*\((19|20)\d{2}\)\s*$/, "").trim() || slug.replace(/-/g, " ");
    return createItem({
      title,
      slug,
      mediaType,
      detailUrl,
      posterUrl: absoluteUrl(match[2], baseUrl),
      year,
      sectionKey: "newest",
      matchScore: scoreSearchCandidate(query, [title, slug, year], index),
    });
  });
}

async function searchSuggestions(query, baseUrl, mediaType) {
  const html = await fetchText(`${baseUrl}/4154q37rpc4dsvbp.php`, {
    method: "POST",
    headers: {
      Referer: `${baseUrl}/`,
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "text/html, */*;q=0.1",
      Origin: baseUrl,
      "X-Requested-With": "XMLHttpRequest",
    },
    body: `queryString=${encodeURIComponent(query)}`,
  });
  return parseSuggestionResults(html, baseUrl, mediaType, query);
}

export async function getFeed({ feedId, cursor = "0", limit = 24 }) {
  const page = Math.max(0, Number.parseInt(String(cursor ?? "0"), 10) || 0);
  const requestedLimit = Math.max(1, limit);
  const items = feedId === "latest-movies"
    ? parseMovieCards(await fetchText(`${MOVIE_BASE_URL}/zanre/obr/all.php?page=${page + 1}&sort=id&title=1&zaner=all#obrazkove-zoradenie`), "newest")
    : parseSeriesCards(await fetchText(`${SERIES_BASE_URL}/`), "novinky");
  const slice = items.slice(0, requestedLimit);
  return {
    generatedAt: Date.now(),
    stale: false,
    moduleId: "bombuj",
    feedId,
    items: slice,
    continueCursor: slice.length >= requestedLimit ? String(page + 1) : null,
  };
}

export async function search({ query }) {
  const q = String(query || "").trim();
  if (!q) return [];
  const results = await Promise.allSettled([
    searchSuggestions(q, MOVIE_BASE_URL, "movie"),
    searchSuggestions(q, SERIES_BASE_URL, "serial"),
  ]);
  return Array.from(
    new Map(
      results
        .flatMap((result) => result.status === "fulfilled" ? result.value : [])
        .filter((item) => (item.matchScore ?? 0) > 0)
        .map((item) => [`${item.mediaType}:${item.slug}`, item]),
    ).values(),
  )
    .sort((a, b) => (b.matchScore ?? 0) - (a.matchScore ?? 0))
    .slice(0, 12);
}

function candidateFromItem(item) {
  const year = item.year?.match(/\b(19|20)\d{2}\b/)?.[0] ?? item.yearLabel?.match(/\b(19|20)\d{2}\b/)?.[0];
  return {
    integrationId: "bombuj",
    providerItemId: item.importSlug || item.slug,
    mediaType: item.mediaType === "movie" ? "movie" : "series",
    title: item.title,
    year: year ? Number.parseInt(year, 10) : undefined,
    sourceUrl: item.detailUrl,
    posterUrl: item.posterUrl,
    confidenceHints: {
      normalizedTitle: normalizeText(item.title),
      releaseDate: item.year ?? item.yearLabel ?? undefined,
    },
  };
}

export const integration = {
  apiVersion: 2,
  search: async ({ query }) => (await search({ query })).map(candidateFromItem),
  getFeed: async ({ feedId, cursor, limit }) => await getFeed({ feedId, cursor, limit }),
};
