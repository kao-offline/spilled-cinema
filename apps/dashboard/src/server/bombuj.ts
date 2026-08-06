import type { ImportedShow, LibraryEpisode, PlayerAlias } from "../lib/types";
import { enrichArtwork } from "./artwork";
import { searchExternalTitles, type ExternalTitleCandidate } from "./external-title-search";
import {
  compareSearchScores,
  hasRequiredSearchTokenCoverage,
  hasSignificantSearchTokenMatch,
  keepHighConfidenceSearchResults,
  normalizeSearchText,
  scoreSearchCandidate,
} from "../lib/search-ranking";

const MOVIE_BASE_URL = "https://www.bombuj.si";
const SERIES_BASE_URL = "https://serialy.bombuj.si";
const BASE_URL = MOVIE_BASE_URL;
const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36";

function decodeHtml(value: string) {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ");
}

function stripTags(value: string) {
  return decodeHtml(value.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ")).trim();
}

function normalizeSearchTitle(value: string) {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[\s_-]+/g, " ")
    .replace(/[^a-z0-9 ]+/g, "")
    .trim();
}

function isBombujHelperSubtitle(value: string) {
  const normalized = normalizeSearchTitle(value);
  if (!normalized) {
    return true;
  }

  return (
    normalized === "ako spustit video" ||
    normalized.startsWith("ako spustit video ") ||
    normalized === "jak spustit video" ||
    normalized.startsWith("jak spustit video ")
  );
}

type CsfdMovieMeta = {
  year: string | null;
  rating: number | null;
  description: string | null;
  url: string | null;
};

async function fetchCsfdMovieMeta(title: string, yearHint?: string | null): Promise<CsfdMovieMeta | null> {
  try {
    const csfdModule = (await import("node-csfd-api")) as {
      csfd?: {
        search: (text: string, options?: Record<string, unknown>) => Promise<{
          movies?: Array<{ id: number; title?: string; year?: string | number }>;
          tvSeries?: Array<{ id: number; title?: string; year?: string | number }>;
        }>;
        movie: (id: number, options?: Record<string, unknown>) => Promise<{
          year?: string | number;
          rating?: number;
          descriptions?: string[];
          url?: string;
        }>;
      };
    };

    const api = csfdModule.csfd;
    if (!api?.search || !api?.movie) {
      return null;
    }

    const normalizedQuery = normalizeSearchTitle(title);
    if (!normalizedQuery) {
      return null;
    }

    const search = await api.search(title, { language: "cs" });
    const candidates = [...(search.movies ?? []), ...(search.tvSeries ?? [])]
      .filter((entry) => typeof entry.id === "number")
      .map((entry) => {
        const candidateTitle = normalizeSearchTitle(entry.title ?? "");
        const candidateYear = entry.year ? String(entry.year) : null;
        let score = 0;
        if (candidateTitle === normalizedQuery) score += 100;
        if (candidateTitle.includes(normalizedQuery) || normalizedQuery.includes(candidateTitle)) score += 40;
        if (yearHint && candidateYear === yearHint) score += 30;
        return { id: entry.id, score };
      })
      .sort((a, b) => b.score - a.score);

    const best = candidates[0];
    if (!best || best.score <= 0) {
      return null;
    }

    const detail = await api.movie(best.id, { language: "cs" });
    const year = detail.year ? String(detail.year) : null;
    const rating = Number.isFinite(detail.rating) ? Number(detail.rating) : null;
    const description = Array.isArray(detail.descriptions)
      ? detail.descriptions.find((text) => typeof text === "string" && text.trim().length > 0) ?? null
      : null;

    return {
      year,
      rating,
      description,
      url: detail.url ?? null,
    };
  } catch {
    return null;
  }
}

function matchOne(html: string, pattern: RegExp) {
  const match = html.match(pattern);
  return match?.[1]?.trim() ?? null;
}

async function fetchText(url: string, options?: RequestInit) {
  const response = await fetch(url, {
    redirect: "follow",
    ...options,
    headers: {
      "User-Agent": USER_AGENT,
      Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "Accept-Language": "cs-CZ,cs;q=0.9,en;q=0.8",
      Referer: BASE_URL,
      ...options?.headers
    },
  });

  if (!response.ok) {
    throw new Error(`Request failed: ${response.status} ${response.statusText} for ${url}`);
  }

  return response.text();
}

async function fetchBombujSuggestionResults(
  query: string,
  siteBaseUrl: string,
): Promise<
  {
    title: string;
    slug: string;
    platform: "bombuj";
    posterUrl?: string | null;
    mediaType?: "movie" | "serial";
    year?: string | null;
  }[]
