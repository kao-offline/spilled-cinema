import { Buffer } from "node:buffer";
import type { ImportedShow, LibraryEpisode, PlayerAlias } from "../lib/types";
import { enrichArtwork } from "./artwork";
import { scoreSearchCandidate } from "../lib/search-ranking";

const BASE_URLS: string[] = ["https://svetserialu.to", "https://svetserialu.io"];
const BASE_URL = BASE_URLS[0];
const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36";

const PLAYER_ALIASES: Record<string, { alias: PlayerAlias; label: string }> = {
  filemoon: { alias: "file", label: "File" },
  vidmoly: { alias: "monozip", label: "MonoZip" },
  streamtape: { alias: "steamtag", label: "SteamTag" },
  mixdrop: { alias: "nextdrop", label: "NextDrop" },
};

type ParsedEpisode = {
  seasonNumber: number;
  episodeNumber: number | null;
  episodeCode: string | null;
  episodeTitle: string | null;
  episodeUrl: string;
};

type ParsedPlayer = {
  provider: string;
  sourcePageUrl: string;
  embedUrl: string;
  subtitlesUrl?: string;
  language?: string;
};

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

function absoluteUrl(value: string, base = BASE_URL) {
  try {
    return new URL(value, base).toString();
  } catch {
    return value;
  }
}

function matchOne(html: string, pattern: RegExp) {
  const match = html.match(pattern);
  return match?.[1]?.trim() ?? null;
}

async function fetchText(url: string, referer?: string) {
  const attempts: string[] = [];

  for (const baseUrl of BASE_URLS) {
    const targetUrl = url.startsWith(BASE_URL) ? url.replace(BASE_URL, baseUrl) : url;
    const targetReferer = referer
      ? (referer.startsWith(BASE_URL) ? referer.replace(BASE_URL, baseUrl) : referer)
      : baseUrl;

    console.log(`[svetserialu:fetch] GET ${targetUrl}`);
    const response = await fetch(targetUrl, {
      headers: {
        "User-Agent": USER_AGENT,
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "cs-CZ,cs;q=0.9,en;q=0.8",
        "Accept-Encoding": "gzip, deflate, br",
        DNT: "1",
        Connection: "keep-alive",
        "Upgrade-Insecure-Requests": "1",
        "Sec-Fetch-Dest": "document",
        "Sec-Fetch-Mode": "navigate",
        "Sec-Fetch-Site": "none",
        "Sec-Fetch-User": "?1",
        "Sec-CH-UA": "\"Chromium\";v=\"123\", \"Not:A-Brand\";v=\"8\"",
        "Sec-CH-UA-Mobile": "?0",
        "Sec-CH-UA-Platform": "\"Windows\"",
        Referer: targetReferer,
      },
      redirect: "follow",
    });

    console.log(`[svetserialu:fetch] ${response.status} ${response.statusText} ${targetUrl}`);
    if (response.ok) {
      return response.text();
    }

    attempts.push(`${baseUrl}: ${response.status} ${response.statusText}`);
    if (response.status !== 403) {
      throw new Error(`Request failed: ${response.status} ${response.statusText} for ${targetUrl}`);
    }
  }

  throw new Error(`Request failed on all hosts: ${attempts.join(" | ")} for ${url}`);
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

function getSeasonNumbers(episodesListHtml: string) {
  const seasons: number[] = [];
  const pattern = /<option value="(\d+)"/gi;

  for (const match of episodesListHtml.matchAll(pattern)) {
    seasons.push(Number.parseInt(match[1], 10));
  }

  return [...new Set(seasons)].filter(Number.isFinite);
}

function getEpisodesFromList(html: string, seasonNumber: number) {
  const episodes: ParsedEpisode[] = [];
  const pattern =
    /<a href="(\/serial\/[^"]+\/s\d+e\d+)" class="[^"]*seasonLinks[^"]*?">([\s\S]*?)<\/a>/gi;

  for (const match of html.matchAll(pattern)) {
    const href = match[1];
    const block = match[2];
    const codeMatch = href.match(/\/(s\d+e\d+)$/i);
    const episodeNumber = Number.parseInt(
      stripTags(matchOne(block, /<span class="ep_numb[^"]*">([\s\S]*?)<\/span>/i) ?? ""),
      10,
    );
    const episodeTitle = stripTags(
      matchOne(block, /<span class="ep_name[^"]*">([\s\S]*?)<\/span>/i) ?? "",
    );

    episodes.push({
      seasonNumber,
      episodeNumber: Number.isFinite(episodeNumber) ? episodeNumber : null,
      episodeCode: codeMatch?.[1]?.toLowerCase() ?? null,
      episodeTitle: episodeTitle || null,
      episodeUrl: absoluteUrl(href, BASE_URL),
    });
  }

  return episodes;
}

