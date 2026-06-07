const BASE_URL = "https://cinenova.store";
const EN_BASE_URL = `${BASE_URL}/en`;

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

function absoluteUrl(value, baseUrl = EN_BASE_URL) {
  try {
    return new URL(value.startsWith("//") ? `https:${value}` : value, baseUrl).toString();
  } catch {
    return value;
  }
}

async function fetchText(url, init) {
  const response = await fetch(url, {
    redirect: "follow",
    ...init,
    headers: {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
      Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "Accept-Language": "en-US,en;q=0.9",
      ...(init?.headers ?? {}),
    },
  });
  if (!response.ok) {
    throw new Error(`Request failed: ${response.status} ${response.statusText} for ${url}`);
  }
  return response.text();
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
  return tokens.every((token) => haystack.includes(token)) ? score : 0;
}

function parseTitleParts(value) {
  const text = stripTags(value);
  return {
    title: text.replace(/\s*(?:\((19|20)\d{2}\)|(19|20)\d{2})\s*$/i, "").trim(),
    year: text.match(/(?:\((19|20)\d{2}\)|(19|20)\d{2})\s*$/)?.[0]?.replace(/[()]/g, "").trim() ?? null,
  };
}

function mediaTypeFromUrl(url) {
  return /\/tv\//i.test(url) ? "serial" : "movie";
}

function slugFromUrl(url) {
  const parsed = new URL(url);
  const parts = parsed.pathname.split("/").filter(Boolean);
  const mediaIndex = parts.findIndex((part) => part === "movie" || part === "tv");
  return parts.slice(mediaIndex, mediaIndex + 3).join("/");
}

function createItem(input) {
  const mediaType = mediaTypeFromUrl(input.detailUrl);
  const slug = slugFromUrl(input.detailUrl);
  return {
    id: `synova:${slug}:${input.sectionKey}`,
    title: input.title,
    slug,
    importSlug: slug,
    provider: "synova",
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
    matchScore: input.matchScore,
    discoveryScore: input.index !== undefined ? Math.max(0, 1000 - input.index) : undefined,
    recommendationReasons: [],
  };
}