> {
  const host = new URL(siteBaseUrl).host;
  const responseHtml = await fetchText(`${siteBaseUrl}/4154q37rpc4dsvbp.php`, {
    method: "POST",
    headers: {
      Referer: `${siteBaseUrl}/`,
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "text/html, */*;q=0.1",
      Origin: siteBaseUrl,
    },
    body: `queryString=${encodeURIComponent(query)}`,
  });

  const mediaType = host.startsWith("serialy.") ? ("serial" as const) : ("movie" as const);
  const matches = [
    ...responseHtml.matchAll(
      /<a href="([^"]+(?:online-(?:film|serial)-|serial-)[^"]+)"[^>]*>(?:\s*<img[^>]+src="([^"]*)"[^>]*>)?\s*<span class="nazov">([\s\S]*?)<\/span>(?:\s*<span class="zanre">([\s\S]*?)<\/span>)?/gi,
    ),
  ];

  return matches.map((match) => {
    const href = match[1].trim();
    const posterSrc = match[2]?.trim() ?? "";
    const rawTitle = stripTags(match[3]).trim();
    const zanreText = stripTags(match[4] ?? "").trim();
    const normalizedHref = href.startsWith("//") ? `https:${href}` : href;
    const slug = normalizedHref.split("/").pop() ?? "";
    const cleanSlug = slug.replace(/^(?:online-(?:film|serial)-|serial-)/i, "").replace(/#.*$/, "");
    const yearMatch = rawTitle.match(/\((19|20)\d{2}\)\s*$/) ?? zanreText.match(/^((?:19|20)\d{2})/);
    const title = rawTitle.replace(/\s*\((19|20)\d{2}\)\s*$/, "").trim();

    return {
      title: title || cleanSlug.replace(/-/g, " "),
      slug: cleanSlug,
      platform: "bombuj" as const,
      posterUrl: posterSrc ? (posterSrc.startsWith("//") ? `https:${posterSrc}` : posterSrc) : null,
      mediaType,
      year: yearMatch ? yearMatch[1].replace(/[()]/g, "") : null,
    };
  });
}

function absoluteBombujUrl(url: string, baseUrl: string) {
  try {
    return new URL(url, baseUrl).toString();
  } catch {
    return url;
  }
}

function normalizeBombujLink(rawLink: string, baseUrl: string) {
  const decoded = decodeHtml(rawLink).trim();
  if (!decoded) {
    return "";
  }
  const withProtocol = decoded.startsWith("//") ? `https:${decoded}` : decoded;
  return absoluteBombujUrl(withProtocol, baseUrl);
}

function extractSubtitleUrlFromEmbedUrl(embedUrl: string) {
  try {
    const parsed = new URL(embedUrl);
    for (let index = 1; index <= 8; index += 1) {
      const file = parsed.searchParams.get(`c${index}_file`);
      if (!file?.trim()) continue;
      const subtitleUrl = new URL(file, parsed).toString();
      if (/^https?:\/\//i.test(subtitleUrl)) {
        return subtitleUrl;
      }
    }
  } catch {
    return null;
  }
  return null;
}