function detectLanguage(rawHints: string) {
  const normalized = rawHints
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();

  if (!normalized) {
    return undefined;
  }

  const hasCzech = /\b(?:cz|cesk|česk|czech)\b/i.test(normalized);
  const hasSlovak = /\b(?:sk|slovak|slovensk)\b/i.test(normalized);
  const hasEnglish = /\b(?:en|eng|english)\b/i.test(normalized);
  const hasDub = /\b(?:dab|dabing|dubbing|dubbed)\b/i.test(normalized);
  const hasSubs = /\b(?:tit|titul|titulky|sub|subs|subtitle|subtitles)\b/i.test(normalized);

  if (hasCzech && hasDub) return "Czech (Dubbed)";
  if (hasCzech && hasSubs) return "Czech (Subtitles)";
  if (hasSlovak && hasDub) return "Slovak (Dubbed)";
  if (hasSlovak && hasSubs) return "Slovak (Subtitles)";
  if (hasEnglish && hasDub) return "English (Dubbed)";
  if (hasEnglish && hasSubs) return "English (Subtitles)";
  if (hasCzech) return "Czech";
  if (hasSlovak) return "Slovak";
  if (hasEnglish) return "English";
  if (hasDub) return "Dubbed";
  if (hasSubs) return "Subtitles";

  return undefined;
}

function normalizeSourceLanguageLabel(rawLabel: string) {
  const value = stripTags(rawLabel).replace(/\s+/g, " ").trim();
  if (!value) {
    return undefined;
  }

  const normalized = value.toLowerCase().replace(/\s+/g, " ").trim();

  if (/^cz\s*\/\s*sk\s*\+\s*en(?:\s+titulky)?$/i.test(normalized)) {
    return "EN + CZ/SK TIT";
  }

  if (/^cz(?:\s+dabing|\s+dubbed)?$/i.test(normalized)) {
    return "CZ DUBBED";
  }

  if (/^sk(?:\s+dabing|\s+dubbed)?$/i.test(normalized)) {
    return "SK DUBBED";
  }

  if (/^en(?:\s+titulky|\s+subs?|\s+subtitles?)?$/i.test(normalized)) {
    return "EN SUBS";
  }

  return detectLanguage(value) ?? value;
}