function normalizeImportSlug(value) {
  const trimmed = String(value || "").trim().replace(/^\/+|\/+$/g, "");
  if (/^https?:\/\//i.test(trimmed)) {
    const parsed = new URL(trimmed);
    const parts = parsed.pathname.split("/").filter(Boolean);
    const languageIndex = parts.findIndex((part) => part === "en");
    return parts.slice(languageIndex >= 0 ? languageIndex + 1 : 0).join("/");
  }
  return trimmed.replace(/^en\//i, "");
}

function showSlugFromImportSlug(importSlug) {
  return `synova-${importSlug.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "")}`;
}

function titleFromImportSlug(importSlug) {
  return importSlug
    .split("/")
    .pop()
    ?.replace(/-/g, " ")
    .replace(/\b\w/g, (char) => char.toUpperCase())
    .trim() || "CineNova title";
}

function matchMeta(html, property) {
  return String(html || "").match(new RegExp(`<meta[^>]+(?:property|name)=["']${property}["'][^>]+content=["']([^"']*)["']`, "i"))?.[1]?.trim() ?? null;
}

function matchBackdrop(html) {
  const raw =
    String(html || "").match(/class=["']backdrop["'][^>]*style=["'][^"']*background-image:\s*url\(([^)]+)\)/i)?.[1] ??
    String(html || "").match(/mopie-modal-content[^>]*style=["'][^"']*background-image:\s*url\(([^)]+)\)/i)?.[1] ??
    null;
  return raw ? absoluteUrl(raw.replace(/^["']|["']$/g, "")) : null;
}

function parseVideoSources(html, detailUrl) {
  const players = [...String(html || "").matchAll(/<source\b[^>]+src=["']([^"']+)["'][^>]*(?:label=["']([^"']+)["'])?/gi)]
    .flatMap((match, index) => {
      const sourceUrl = match[1] ? absoluteUrl(match[1]) : null;
      return sourceUrl ? [{
        alias: `synova-source-${index}`,
        provider: "synova",
        label: match[2]?.trim() || `CineNova ${index + 1}`,
        sourcePageUrl: detailUrl,
        embedUrl: sourceUrl,
      }] : [];
    });
  return players.length > 0 ? players : [{
    alias: "synova-page",
    provider: "synova",
    label: "CineNova Page",
    sourcePageUrl: detailUrl,
    embedUrl: detailUrl,
  }];
}

function parseCards(html, sectionKey = "popular") {
  const articles = [...String(html || "").matchAll(/<article\b[\s\S]*?<\/article>/gi)];
  const items = articles.flatMap((articleMatch, index) => {
    const article = articleMatch[0];
    const href = article.match(/<a\b[^>]+href=["']([^"']*\/en\/(?:movie|tv)\/[^"']+)["'][^>]*>/i)?.[1];
    const rawTitle =
      article.match(/class=["'][^"']*_title[^"']*["'][^>]*title=["']([^"']+)["']/i)?.[1] ??
      article.match(/<a\b[^>]+title=["']([^"']+)["'][^>]*>/i)?.[1] ??
      "";
    if (!href || !rawTitle) return [];
    const { title, year } = parseTitleParts(rawTitle);
    if (!title) return [];
    return [createItem({
      title,
      detailUrl: absoluteUrl(href),
      posterUrl: absoluteUrl(article.match(/<img\b[^>]+src=["']([^"']+)["']/i)?.[1] ?? ""),
      year,
      sectionKey,
      index,
    })];
  });
  return Array.from(new Map(items.map((item) => [item.slug, item])).values());
}

function getFeedUrl(feedId) {
  if (feedId === "popular-tv") return `${EN_BASE_URL}/tv-popular`;
  return `${EN_BASE_URL}/movie-popular`;
}

export async function getFeed({ feedId, cursor = "1", limit = 24 }) {
  if (feedId !== "popular-movies" && feedId !== "popular-tv") {
    throw new Error(`Unsupported Synova feed "${feedId}".`);
  }
  const page = Math.max(1, Number.parseInt(String(cursor ?? "1"), 10) || 1);
  const feedUrl = getFeedUrl(feedId);
  const html = await fetchText(`${feedUrl}?page=${page}`);
  const items = parseCards(html, "popular").slice(0, Math.max(1, limit));
  return {
    generatedAt: Date.now(),
    stale: false,
    moduleId: "synova",
    feedId,
    items,
    continueCursor: items.length >= limit ? String(page + 1) : null,
  };
}

export async function search({ query }) {
  const q = String(query || "").trim();
  if (!q) return [];
  const pages = await Promise.allSettled([
    fetchText(`${EN_BASE_URL}/search/${encodeURIComponent(q)}`),
    fetchText(`${EN_BASE_URL}?search=${encodeURIComponent(q)}`),
    fetchText(`${EN_BASE_URL}?s=${encodeURIComponent(q)}`),
  ]);
  const items = pages.flatMap((page) => page.status === "fulfilled" ? parseCards(page.value, "popular") : []);
  return Array.from(new Map(items.map((item) => [item.slug, item])).values())
    .map((item, index) => ({
      ...item,
      matchScore: scoreSearchCandidate(q, [item.title, item.slug, item.year], index),
    }))
    .filter((item) => (item.matchScore ?? 0) > 0)
    .sort((a, b) => (b.matchScore ?? 0) - (a.matchScore ?? 0))
    .slice(0, 12);
}

export async function importItem({ slug }) {
  const importSlug = normalizeImportSlug(slug);
  if (!/^(movie|tv)\/\d+(?:\/[a-z0-9-]+)?$/i.test(importSlug)) {
    throw new Error("Provide a valid CineNova movie or TV slug.");
  }

  const detailUrl = `${EN_BASE_URL}/${importSlug}`;
  let stale = false;
  const html = await fetchText(detailUrl).catch(() => {
    stale = true;
    return "";
  });
  const rawTitle =
    stripTags(html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i)?.[1] ?? "") ||
    matchMeta(html, "og:title") ||
    titleFromImportSlug(importSlug);
  const { title, year } = parseTitleParts(rawTitle);
  const posterUrl = matchMeta(html, "og:image");
  const showSlug = showSlugFromImportSlug(importSlug);
  const importedAt = Date.now();
  const mediaType = importSlug.startsWith("tv/") ? "serial" : "movie";
  const players = stale ? [{
    alias: "synova-page",
    provider: "synova",
    label: "CineNova Page",
    sourcePageUrl: detailUrl,
    embedUrl: detailUrl,
  }] : parseVideoSources(html, detailUrl);
  const episode = {
    id: `${showSlug}:s1e1`,
    showSlug,
    showTitle: title || showSlug,
    posterUrl: posterUrl ? absoluteUrl(posterUrl) : undefined,
    seasonNumber: 1,
    episodeNumber: 1,
    episodeCode: mediaType === "movie" ? "movie" : "s1e1",
    episodeTitle: title || null,
    episodeUrl: detailUrl,
    players,
    selectedPlayerAlias: players[0]?.alias ?? "synova-page",
    importedAt,
  };

  return {
    slug: showSlug,
    title: title || showSlug,
    altTitle: null,
    description: matchMeta(html, "og:description"),
    years: year,
    posterUrl: posterUrl ? absoluteUrl(posterUrl) : null,
    backdropUrl: matchBackdrop(html),
    clearLogoUrl: null,
    availableSeasons: [1],
    importedAt,
    episodes: [episode],
  };
}

function candidateFromItem(item) {
  const year = item.year?.match(/\b(19|20)\d{2}\b/)?.[0];
  return {
    integrationId: "synova",
    providerItemId: item.importSlug || item.slug,
    mediaType: item.mediaType === "movie" ? "movie" : "series",
    title: item.title,
    year: year ? Number.parseInt(year, 10) : undefined,
    sourceUrl: item.detailUrl,
    posterUrl: item.posterUrl,
    confidenceHints: {
      normalizedTitle: normalizeText(item.title),
      releaseDate: item.year ?? undefined,
    },
  };
}

export const integration = {
  apiVersion: 2,
  search: async ({ query }) => (await search({ query })).map(candidateFromItem),
  getFeed: async ({ feedId, cursor, limit }) => await getFeed({ feedId, cursor, limit }),
  importFallback: async ({ slug }) => await importItem({ slug }),
  resolvePlayers: async ({ providerMatch }) => {
    if (!providerMatch?.providerItemId) return [];
    const show = await importItem({ slug: providerMatch.providerItemId });
    return show.episodes.flatMap((episode) => episode.players.map((player) => ({
      integrationId: "synova",
      label: player.label,
      language: player.language,
      url: player.embedUrl,
      type: "embed",
    })));
  },
};