function extractIframeSrc(html: string) {
  const direct = html.match(/<iframe[^>]+src=["']([^"']+)["']/i)?.[1];
  if (direct) {
    return direct;
  }

  const injected = html.match(/\.html\(\s*'([\s\S]+?)'\s*\)/i)?.[1];
  if (injected) {
    const unescaped = decodeHtml(injected)
      .replace(/\\\//g, "/")
      .replace(/\\'/g, "'")
      .replace(/\\"/g, '"');
    const injectedSrc = unescaped.match(/<iframe[^>]+src=["']([^"']+)["']/i)?.[1];
    if (injectedSrc) {
      return injectedSrc;
    }
  }

  return null;
}

function isVipGateHtml(html: string) {
  const normalized = html.toLowerCase();
  return (
    normalized.includes("vip už") ||
    normalized.includes("vip uz") ||
    normalized.includes("dostupny len pre vip") ||
    normalized.includes("dostupný len pre vip")
  );
}

async function fetchPlayerHtmlWithFallback(
  url: string,
  sourcePageUrl: string,
  siteBaseUrl: string,
  headers: Record<string, string>,
) {
  const primary = await fetchText(url, {
    headers: {
      ...headers,
      Referer: sourcePageUrl,
    },
  }).catch(() => "");

  if (!primary) {
    return "";
  }

  // Some Bombuj wrappers respond with VIP gating depending on Referer; retry via site root.
  if (extractIframeSrc(primary) || !isVipGateHtml(primary)) {
    return primary;
  }

  const fallback = await fetchText(url, {
    headers: {
      ...headers,
      Referer: siteBaseUrl,
    },
  }).catch(() => "");

  return fallback || primary;
}

async function resolveBombujPlayerUrl(
  rawLink: string,
  sourcePageUrl: string,
  siteBaseUrl: string,
  headers: Record<string, string>,
  maxDepth = 3,
): Promise<string | null> {
  let currentUrl = normalizeBombujLink(rawLink, siteBaseUrl);
  if (!currentUrl) {
    return rawLink;
  }

  for (let depth = 0; depth < maxDepth; depth += 1) {
    const html = await fetchPlayerHtmlWithFallback(currentUrl, sourcePageUrl, siteBaseUrl, headers);

    if (!html) {
      return currentUrl;
    }

    const iframeSrc = extractIframeSrc(html);
    if (!iframeSrc) {
      // Bombuj sometimes leaves old server rows in the movie page even though
      // their wrapper now contains only the VIP gate. Those rows have no media
      // behind them and must not be exposed as playable sources.
      if (isVipGateHtml(html)) {
        return null;
      }
      return currentUrl;
    }

    const resolved = normalizeBombujLink(iframeSrc, currentUrl);
    if (!resolved) {
      return currentUrl;
    }

    const host = (() => {
      try {
        return new URL(resolved).hostname.toLowerCase();
      } catch {
        return "";
      }
    })();

    // Exit when we got a non-Bombuj host so the app embeds the actual provider directly.
    if (!/(^|\.)bombuj\.si$/i.test(host)) {
      return resolved;
    }

    currentUrl = resolved;
  }

  return currentUrl;
}

async function buildBombujPlayer(
  rawLink: string,
  providerDomain: string,
  language: string,
  playerIndex: number,
  sourcePageUrl: string,
  siteBaseUrl: string,
  headers: Record<string, string>,
) {
  const isExternal = /primewire|byse|mixdrop|voe|embed|netu/i.test(providerDomain) &&
    !/multiembed|2embed|movies/i.test(providerDomain);
  const isPremium = /vidlink|vidstream|vidsrc|multiembed|2embed|movies/i.test(providerDomain);
  const normalizedLink = normalizeBombujLink(rawLink, siteBaseUrl);
  const finalEmbed = normalizedLink
    ? await resolveBombujPlayerUrl(normalizedLink, sourcePageUrl, siteBaseUrl, headers)
    : rawLink;
  if (!finalEmbed) {
    return null;
  }
  const subtitlesUrl =
    extractSubtitleUrlFromEmbedUrl(finalEmbed) ??
    extractSubtitleUrlFromEmbedUrl(normalizedLink || rawLink) ??
    undefined;

  return {
    alias: `bombuj-${playerIndex}` as PlayerAlias,
    provider: providerDomain,
    label: `${providerDomain.toUpperCase()}${isPremium ? " ⭐" : ""}${isExternal ? " EX" : ""}`,
    language,
    sourcePageUrl,
    embedUrl: finalEmbed,
    subtitlesUrl,
    resolutionStatus: "unresolved" as const,
  };
}

function isLikelyBlockedProvider(provider: string) {
  return /^(byse\.sx|mixdrop\.co|voe2\.sx)$/i.test(provider.trim());
}

function providerScore(player: { provider: string; label: string }) {
  const premium = player.label.includes("⭐") ? 100 : 0;
  const blockedPenalty = isLikelyBlockedProvider(player.provider) ? -1000 : 0;
  return premium + blockedPenalty;
}

type BombujEpisodeSlug = {
  showSlug: string;
  episodeCode: string;
  seasonNumber: number;
  episodeNumber: number;
};

function parseBombujEpisodeSlug(slug: string): BombujEpisodeSlug | null {
  const normalized = slug
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\/serialy\.bombuj\.si\/serial\//i, "")
    .replace(/#.*$/, "")
    .replace(/\/$/, "");
  const slashEpisode = normalized.match(/^(.+)\/s(\d+)e(\d+)$/i);
  if (slashEpisode) {
    return {
      showSlug: slashEpisode[1],
      episodeCode: `s${slashEpisode[2]}e${slashEpisode[3]}`,
      seasonNumber: Number.parseInt(slashEpisode[2], 10),
      episodeNumber: Number.parseInt(slashEpisode[3], 10),
    };
  }

  const suffixedEpisode = normalized.match(/^(.+)-s(\d+)e(\d+)$/i);
  if (suffixedEpisode) {
    return {
      showSlug: suffixedEpisode[1],
      episodeCode: `s${suffixedEpisode[2]}e${suffixedEpisode[3]}`,
      seasonNumber: Number.parseInt(suffixedEpisode[2], 10),
      episodeNumber: Number.parseInt(suffixedEpisode[3], 10),
    };
  }

  const xEpisode = normalized.match(/^(.+)-(\d+)x(\d+)$/i);
  if (xEpisode) {
    return {
      showSlug: xEpisode[1],
      episodeCode: `${xEpisode[2]}x${xEpisode[3]}`,
      seasonNumber: Number.parseInt(xEpisode[2], 10),
      episodeNumber: Number.parseInt(xEpisode[3], 10),
    };
  }

  return null;
}

async function extractBombujPlayersFromHtml(
  html: string,
  sourcePageUrl: string,
  siteBaseUrl: string,
  headers: Record<string, string>,
  fallbackLanguage = "Unknown Lang",
) {
  const players: LibraryEpisode["players"] = [];
  let playerIndex = 0;

  const addServer = async (rawLink: string, label: string, language: string) => {
    const providerDomain = stripTags(label).trim().toLowerCase();
    if (!rawLink || !providerDomain) {
      return;
    }

    const player = await buildBombujPlayer(
      rawLink,
      providerDomain,
      language,
      playerIndex,
      sourcePageUrl,
      siteBaseUrl,
      headers,
    );
    if (!player) {
      return;
    }
    players.push(player);
    playerIndex++;
  };

  const dataMatch = html.match(/url:\s*'prehravace_ajax\.php'[\s\S]*?data:\s*({[\s\S]*?}),\s*success:/i);
  if (dataMatch) {
    const params = new URLSearchParams();
    const kvMatches = dataMatch[1].matchAll(/([a-z_]+):\s*'([^']*)'/g);
    for (const m of kvMatches) {
      params.append(m[1], m[2]);
    }

    const ajaxUrl = `${siteBaseUrl}/prehravace_ajax.php?${params.toString()}`;
    const ajaxHtml = await fetchText(ajaxUrl, {
      headers: { ...headers, "X-Requested-With": "XMLHttpRequest", Referer: sourcePageUrl },
    }).catch(() => "");

    const languageBlocksArr = ajaxHtml.split(/<div class="dropdownlink">/gi).slice(1);
    if (languageBlocksArr.length === 0) {
      const servers = [...ajaxHtml.matchAll(/<li[^>]*link="([^"]+)"[^>]*>[\s\S]*?<a[^>]*>([^<]+)<\/a>/gi)];
      for (const server of servers) {
        await addServer(server[1], server[2], fallbackLanguage);
      }
    } else {
      for (const block of languageBlocksArr) {
        const langMatch = block.match(/<img[^>]+cflag[^>]*>([^<]+)/i);
        const fallbackMatch = block.match(/^([\s\S]*?)<\/div>/i);
        const language = langMatch
          ? stripTags(langMatch[1]).trim()
          : fallbackMatch
            ? stripTags(fallbackMatch[1]).trim()
            : fallbackLanguage;
        const servers = [...block.matchAll(/<li[^>]*link="([^"]+)"[^>]*>[\s\S]*?<a[^>]*>([^<]+)<\/a>/gi)];
        for (const server of servers) {
          await addServer(server[1], server[2], language || fallbackLanguage);
        }
      }
    }
  }

  const directServers = [...html.matchAll(/<li[^>]*link="([^"]+)"[^>]*>[\s\S]*?<a[^>]*>([^<]+)<\/a>/gi)];
  for (const server of directServers) {
    const normalized = normalizeBombujLink(server[1], siteBaseUrl);
    if (!players.some((player) => normalizeBombujLink(player.embedUrl, siteBaseUrl) === normalized)) {
      await addServer(server[1], server[2], fallbackLanguage);
    }
  }

  return players.sort((a, b) => providerScore(b) - providerScore(a));
}

async function removeUnavailableBombujAggregators(
  players: LibraryEpisode["players"],
  sourcePageUrl: string,
) {
  const aggregatorPattern = /^(?:vidsrc|vidlink|primewire|vidstream|multiembed|2embed|moviesclub)$/i;
  const checks = await Promise.all(players.map(async (player) => {
    if (!aggregatorPattern.test(player.provider ?? "")) {
      return true;
    }

    try {
      const { resolvePlaybackStream } = await import("./full-download");
      const resolution = resolvePlaybackStream({
        episodeId: `bombuj-preflight-${player.alias}`,
        activePlayerAlias: player.alias,
        players: [{ ...player, sourcePageUrl }],
      }).then(() => true, () => false);
      return await Promise.race([
        resolution,
        new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 12_000)),
      ]);
    } catch {
      return false;
    }
  }));

  return players.filter((_player, index) => checks[index]);
}

function parseBombujSerialEpisodeList(html: string, seasonNumber: number) {
  const results: Array<{
    episodeUrl: string;
    seasonNumber: number;
    episodeNumber: number;
    episodeCode: string;
    language: string;
  }> = [];

  for (const match of html.matchAll(/<a\s+href='([^']*)'[^>]*>([\s\S]*?)<\/a>/gi)) {
    const href = match[1]?.trim();
    if (!href || !/\/serial\//i.test(href)) {
      continue;
    }
    const parsed = parseBombujEpisodeSlug(href);
    if (!parsed || parsed.seasonNumber !== seasonNumber || !Number.isFinite(parsed.episodeNumber)) {
      continue;
    }
    const block = match[2] ?? "";
    const language = stripTags(
      block.match(/<div[^>]*float:right[^>]*>([\s\S]*?)<\/div>/i)?.[1] ?? "",
    ).trim() || "Unknown Lang";

    results.push({
      episodeUrl: absoluteBombujUrl(href, SERIES_BASE_URL),
      seasonNumber: parsed.seasonNumber,
      episodeNumber: parsed.episodeNumber,
      episodeCode: `s${parsed.seasonNumber}e${parsed.episodeNumber}`,
      language,
    });
  }

  return results;
}