async function extractPlayers(episodeHtml: string, episodeUrl: string) {
  const players: { provider: string; sourcePageUrl: string; language?: string }[] = [];
  const linkPattern = /<a([^>]*\bclass="[^"]*\bsource_link\b[^"]*"[^>]*)>([\s\S]*?)<\/a>/gi;

  const extractFromBlock = (htmlBlock: string, blockLanguage?: string) => {
    for (const match of htmlBlock.matchAll(linkPattern)) {
      const attributes = match[1] ?? "";
      const innerHtml = match[2] ?? "";
      const classAttr = matchOne(attributes, /\bclass="([^"]+)"/i) ?? "";
      const classTokens = classAttr
        .split(/\s+/)
        .map((token) => token.trim().toLowerCase())
        .filter(Boolean);
      const provider = classTokens.find((token) => token !== "source_link" && PLAYER_ALIASES[token]);
      const encoded = matchOne(attributes, /\bdata-iframe="([^"]+)"/i);

      if (!provider || !encoded) {
        continue;
      }

      const sourceId = (matchOne(attributes, /\bdata-sourceid="([^"]+)"/i) ?? "").toLowerCase();
      const titleAttr = matchOne(attributes, /\btitle="([^"]+)"/i) ?? "";
      const ariaLabel = matchOne(attributes, /\baria-label="([^"]+)"/i) ?? "";
      const innerText = stripTags(innerHtml);
      const guessedLanguage = detectLanguage([classAttr, sourceId, titleAttr, ariaLabel, innerText].join(" "));
      const language = blockLanguage ?? guessedLanguage;

      try {
        const decodedPath = Buffer.from(encoded, "base64").toString("utf8");
        players.push({
          provider,
          sourcePageUrl: absoluteUrl(decodedPath, episodeUrl),
          language,
        });
      } catch {
        continue;
      }
    }
  };

  const langGroupChunks = episodeHtml.split('<div class="LangGroup').slice(1);

  let parsedFromGroups = 0;
  for (const chunk of langGroupChunks) {
    const groupHtml = `<div class="LangGroup${chunk}`;
    const headerMatch = groupHtml.match(/<div class="LangHeader[^>]*>([\s\S]*?)<\/div>/i);
    const language = normalizeSourceLanguageLabel(headerMatch?.[1] ?? "");
    const tabsheMatch = groupHtml.match(/<div class="tabshe[^"]*"([^>]*)>([\s\S]*?)<\/div>/i);
    const tabsheAttrs = tabsheMatch?.[1] ?? "";
    const tabsheBody = tabsheMatch?.[2] ?? "";
    const dataIframeUrl = matchOne(tabsheAttrs, /\bdata-iframe-url="([^"]+)"/i);

    const before = players.length;
    if (dataIframeUrl) {
      try {
        const loadedList = await fetchText(absoluteUrl(dataIframeUrl, episodeUrl), episodeUrl);
        extractFromBlock(loadedList, language);
      } catch {
        // fall through to any inline content if the AJAX list cannot be loaded
      }
    }

    extractFromBlock(tabsheBody, language);
    parsedFromGroups += players.length - before;
  }

  if (parsedFromGroups === 0) {
    extractFromBlock(episodeHtml);
  }

  return players;
}

function resolvePlayerHtml(playerHtml: string, sourcePageUrl: string) {
  const iframeSrc = matchOne(playerHtml, /<iframe[^>]+src="([^"]+)"/i);
  if (iframeSrc) {
    const embedUrl = absoluteUrl(iframeSrc, sourcePageUrl);
    // Don't allow svetserialu internal URLs as embed sources
    if (!embedUrl.includes("svetserialu.to/sources/")) {
      let subtitlesUrl: string | undefined;

      try {
        subtitlesUrl = new URL(embedUrl).searchParams.get("sub.info") ?? undefined;
      } catch {
        subtitlesUrl = undefined;
      }

      return { embedUrl, subtitlesUrl };
    }
  }

  const redirectUrl = matchOne(
    playerHtml,
    /window\.location\.href\s*=\s*["']([^"']+)["']/i,
  );

  if (!redirectUrl) {
    return null;
  }

  const embedUrl = absoluteUrl(redirectUrl, sourcePageUrl);
  // Don't allow svetserialu internal URLs as embed sources
  if (embedUrl.includes("svetserialu.to/sources/")) {
    return null;
  }

  return {
    embedUrl,
    subtitlesUrl: undefined,
  };
}

async function resolvePlayers(players: { provider: string; sourcePageUrl: string; language?: string }[], episodeUrl: string) {
  const resolved = await mapWithConcurrency(players, 4, async (player) => {
    try {
      const html = await fetchText(player.sourcePageUrl, episodeUrl);
      const result = resolvePlayerHtml(html, player.sourcePageUrl);
      if (!result?.embedUrl) {
        return null;
      }

      return {
        provider: player.provider,
        sourcePageUrl: player.sourcePageUrl,
        embedUrl: result.embedUrl,
        subtitlesUrl: result.subtitlesUrl,
        language: player.language,
      } satisfies ParsedPlayer;
    } catch {
      return null;
    }
  });

  return resolved.filter(Boolean) as ParsedPlayer[];
}

