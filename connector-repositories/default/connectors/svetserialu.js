const BASE_URL = "https://svetserialu.to";

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

function absoluteUrl(value, baseUrl = BASE_URL) {
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
  const html = await response.text();
  if (isLoginPage(html, response.url)) {
    throw new Error("SvetSerialu now requires login for this request.");
  }
  return html;
}

function isLoginPage(html, finalUrl) {
  const path = (() => {
    try {
      return new URL(finalUrl).pathname;
    } catch {
      return "";
    }
  })();
  return path === "/login" || /\/user\/login/i.test(html) || /class=["']login-user["']/i.test(html) || /name=["']user_pass["']/i.test(html);
}

function inferAudioBuckets(title) {
  const normalized = title.toLowerCase();
  const buckets = ["all"];
  if (/\b(tit|titul|sub|subs|subtitle)\b/i.test(normalized)) buckets.push("subtitles");
  if (/\b(dab|dabing|dub)\b/i.test(normalized)) buckets.push("dubbing");
  if (buckets.length === 1) buckets.push("subtitles");
  return buckets;
}

function slugFromUrl(url) {
  try {
    return new URL(url).pathname.split("/").filter(Boolean).pop() ?? "";
  } catch {
    return "";
  }
}

function posterFromBlock(block) {
  const value = block.match(/<img\b[^>]+(?:src|data-src)=["']([^"']+)["']/i)?.[1];
  return value ? absoluteUrl(value) : null;
}

function createItem(input) {
  return {
    id: `svetserialu:${input.slug}:${input.episodeCode ?? "show"}`,
    title: input.title,
    slug: input.slug,
    importSlug: input.slug,
    provider: "svetserialu",
    mediaType: "serial",
    detailUrl: `${BASE_URL}/serial/${input.slug}`,
    posterUrl: input.posterUrl ?? null,
    backdropUrl: null,
    year: input.year ?? null,
    yearLabel: input.year ?? null,
    description: null,
    genres: [],
    audioBuckets: inferAudioBuckets(input.title),
    languages: [],
    network: null,
    directors: [],
    actors: [],
    sectionKeys: ["latestEpisodes"],
    inVault: false,
    availableNow: true,
    matchScore: input.matchScore,
    recommendationReasons: [],
    episode: input.episodeCode ? { episodeCode: input.episodeCode } : undefined,
  };
}

function parseSerialLinks(html, query = "") {
  const matches = [...String(html || "").matchAll(/<a\b[^>]+href=["']([^"']*\/serial\/([^"'/?#]+)[^"']*)["'][^>]*>([\s\S]*?)<\/a>/gi)];
  const items = matches.flatMap((match, index) => {
    const href = absoluteUrl(match[1]);
    const slug = match[2];
    const title = stripTags(match[3]).replace(/\s*\((19|20)\d{2}\)\s*$/i, "").trim() || slug.replace(/-/g, " ");
    if (!slug || !title || title.length < 2) return [];
    const year = match[3].match(/\b(19|20)\d{2}\b/)?.[0] ?? null;
    return [createItem({
      slug,
      title,
      year,
      posterUrl: posterFromBlock(match[0]),
      matchScore: query ? scoreSearchCandidate(query, [title, slug, year], index) : undefined,
    })];
  });
  return Array.from(new Map(items.map((item) => [item.slug, item])).values());
}

function parseEpisodeCards(html) {
  const blocks = [...String(html || "").matchAll(/<article\b[\s\S]*?<\/article>|<div\b[^>]*class=["'][^"']*(?:serial|episode|item)[^"']*["'][\s\S]*?<\/div>/gi)];
  const parsed = blocks.flatMap((blockMatch, index) => {
    const block = blockMatch[0];
    const serialHref = block.match(/href=["']([^"']*\/serial\/([^"'/?#]+)[^"']*)["']/i);
    if (!serialHref) return [];
    const slug = serialHref[2];
    const title =
      stripTags(block.match(/title=["']([^"']+)["']/i)?.[1] ?? "") ||
      stripTags(block.match(/<h[1-3][^>]*>([\s\S]*?)<\/h[1-3]>/i)?.[1] ?? "") ||
      slug.replace(/-/g, " ");
    const episodeCode = block.match(/\bS\d+\s*E\d+\b/i)?.[0]?.replace(/\s+/g, "").toLowerCase() ?? null;
    return [createItem({
      slug,
      title,
      posterUrl: posterFromBlock(block),
      episodeCode,
      matchScore: Math.max(0, 1000 - index),
    })];
  });
  return Array.from(new Map(parsed.map((item) => [item.id, item])).values());
}

export async function getFeed({ feedId, cursor = "0", limit = 24 }) {
  if (feedId !== "new-episodes") {
    throw new Error(`Unsupported SvetSerialu feed "${feedId}".`);
  }
  const page = Math.max(0, Number.parseInt(String(cursor ?? "0"), 10) || 0);
  const html = await fetchText(`${BASE_URL}/?ajaxTVShows=true&page=${page}`);
  const items = parseEpisodeCards(html).slice(0, Math.max(1, limit));
  return {
    generatedAt: Date.now(),
    stale: false,
    moduleId: "svetserialu",
    feedId,
    items,
    continueCursor: items.length >= limit ? String(page + 1) : null,
  };
}

export async function search({ query }) {
  const q = String(query || "").trim();
  if (!q) return [];
  const html = await fetchText(`${BASE_URL}/?searchfor=${encodeURIComponent(q)}`);
  return parseSerialLinks(html, q)
    .filter((item) => (item.matchScore ?? 0) > 0)
    .sort((a, b) => (b.matchScore ?? 0) - (a.matchScore ?? 0))
    .slice(0, 12);
}

function candidateFromItem(item) {
  const year = item.year?.match(/\b(19|20)\d{2}\b/)?.[0] ?? item.yearLabel?.match(/\b(19|20)\d{2}\b/)?.[0];
  return {
    integrationId: "svetserialu",
    providerItemId: item.importSlug || item.slug,
    mediaType: "series",
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