async function fetchBombujSerial(rawSlug: string): Promise<ImportedShow> {
  const serialPageUrl = `${SERIES_BASE_URL}/serial-${rawSlug}`;
  const headers = { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0" };
  const html = await fetchText(serialPageUrl, { headers }).catch(() => "");
  if (!html) {
    throw new Error(`Failed to fetch Bombuj serial page for "${rawSlug}".`);
  }

  const title = stripTags(matchOne(html, /<h1[^>]*>([\s\S]*?)<\/h1>/i) ?? rawSlug);
  const rawAltTitle = stripTags(matchOne(html, /<h2[^>]*>([\s\S]*?)<\/h2>/i) ?? "");
  const altTitle = isBombujHelperSubtitle(rawAltTitle) ? "" : rawAltTitle;
  const description = stripTags(matchOne(html, /<div class="desc"[^>]*>([\s\S]*?)<\/div>/i) ?? "");
  let posterUrl = matchOne(html, /<meta property="og:image"\s*content="([^"]+)"/i) ?? null;
  const yearHint = title.match(/\b(19\d{2}|20\d{2})\b/)?.[1] ?? altTitle.match(/\b(19\d{2}|20\d{2})\b/)?.[1] ?? null;
  const csfdMeta = await fetchCsfdMovieMeta(title, yearHint);

  if (posterUrl) {
    if (posterUrl.startsWith("//")) {
      posterUrl = `https:${posterUrl}`;
    } else if (!posterUrl.startsWith("http")) {
      posterUrl = `${SERIES_BASE_URL}${posterUrl}`;
    }
  }

  const seasonNumbers = [...new Set(
    [...html.matchAll(/epizody\/ajax2\.php\?[^"'\s]*seria=(\d+)/gi)]
      .map((match) => Number.parseInt(match[1], 10)),
  )].filter(Number.isFinite).sort((a, b) => a - b);
  if (seasonNumbers.length === 0) {
    throw new Error(`No Bombuj season lists found for "${rawSlug}".`);
  }

  const episodesBySeason = await mapWithConcurrency(seasonNumbers, 3, async (seasonNumber) => {
    const listHtml = await fetchText(
      `${SERIES_BASE_URL}/epizody/ajax2.php?url=${encodeURIComponent(rawSlug)}&seria=${seasonNumber}`,
      { headers: { ...headers, Referer: serialPageUrl, "X-Requested-With": "XMLHttpRequest" } },
    ).catch(() => "");
    return listHtml ? parseBombujSerialEpisodeList(listHtml, seasonNumber) : [];
  });

  const importedAt = Date.now();
  const resolvedEpisodes = await mapWithConcurrency(episodesBySeason.flat(), 3, async (episode) => {
    let players: LibraryEpisode["players"] = [];
    try {
      const episodeHtml = await fetchText(episode.episodeUrl, {
        headers: { ...headers, Referer: serialPageUrl },
      }).catch(() => "");
      if (episodeHtml) {
        players = await extractBombujPlayersFromHtml(episodeHtml, episode.episodeUrl, SERIES_BASE_URL, headers, episode.language);
      }
    } catch {
      players = [];
    }

    if (players.length === 0) {
      players.push({
        alias: "bombuj-native" as PlayerAlias,
        provider: "bombuj-native",
        label: "Bombuj Native",
        sourcePageUrl: episode.episodeUrl,
        embedUrl: episode.episodeUrl,
        resolutionStatus: "failed",
        resolutionError: "No external Bombuj player links could be extracted for this episode.",
      });
    }

    return {
      id: `bombuj:${rawSlug}:${episode.episodeCode}`,
      showSlug: rawSlug,
      showTitle: title,
      posterUrl: posterUrl || undefined,
      seasonNumber: episode.seasonNumber,
      episodeNumber: episode.episodeNumber,
      episodeCode: episode.episodeCode,
      episodeTitle: null,
      episodeUrl: episode.episodeUrl,
      players,
      selectedPlayerAlias: players[0].alias,
      importedAt,
    } satisfies LibraryEpisode;
  });

  resolvedEpisodes.sort((a, b) =>
    (a.seasonNumber - b.seasonNumber) || (a.episodeNumber ?? 0) - (b.episodeNumber ?? 0),
  );
  if (resolvedEpisodes.length === 0) {
    throw new Error(`No Bombuj episodes found for serial "${rawSlug}".`);
  }

  const normalizedDescription = description || csfdMeta?.description || null;
  const yearText = csfdMeta?.year ?? yearHint ?? null;
  const yearWithRating = yearText
    ? `${yearText}${csfdMeta?.rating !== null && csfdMeta?.rating !== undefined ? ` - CSFD ${csfdMeta.rating}%` : ""}`
    : (csfdMeta?.rating !== null && csfdMeta?.rating !== undefined ? `CSFD ${csfdMeta.rating}%` : null);
  const artwork = await enrichArtwork({
    mediaType: "tv",
    title,
    altTitle: altTitle || null,
    yearHint: yearHint ?? undefined,
    description: normalizedDescription || null,
    currentPosterUrl: posterUrl,
  });

  return {
    slug: `bombuj-${rawSlug}`,
    title,
    altTitle: altTitle || null,
    description: normalizedDescription,
    years: yearWithRating,
    posterUrl: artwork.posterUrl ?? posterUrl,
    backdropUrl: artwork.backdropUrl ?? null,
    bannerUrl: artwork.bannerUrl ?? null,
    bannerWithLogoUrl: artwork.bannerWithLogoUrl ?? null,
    clearLogoUrl: artwork.clearLogoUrl ?? null,
    availableSeasons: [...new Set(resolvedEpisodes.map((episode) => episode.seasonNumber))].sort((a, b) => a - b),
    importedAt,
    mediaType: "serial",
    episodes: resolvedEpisodes,
  };
}

/**
 * Basic Bombuj Extractor Skeleton 
 * NOTE: Bombuj leverages anti-bot mechanics. This initial scraper creates a skeleton implementation.
 */
export async function fetchBombujMovie(slug: string, mediaType?: "movie" | "serial"): Promise<ImportedShow> {
  const isDirectUrl = slug.startsWith("http");
  const episodePart = mediaType === "serial" ? parseBombujEpisodeSlug(slug) : null;
  const isSerial = mediaType === "serial" || slug.includes("serial") || Boolean(episodePart);
  const rawSlug = (episodePart?.showSlug ?? slug)
    .replace(/^online-(serial|film)-/, "")
    .replace(/^serial-/, "");

  if (isSerial && !episodePart && !isDirectUrl) {
    return await fetchBombujSerial(rawSlug);
  }

  const siteBaseUrl = isSerial ? SERIES_BASE_URL : MOVIE_BASE_URL;
  const movieUrl = isDirectUrl
    ? slug
    : episodePart
      ? `${SERIES_BASE_URL}/serial/${rawSlug}-${episodePart.seasonNumber}x${episodePart.episodeNumber}`
      : isSerial
        ? `${SERIES_BASE_URL}/serial-${rawSlug}#serial`
        : `${MOVIE_BASE_URL}/online-film-${rawSlug}`;
  
  const headers = { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0" };
  const html = await fetchText(movieUrl, { headers }).catch(() => "");
  
  if (!html) {
      throw new Error(`Failed to fetch DOM from Bombuj correctly.`);
  }

  const title = stripTags(matchOne(html, /<h1[^>]*>([\s\S]*?)<\/h1>/i) ?? rawSlug);
  const rawAltTitle = stripTags(matchOne(html, /<h2[^>]*>([\s\S]*?)<\/h2>/i) ?? "");
  const altTitle = isBombujHelperSubtitle(rawAltTitle) ? "" : rawAltTitle;
  const description = stripTags(matchOne(html, /<div class="desc"[^>]*>([\s\S]*?)<\/div>/i) ?? "");
  let posterUrl = matchOne(html, /<meta property="og:image"\s*content="([^"]+)"/i) ?? null;
  const yearHint = (title.match(/\b(19\d{2}|20\d{2})\b/)?.[1] ?? altTitle.match(/\b(19\d{2}|20\d{2})\b/)?.[1] ?? null);
  const csfdMeta = await fetchCsfdMovieMeta(title, yearHint);

  if (posterUrl) {
     if (posterUrl.startsWith("//")) {
         posterUrl = `https:${posterUrl}`;
     } else if (!posterUrl.startsWith("http")) {
         posterUrl = `${siteBaseUrl}${posterUrl}`;
     }
  }

  // Attempt global language detection from the main page DOM
  let globalLanguage = "Unknown Lang";
  const globalLangMatch = html.match(/<img[^>]+cflag[^>]*>([^<]+)/i);
  if (globalLangMatch) {
      globalLanguage = stripTags(globalLangMatch[1]).trim() || "Unknown Lang";
  }

  const extractedPlayers = await extractBombujPlayersFromHtml(html, movieUrl, siteBaseUrl, headers, globalLanguage);
  const players = await removeUnavailableBombujAggregators(extractedPlayers, movieUrl);

  if (players.length === 0) {
      players.push({
          alias: "bombuj-native" as PlayerAlias,
          provider: "bombuj-native",
          label: "Bombuj Native",
          sourcePageUrl: movieUrl,
          embedUrl: movieUrl,
          resolutionStatus: "failed",
          resolutionError: "No external Bombuj player links could be extracted for this title.",
      });
  }

  const importedAt = Date.now();

  const episode: LibraryEpisode = {
     id: `bombuj:${rawSlug}:${episodePart?.episodeCode ?? (isSerial ? "serial" : "movie")}`,
     showSlug: rawSlug,
     showTitle: title,
     posterUrl: posterUrl || undefined,
     seasonNumber: episodePart?.seasonNumber ?? 1,
     episodeNumber: episodePart?.episodeNumber ?? 1,
     episodeCode: episodePart?.episodeCode ?? (isSerial ? null : "movie"),
     episodeTitle: title,
     episodeUrl: movieUrl,
     players,
      selectedPlayerAlias: players[0].alias,
     importedAt
  };

  const normalizedDescription = description || csfdMeta?.description || null;
  const yearText = csfdMeta?.year ?? yearHint ?? null;
  const yearWithRating = yearText
    ? `${yearText}${csfdMeta?.rating !== null && csfdMeta?.rating !== undefined ? ` - CSFD ${csfdMeta.rating}%` : ""}`
    : (csfdMeta?.rating !== null && csfdMeta?.rating !== undefined ? `CSFD ${csfdMeta.rating}%` : null);
  const artwork = await enrichArtwork({
    mediaType: isSerial ? "tv" : "movie",
    title,
    altTitle: altTitle || null,
    yearHint: yearHint ?? undefined,
    description: normalizedDescription || null,
    currentPosterUrl: posterUrl,
  });

  return {
    slug: `bombuj-${rawSlug}`,
    title,
    altTitle: altTitle || null,
    description: normalizedDescription,
    years: yearWithRating,
    posterUrl: artwork.posterUrl ?? posterUrl,
    backdropUrl: artwork.backdropUrl ?? null,
    bannerUrl: artwork.bannerUrl ?? null,
    clearLogoUrl: artwork.clearLogoUrl ?? null,
    availableSeasons: [episodePart?.seasonNumber ?? 1],
    importedAt,
    mediaType: isSerial ? "serial" : "movie",
    episodes: [episode]
  };
}

export type BombujSearchResult = {
  title: string;
  slug: string;
  platform: "bombuj";
  posterUrl?: string | null;
  mediaType?: "movie" | "serial";
  year?: string | null;
  matchScore?: number;
};

async function searchBombujProvider(
  query: string,
  options: { limit?: number; scoreBoost?: number; mediaTypeHint?: "movie" | "serial"; strict?: boolean } = {},
): Promise<BombujSearchResult[]> {
  try {
     const normalizedQuery = normalizeSearch(query);
     if (!normalizedQuery) return [];
     const limit = options.limit ?? 8;

     const directResults = (
       await Promise.allSettled([
         options.mediaTypeHint === "serial" ? Promise.resolve([]) : fetchBombujSuggestionResults(query, "https://www.bombuj.si"),
         options.mediaTypeHint === "movie" ? Promise.resolve([]) : fetchBombujSuggestionResults(query, "https://serialy.bombuj.si"),
       ])
     )
       .flatMap((result) => (result.status === "fulfilled" ? result.value : []))
       .filter((item) => item.slug);

     const directUnique = Array.from(new Map(directResults.map((item) => [`${item.mediaType}:${item.slug}`, item])).values())
       .map((item, index) => {
         const baseScore = scoreSearchCandidate(query, [
           item.title,
           item.slug.replace(/-/g, " "),
           item.year,
         ], index);
         return {
           ...item,
           matchScore: baseScore > 0 && providerCandidateMatches(query, [
             item.title,
             item.slug.replace(/-/g, " "),
             item.year,
           ], Boolean(options.strict))
             ? baseScore + 200 + (options.scoreBoost ?? 0)
             : 0,
         };
       })
       .filter((item) => (item.matchScore ?? 0) > 0);
     if (directUnique.length > 0) {
       return directUnique.sort(compareSearchScores).slice(0, limit);
     }

     const sitemapXml = await fetchText("https://www.bombuj.si/sitemap.xml", {
        headers: { Referer: BASE_URL }
     });
     const urlMatches = [...sitemapXml.matchAll(/<loc>([^<]+)<\/loc>/gi)];
     const candidates: { url: string; slug: string; score: number }[] = [];

     for (const match of urlMatches) {
        const url = match[1].trim();
        if (!/online-(film|serial)-/i.test(url)) continue;
        if (options.mediaTypeHint === "movie" && !/online-film-/i.test(url)) continue;
        if (options.mediaTypeHint === "serial" && !/online-serial-/i.test(url)) continue;
        const slug = url.split("/").pop() ?? "";
        if (!slug) continue;
        const normalizedSlug = normalizeSearch(slug.replace(/^online-(film|serial)-/i, ""));
        if (!normalizedSlug) continue;

        const score = scoreSearchCandidate(query, [
          slug.replace(/^online-(film|serial)-/i, "").replace(/-/g, " "),
          normalizedSlug,
          extractYearFromSlug(slug),
        ]);

        if (score > 0 && providerCandidateMatches(query, [
          slug.replace(/^online-(film|serial)-/i, "").replace(/-/g, " "),
          extractYearFromSlug(slug),
        ], Boolean(options.strict))) {
          candidates.push({ url, slug, score });
        }
      }

     const unique = Array.from(new Map(candidates.map((c) => [c.slug, c])).values())
        .sort((a, b) => b.score - a.score)
        .slice(0, 24);

     const hydrated = await mapWithConcurrency(unique.slice(0, 10), 3, async (item) => {
        try {
          const pageHtml = await fetchText(item.url, { headers: { Referer: BASE_URL } });
          const title =
            stripTags(matchOne(pageHtml, /<meta property="og:title"\s*content="([^"]+)"/i) ?? "") ||
            stripTags(matchOne(pageHtml, /<title>([\s\S]*?)<\/title>/i) ?? "") ||
            item.slug.replace(/-/g, " ");
          let posterUrl =
            matchOne(pageHtml, /<meta property="og:image"\s*content="([^"]+)"/i) ?? null;
          if (posterUrl) {
            if (posterUrl.startsWith("//")) posterUrl = `https:${posterUrl}`;
            else if (posterUrl.startsWith("/")) posterUrl = `https://www.bombuj.si${posterUrl}`;
          }

          const isSerial = item.slug.startsWith("online-serial-");
          return {
            title,
            slug: item.slug.replace(/^online-(film|serial)-/i, ""),
            platform: "bombuj" as const,
            posterUrl,
            mediaType: isSerial ? ("serial" as const) : ("movie" as const),
            year: extractYearFromSlug(item.slug),
            matchScore: scoreSearchCandidate(query, [
              title,
              item.slug.replace(/^online-(film|serial)-/i, "").replace(/-/g, " "),
              extractYearFromSlug(item.slug),
            ]) + (options.scoreBoost ?? 0),
          };
        } catch {
          return null;
        }
      });

     const results = hydrated.filter(Boolean) as {
        title: string;
        slug: string;
        platform: "bombuj";
        posterUrl?: string | null;
        mediaType?: "movie" | "serial";
        year?: string | null;
        matchScore?: number;
     }[];

     const combined = Array.from(
       new Map(
         [...directUnique, ...results].map((item) => [`${item.mediaType ?? "unknown"}:${item.slug}`, item]),
       ).values(),
     );

     combined.sort(compareSearchScores);
     if (combined.length >= limit) {
        return combined.slice(0, limit);
     }

     const fallback = unique
        .filter((item) => !combined.some((r) => item.slug.endsWith(r.slug)))
        .slice(0, limit - combined.length)
        .map((item) => ({
          title: item.slug.replace(/^online-(film|serial)-/i, "").replace(/-/g, " "),
          slug: item.slug.replace(/^online-(film|serial)-/i, ""),
          platform: "bombuj" as const,
          posterUrl: null,
          mediaType: item.slug.startsWith("online-serial-") ? ("serial" as const) : ("movie" as const),
          year: extractYearFromSlug(item.slug),
          matchScore: scoreSearchCandidate(query, [
            item.slug.replace(/^online-(film|serial)-/i, "").replace(/-/g, " "),
            extractYearFromSlug(item.slug),
          ]) + (options.scoreBoost ?? 0),
        }));

     return [...combined, ...fallback].sort(compareSearchScores).slice(0, limit);
  } catch {
      return []; // Return empty array if CF blocks the search so the unified search doesn't crash
  }
}

function providerCandidateMatches(query: string, fields: Array<string | null | undefined>, strict: boolean) {
  return strict
    ? hasRequiredSearchTokenCoverage(query, fields)
    : hasSignificantSearchTokenMatch(query, fields);
}

function scoreProviderMatchForCatalog(query: string, result: BombujSearchResult, catalog: ExternalTitleCandidate, index: number) {
  const titleScore = scoreSearchCandidate(catalog.title, [
    result.title,
    result.slug.replace(/-/g, " "),
    result.year,
  ], index);
  const originalScore = catalog.originalTitle
    ? scoreSearchCandidate(catalog.originalTitle, [result.title, result.slug.replace(/-/g, " "), result.year], index)
    : 0;
  const queryScore = scoreSearchCandidate(query, [catalog.title, catalog.originalTitle, catalog.year], index);
  const yearBonus = catalog.year && result.year === catalog.year ? 260 : 0;
  const yearPenalty = catalog.year && result.year && result.year !== catalog.year ? -180 : 0;

  return Math.max(titleScore, originalScore) + queryScore + yearBonus + yearPenalty + Math.round(catalog.matchScore / 2);
}

export async function searchBombuj(query: string): Promise<BombujSearchResult[]> {
  const normalizedQuery = normalizeSearch(query);
  if (!normalizedQuery) {
    return [];
  }

  // Bombuj's own suggestion endpoint is both faster and more authoritative than
  // expanding the query through the external title catalog. Exact native hits
  // must return immediately so unified search does not discard them on timeout.
  const direct = await searchBombujProvider(query, { limit: 8 });
  const hasExactDirectMatch = direct.some((result) =>
    normalizeSearch(result.title) === normalizedQuery ||
    normalizeSearch(result.slug.replace(/-/g, " ")) === normalizedQuery
  );
  if (hasExactDirectMatch) {
    return keepHighConfidenceSearchResults(direct).slice(0, 8);
  }

  const catalog = await searchExternalTitles(query, 10);
  const targeted = await mapWithConcurrency(catalog, 4, async (candidate) => {
    const terms = [
      candidate.title,
      candidate.originalTitle && candidate.originalTitle !== candidate.title ? candidate.originalTitle : null,
    ].filter(Boolean) as string[];
    const termResults = await mapWithConcurrency(terms, 2, async (term) => (
      searchBombujProvider(term, {
        limit: 4,
        mediaTypeHint: candidate.mediaType,
        scoreBoost: Math.round(candidate.matchScore / 3),
        strict: true,
      })
    ));

    return termResults.flat().map((result, index) => ({
      ...result,
      posterUrl: result.posterUrl ?? candidate.posterUrl ?? null,
      year: result.year ?? candidate.year ?? null,
      matchScore: scoreProviderMatchForCatalog(query, result, candidate, index),
    }));
  });
  const merged = [...targeted.flat(), ...direct];
  const unique = new Map<string, BombujSearchResult>();

  for (const result of merged.sort(compareSearchScores)) {
    const key = `${result.mediaType ?? "unknown"}:${result.slug}`;
    if (!unique.has(key)) {
      unique.set(key, result);
    }
  }

  return keepHighConfidenceSearchResults([...unique.values()]).slice(0, 8);
}

function normalizeSearch(value: string) {
  return normalizeSearchText(value);
}

function extractYearFromSlug(slug: string) {
  const match = slug.match(/(19|20)\d{2}/);
  return match?.[0] ?? null;
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