function buildEpisodeTitle(showTitle: string, episode: ParsedEpisode) {
  const parts = [showTitle];
  if (episode.episodeCode) {
    parts.push(episode.episodeCode.toUpperCase());
  }
  if (episode.episodeTitle) {
    parts.push(episode.episodeTitle);
  }
  return parts.join(" - ");
}

// Keep legacy deep-scrape helpers available for quick rollback/debugging.
void getSeasonNumbers;
void getEpisodesFromList;
void extractPlayers;
void resolvePlayers;

function createEpisodeId(showSlug: string, episode: ParsedEpisode) {
  return `${showSlug}:${episode.episodeCode ?? `s${episode.seasonNumber}e${episode.episodeNumber ?? "x"}`}`;
}

function parseYearHint(value: string | null | undefined) {
  const match = value?.match(/\b(19|20)\d{2}\b/);
  return match?.[0] ?? undefined;
}

export async function fetchSvetSerialuShow(slug: string): Promise<ImportedShow> {
  console.log(`[svetserialu] import start slug=${slug}`);
  const showUrl = `${BASE_URL}/serial/${slug}`;
  const showHtml = await fetchText(showUrl);
  console.log(`[svetserialu] show html length=${showHtml.length}`);

  const title = stripTags(matchOne(showHtml, /<h1 class="nunito">([\s\S]*?)<\/h1>/i) ?? slug);
  const altTitle = stripTags(
    matchOne(showHtml, /<span class="alt-name nunito">([\s\S]*?)<\/span>/i) ?? "",
  );
  const description = stripTags(
    matchOne(showHtml, /<div class="show-text nunito">([\s\S]*?)<\/div>/i) ?? "",
  );
  const posterPath = matchOne(showHtml, /<div class="show-image">\s*<img src="([^"]+)"/i);
  const firstEpisodePath = matchOne(
    showHtml,
    /<a href="(\/serial\/[^"]+\/s\d+e\d+)" class="button starwatch/i,
  );
  const years = stripTags(matchOne(showHtml, /<span class="year nunito">([\s\S]*?)<\/span>/i) ?? "");

  if (!firstEpisodePath) {
    throw new Error(`Could not find a first episode link for show "${slug}".`);
  }

  const firstEpisodeUrl = absoluteUrl(firstEpisodePath, BASE_URL);
  const firstEpisodeHtml = await fetchText(firstEpisodeUrl, showUrl);
  const tvShowId = matchOne(firstEpisodeHtml, /\/episodes-list\?tvShowId=(\d+)/i);

  if (!tvShowId) {
    throw new Error(`Could not find tvShowId for "${slug}".`);
  }

  const firstSeason = Number.parseInt(firstEpisodeUrl.match(/\/s(\d+)e\d+$/i)?.[1] ?? "1", 10);
  const firstSeasonListHtml = await fetchText(
    `${BASE_URL}/episodes-list?tvShowId=${tvShowId}&season=${firstSeason}&episode=1`,
    firstEpisodeUrl,
  );
  console.log(`[svetserialu] first season list length=${firstSeasonListHtml.length} tvShowId=${tvShowId}`);

  const availableSeasons = getSeasonNumbers(firstSeasonListHtml);
  const seasonLists = await mapWithConcurrency(availableSeasons, 4, async (seasonNumber) => {
    const html =
      seasonNumber === firstSeason
        ? firstSeasonListHtml
        : await fetchText(
            `${BASE_URL}/episodes-list?tvShowId=${tvShowId}&season=${seasonNumber}&episode=1`,
            showUrl,
          );

    console.log(`[svetserialu] season=${seasonNumber} list length=${html.length}`);
    return getEpisodesFromList(html, seasonNumber);
  });

  const parsedEpisodes = seasonLists.flat();
  console.log(`[svetserialu] parsed episodes=${parsedEpisodes.length} seasons=${availableSeasons.length}`);
  if (parsedEpisodes.length === 0) {
    throw new Error(`No episodes found for show "${slug}".`);
  }

  const importedAt = Date.now();
  const resolvedEpisodes = parsedEpisodes.map((episode) => {
    const defaultAlias = "embed-default" as PlayerAlias;
    return {
      id: createEpisodeId(slug, episode),
      showSlug: slug,
      showTitle: title,
      posterUrl: posterPath ? absoluteUrl(posterPath, BASE_URL) : undefined,
      seasonNumber: episode.seasonNumber,
      episodeNumber: episode.episodeNumber,
      episodeCode: episode.episodeCode,
      episodeTitle: buildEpisodeTitle(title, episode),
      episodeUrl: episode.episodeUrl,
      players: [
        {
          alias: defaultAlias,
          label: "SvetSerialu",
          provider: "svetserialu",
          language: "cs",
          sourcePageUrl: episode.episodeUrl,
          embedUrl: episode.episodeUrl,
          subtitlesUrl: undefined,
        },
      ],
      selectedPlayerAlias: defaultAlias,
      importedAt,
    } satisfies LibraryEpisode;
  });

  resolvedEpisodes.sort((a, b) => {
    if (a.seasonNumber !== b.seasonNumber) {
      return a.seasonNumber - b.seasonNumber;
    }
    return (a.episodeNumber ?? 0) - (b.episodeNumber ?? 0);
  });

  const artwork = await enrichArtwork({
    mediaType: "tv",
    title,
    altTitle: altTitle || null,
    yearHint: parseYearHint(years),
    description: description || null,
    currentPosterUrl: posterPath ? absoluteUrl(posterPath, BASE_URL) : null,
  });

  console.log(`[svetserialu] import success title=${title} episodes=${resolvedEpisodes.length}`);

  return {
    slug,
    title,
    altTitle: altTitle || null,
    description: description || null,
    years: years || null,
    posterUrl: artwork.posterUrl ?? (posterPath ? absoluteUrl(posterPath, BASE_URL) : null),
    backdropUrl: artwork.backdropUrl ?? null,
    clearLogoUrl: artwork.clearLogoUrl ?? null,
    availableSeasons: [...availableSeasons].sort((a, b) => a - b),
    importedAt,
    episodes: resolvedEpisodes,
  };
}

export async function searchSvetSerialu(
  query: string,
): Promise<
  {
    title: string;
    slug: string;
    platform: "svetserialu";
    posterUrl?: string | null;
    mediaType?: "serial";
    year?: string | null;
    matchScore?: number;
  }[]
> {
   try {
      const sanitized = encodeURIComponent(query);
      // Search results are returned by the homepage endpoint with searchfor param.
      const html = await fetchText(`${BASE_URL}/?searchfor=${sanitized}`);
      const matches = [...html.matchAll(/href="\/serial\/([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi)];

      const results = [];
      for (const [index, m] of matches.entries()) {
         if (!m[1].includes("/")) { // ignore deeper links
            const titleMatch = m[2].match(/class="name-search nunito">([\s\S]*?)<\/span>/i);
            const altTitleMatch = m[2].match(/class="name-search altname[^"]*">([\s\S]*?)<\/span>/i);
            const rawTitle = titleMatch?.[1] ?? m[2];
            const rawAltTitle = altTitleMatch?.[1] ?? "";
            const posterMatch = m[2].match(/<img[^>]+src="([^"]+)"/i);
            const yearMatch = m[2].match(/class="year-search[^"]*">([\s\S]*?)<\/span>/i);
            const title = stripTags(rawTitle).trim() || m[1].replace(/-/g, " ");
            const altTitle = stripTags(rawAltTitle).trim();
            results.push({
               title,
               slug: m[1],
               platform: "svetserialu" as const,
               posterUrl: posterMatch ? absoluteUrl(posterMatch[1], BASE_URL) : null,
               mediaType: "serial" as const,
               year: yearMatch ? stripTags(yearMatch[1]).trim() : null,
               matchScore: scoreSearchCandidate(query, [title, altTitle, m[1].replace(/-/g, " ")], index),
            });
         }
      }

      return Array.from(new Map(results.map(r => [r.slug, r])).values())
        .sort((a, b) => (b.matchScore ?? 0) - (a.matchScore ?? 0))
        .slice(0, 8);
   } catch {
      return [];
   }
}
