import { Buffer } from "node:buffer";
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
import { searchSvetSerialuCatalog } from "./svetserialu-catalog";
import {
  isSvetSerialuAlgoliaAvailable,
  saveSvetSerialuRecords,
  searchSvetSerialuAlgolia,
  type SvetSerialuIndexRecord,
} from "./svetserialu-algolia";

const BASE_URLS: string[] = ["https://svetserialu.to", "https://svetserialu.io", "https://svetserialov.to"];
const BASE_URL = BASE_URLS[0];
const FETCH_PROXY_TEMPLATE = process.env.IMPORT_FETCH_PROXY_TEMPLATE || "";
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

export type SvetSerialuCredentials = {
  username?: string;
  password?: string;
};

type SvetSerialuSession = {
  cookies: Map<string, string>;
  expiresAt: number;
};

const svetSerialuSessions = new Map<string, SvetSerialuSession>();

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

function isSvetSerialuInternalSourceUrl(value: string) {
  try {
    const parsed = new URL(value);
    return BASE_URLS.some((baseUrl) => parsed.hostname === new URL(baseUrl).hostname) &&
      parsed.pathname.includes("/sources/");
  } catch {
    return false;
  }
}

function withSvetSerialuBaseUrl(value: string, baseUrl: string) {
  for (const knownBaseUrl of BASE_URLS) {
    if (value.startsWith(knownBaseUrl)) {
      return value.replace(knownBaseUrl, baseUrl);
    }
  }
  return value;
}

function buildProxyUrl(targetUrl: string) {
  const template = FETCH_PROXY_TEMPLATE.trim();
  if (!template) {
    return null;
  }

  if (template.includes("{url}")) {
    return template.replaceAll("{url}", encodeURIComponent(targetUrl));
  }

  const separator = template.includes("?") ? "&" : "?";
  return `${template}${separator}url=${encodeURIComponent(targetUrl)}`;
}

function matchOne(html: string, pattern: RegExp) {
  const match = html.match(pattern);
  return match?.[1]?.trim() ?? null;
}

function normalizeSvetSerialuCredentials(credentials?: SvetSerialuCredentials | null) {
  const username = credentials?.username?.trim() ?? "";
  const password = credentials?.password ?? "";
  return username && password ? { username, password } : null;
}

function getSessionKey(credentials: { username: string; password: string }) {
  return Buffer.from(`${credentials.username}:${credentials.password}`).toString("base64");
}

function getSetCookieHeaders(headers: Headers) {
  const withGetSetCookie = headers as Headers & { getSetCookie?: () => string[] };
  const values = typeof withGetSetCookie.getSetCookie === "function" ? withGetSetCookie.getSetCookie() : [];
  const fallback = headers.get("set-cookie");
  return values.length > 0 ? values : fallback ? [fallback] : [];
}

function mergeSetCookies(cookies: Map<string, string>, setCookieHeaders: string[]) {
  for (const header of setCookieHeaders) {
    const [pair] = header.split(";");
    const separator = pair.indexOf("=");
    if (separator <= 0) {
      continue;
    }
    const name = pair.slice(0, separator).trim();
    const value = pair.slice(separator + 1).trim();
    if (name && value) {
      cookies.set(name, value);
    }
  }
}

function buildCookieHeader(cookies: Map<string, string>) {
  return Array.from(cookies.entries()).map(([name, value]) => `${name}=${value}`).join("; ");
}

function isSvetSerialuLoginPage(html: string) {
  return /\/user\/login/i.test(html) || /class="login-user"/i.test(html) || /name="user_pass"/i.test(html);
}

async function loginSvetSerialu(credentials: { username: string; password: string }, baseUrl: string) {
  const cookies = new Map<string, string>();
  const loginPage = await fetch(`${baseUrl}/user/login`, {
    headers: {
      "User-Agent": USER_AGENT,
      Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "Accept-Language": "cs-CZ,cs;q=0.9,en;q=0.8",
      Referer: `${baseUrl}/login`,
    },
  }).catch(() => null);

  if (loginPage) {
    mergeSetCookies(cookies, getSetCookieHeaders(loginPage.headers));
  }

  const body = new URLSearchParams({
    user_name: credentials.username,
    user_pass: credentials.password,
    register_login: "1",
  });

  const response = await fetch(`${baseUrl}/user/login`, {
    method: "POST",
    headers: {
      "User-Agent": USER_AGENT,
      Accept: "application/json,text/javascript,*/*;q=0.01",
      "Accept-Language": "cs-CZ,cs;q=0.9,en;q=0.8",
      "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
      "X-Requested-With": "XMLHttpRequest",
      Origin: baseUrl,
      Referer: `${baseUrl}/login`,
      ...(cookies.size > 0 ? { Cookie: buildCookieHeader(cookies) } : {}),
    },
    body,
    redirect: "follow",
  });

  mergeSetCookies(cookies, getSetCookieHeaders(response.headers));
  const text = await response.text();
  let status: unknown = null;
  try {
    status = JSON.parse(text)?.status;
  } catch {
    status = text;
  }

  const statusValues = Array.isArray(status) ? status : [status];
  if (!response.ok || !statusValues.includes("SUCCESS")) {
    throw new Error("SvetSerialu login failed. Check the username and password in Settings.");
  }

  const session: SvetSerialuSession = {
    cookies,
    expiresAt: Date.now() + 1000 * 60 * 60 * 6,
  };
  svetSerialuSessions.set(getSessionKey(credentials), session);
  return session;
}

async function getSvetSerialuSession(credentials: { username: string; password: string }, baseUrl: string, force = false) {
  const key = getSessionKey(credentials);
  const existing = svetSerialuSessions.get(key);
  if (!force && existing && existing.expiresAt > Date.now()) {
    return existing;
  }
  return loginSvetSerialu(credentials, baseUrl);
}

async function fetchTextViaProxy(
  targetUrl: string,
  referer: string | undefined,
  baseUrl: string,
  session?: SvetSerialuSession | null,
) {
  const proxyUrl = buildProxyUrl(targetUrl);
  if (!proxyUrl) {
    return null;
  }

  const response = await fetch(proxyUrl, {
    headers: {
      "User-Agent": USER_AGENT,
      Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8,application/json;q=0.6",
      "Accept-Language": "cs-CZ,cs;q=0.9,en;q=0.8",
      Referer: referer ?? baseUrl,
      "X-Target-URL": targetUrl,
      ...(session?.cookies.size ? { "X-Target-Cookie": buildCookieHeader(session.cookies) } : {}),
    },
    redirect: "follow",
  });

  mergeSetCookies(session?.cookies ?? new Map(), getSetCookieHeaders(response.headers));

  if (!response.ok) {
    throw new Error(`Proxy request failed: ${response.status} ${response.statusText}`);
  }

  const contentType = response.headers.get("content-type") || "";
  if (contentType.includes("application/json")) {
    const payload = await response.json().catch(() => null) as {
      html?: unknown;
      content?: unknown;
      body?: unknown;
      data?: { html?: unknown };
    } | null;
    const html = payload?.html ?? payload?.content ?? payload?.body ?? payload?.data?.html;
    if (typeof html === "string" && html.trim().length > 0) {
      return html;
    }
    throw new Error("Proxy response did not include HTML payload.");
  }

  return response.text();
}

async function fetchText(url: string, referer?: string, credentials?: SvetSerialuCredentials | null) {
  const attempts: string[] = [];
  const normalizedCredentials = normalizeSvetSerialuCredentials(credentials);

  for (const baseUrl of BASE_URLS) {
    const targetUrl = withSvetSerialuBaseUrl(url, baseUrl);
    const targetReferer = referer
      ? withSvetSerialuBaseUrl(referer, baseUrl)
      : baseUrl;
    const session = normalizedCredentials ? await getSvetSerialuSession(normalizedCredentials, baseUrl) : null;

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
        ...(session?.cookies.size ? { Cookie: buildCookieHeader(session.cookies) } : {}),
      },
      redirect: "follow",
    });

    console.log(`[svetserialu:fetch] ${response.status} ${response.statusText} ${targetUrl}`);
    if (response.ok) {
      mergeSetCookies(session?.cookies ?? new Map(), getSetCookieHeaders(response.headers));
      const html = await response.text();
      if (isSvetSerialuLoginPage(html)) {
        if (!normalizedCredentials) {
          throw new Error("SvetSerialu now requires login. Add your SvetSerialu username and password in Settings > Sources.");
        }

        const refreshedSession = await getSvetSerialuSession(normalizedCredentials, baseUrl, true);
        const retry = await fetch(targetUrl, {
          headers: {
            "User-Agent": USER_AGENT,
            Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
            "Accept-Language": "cs-CZ,cs;q=0.9,en;q=0.8",
            Referer: targetReferer,
            Cookie: buildCookieHeader(refreshedSession.cookies),
          },
          redirect: "follow",
        });
        if (retry.ok) {
          mergeSetCookies(refreshedSession.cookies, getSetCookieHeaders(retry.headers));
          const retryHtml = await retry.text();
          if (!isSvetSerialuLoginPage(retryHtml)) {
            return retryHtml;
          }
        }

        throw new Error("SvetSerialu login did not unlock this page. Check the credentials in Settings.");
      }
      return html;
    }

    attempts.push(`${baseUrl}: ${response.status} ${response.statusText}`);
    if ((response.status === 403 || response.status === 503) && FETCH_PROXY_TEMPLATE) {
      try {
        const proxiedHtml = await fetchTextViaProxy(targetUrl, targetReferer, baseUrl, session);
        if (proxiedHtml && !isSvetSerialuLoginPage(proxiedHtml)) {
          return proxiedHtml;
        }
        if (proxiedHtml && isSvetSerialuLoginPage(proxiedHtml) && !normalizedCredentials) {
          throw new Error("SvetSerialu now requires login. Add your SvetSerialu username and password in Settings > Sources.");
        }
      } catch (error) {
        attempts.push(`${baseUrl} proxy: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  }

  if (!normalizedCredentials && attempts.length > 0 && attempts.every((attempt) => attempt.includes("503"))) {
    const proxyHint = FETCH_PROXY_TEMPLATE
      ? "The configured import proxy did not bypass the block."
      : "Set IMPORT_FETCH_PROXY_TEMPLATE to restore the old proxy fallback used by the previous hard-coded importer.";
    throw new Error(`SvetSerialu is blocking this page before login or proxy fallback. ${proxyHint}`);
  }

  throw new Error(`Request failed on all hosts: ${attempts.join(" | ")} for ${url}`);
}

export async function fetchSvetSerialuText(url: string, referer?: string, credentials?: SvetSerialuCredentials | null) {
  return await fetchText(url, referer, credentials);
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

function getAccordionSeasons(showHtml: string) {
  const seasons: Array<{ seasonNumber: number; accordionId: string }> = [];
  const pattern = /<div class="accordion accordionId(\d+)">[\s\S]*?<h2[^>]*>[\s\S]*?<i>\s*(\d+)\.\s*<\/i>/gi;

  for (const match of showHtml.matchAll(pattern)) {
    const seasonNumber = Number.parseInt(match[2], 10);
    if (Number.isFinite(seasonNumber)) {
      seasons.push({ seasonNumber, accordionId: match[1] });
    }
  }

  return seasons;
}

function getEpisodesFromList(html: string, seasonNumber: number) {
  const episodes: ParsedEpisode[] = [];
  const pattern =
    /<a href="(\/serial\/[^"]+\/s\d+e\d+)" class="[^"]*(?:seasonLinks|accordionLink)[^"]*?">([\s\S]*?)<\/a>/gi;

  for (const match of html.matchAll(pattern)) {
    const href = match[1];
    const block = match[2];
    const codeMatch = href.match(/\/(s\d+e\d+)$/i);
    const episodeNumber = Number.parseInt(
      stripTags(
        matchOne(block, /<span class="ep_numb[^"]*">([\s\S]*?)<\/span>/i) ??
          matchOne(block, /<span class="number_eps[^"]*">([\s\S]*?)<\/span>/i) ??
          "",
      ),
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

  if (hasCzech && hasSlovak && hasEnglish && hasSubs) return "English audio + CZ/SK subtitles";
  if (hasCzech && hasSlovak && hasDub) return "Czech/Slovak audio";
  if (hasCzech && hasSlovak && hasSubs) return "CZ/SK subtitles";
  if (hasCzech && hasDub) return "Czech audio";
  if (hasCzech && hasSubs) return "Czech subtitles";
  if (hasSlovak && hasDub) return "Slovak audio";
  if (hasSlovak && hasSubs) return "Slovak subtitles";
  if (hasEnglish && hasCzech && hasSubs) return "English audio + Czech subtitles";
  if (hasEnglish && hasSlovak && hasSubs) return "English audio + Slovak subtitles";
  if (hasEnglish && hasDub) return "English audio";
  if (hasEnglish && hasSubs) return "English subtitles";
  if (hasCzech) return "Czech audio";
  if (hasSlovak) return "Slovak audio";
  if (hasEnglish) return "English audio";
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
    return "English audio + CZ/SK subtitles";
  }

  if (/^cz\s*\/\s*sk(?:\s+dabing|\s+dubbed)?$/i.test(normalized)) {
    return "Czech/Slovak audio";
  }

  if (/^cz(?:\s+dabing|\s+dubbed)?$/i.test(normalized)) {
    return "Czech audio";
  }

  if (/^sk(?:\s+dabing|\s+dubbed)?$/i.test(normalized)) {
    return "Slovak audio";
  }

  if (/^en(?:\s+titulky|\s+subs?|\s+subtitles?)?$/i.test(normalized)) {
    return normalized === "en" ? "English audio" : "English subtitles";
  }

  return detectLanguage(value) ?? value;
}

async function extractPlayers(episodeHtml: string, episodeUrl: string, credentials?: SvetSerialuCredentials | null) {
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
        const loadedList = await fetchText(absoluteUrl(dataIframeUrl, episodeUrl), episodeUrl, credentials);
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
    if (!isSvetSerialuInternalSourceUrl(embedUrl)) {
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
  if (isSvetSerialuInternalSourceUrl(embedUrl)) {
    return null;
  }

  return {
    embedUrl,
    subtitlesUrl: undefined,
  };
}

async function resolvePlayers(
  players: { provider: string; sourcePageUrl: string; language?: string }[],
  episodeUrl: string,
  credentials?: SvetSerialuCredentials | null,
) {
  const resolved = await mapWithConcurrency(players, 4, async (player) => {
    try {
      const html = await fetchText(player.sourcePageUrl, episodeUrl, credentials);
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

function buildSvetSerialuFallbackPlayer(episodeUrl: string) {
  const defaultAlias = "embed-default" as PlayerAlias;
  return {
    alias: defaultAlias,
    label: "SvetSerialu",
    provider: "svetserialu",
    language: "cs",
    sourcePageUrl: episodeUrl,
    embedUrl: episodeUrl,
    subtitlesUrl: undefined,
    resolutionStatus: "failed" as const,
    resolutionError: "No external SvetSerialu player links could be extracted for this episode.",
  };
}

function toEpisodePlayers(players: ParsedPlayer[]) {
  return players.map((player, index) => {
    const known = PLAYER_ALIASES[player.provider];
    const baseAlias = known?.alias ?? player.provider.replace(/[^a-z0-9]+/gi, "-").toLowerCase();
    const label = known?.label ?? player.provider;
    return {
      alias: `${baseAlias}-${index + 1}` as PlayerAlias,
      label,
      provider: player.provider,
      language: player.language,
      sourcePageUrl: player.sourcePageUrl,
      embedUrl: player.embedUrl,
      subtitlesUrl: player.subtitlesUrl,
      resolutionStatus: "unresolved" as const,
    };
  });
}

function parseYearHint(value: string | null | undefined) {
  const match = value?.match(/\b(19|20)\d{2}\b/);
  return match?.[0] ?? undefined;
}

export async function fetchSvetSerialuShow(slug: string, credentials?: SvetSerialuCredentials | null): Promise<ImportedShow> {
  console.log(`[svetserialu] import start slug=${slug}`);
  const showUrl = `${BASE_URL}/serial/${slug}`;
  const showHtml = await fetchText(showUrl, undefined, credentials);
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
  const firstEpisodeHtml = await fetchText(firstEpisodeUrl, showUrl, credentials);
  const tvShowId = matchOne(firstEpisodeHtml, /\/episodes-list\?tvShowId=(\d+)/i);

  const firstSeason = Number.parseInt(firstEpisodeUrl.match(/\/s(\d+)e\d+$/i)?.[1] ?? "1", 10);
  let availableSeasons: number[] = [];
  let seasonLists: ParsedEpisode[][] = [];

  if (tvShowId) {
    const firstSeasonListHtml = await fetchText(
      `${BASE_URL}/episodes-list?tvShowId=${tvShowId}&season=${firstSeason}&episode=1`,
      firstEpisodeUrl,
      credentials,
    );
    console.log(`[svetserialu] first season list length=${firstSeasonListHtml.length} tvShowId=${tvShowId}`);

    availableSeasons = getSeasonNumbers(firstSeasonListHtml);
    seasonLists = await mapWithConcurrency(availableSeasons, 4, async (seasonNumber) => {
      const html =
        seasonNumber === firstSeason
          ? firstSeasonListHtml
          : await fetchText(
              `${BASE_URL}/episodes-list?tvShowId=${tvShowId}&season=${seasonNumber}&episode=1`,
              showUrl,
              credentials,
            );

      console.log(`[svetserialu] season=${seasonNumber} list length=${html.length}`);
      return getEpisodesFromList(html, seasonNumber);
    });
  } else {
    const accordionSeasons = getAccordionSeasons(showHtml);
    if (accordionSeasons.length === 0) {
      throw new Error(`Could not find season list for "${slug}".`);
    }

    availableSeasons = accordionSeasons.map((season) => season.seasonNumber);
    seasonLists = await mapWithConcurrency(accordionSeasons, 4, async (season) => {
      const html = await fetchText(`${showUrl}?loadAccordionId=${season.accordionId}`, showUrl, credentials);
      console.log(`[svetserialu] season=${season.seasonNumber} accordion=${season.accordionId} list length=${html.length}`);
      return getEpisodesFromList(html, season.seasonNumber);
    });
  }

  const parsedEpisodes = seasonLists.flat();
  console.log(`[svetserialu] parsed episodes=${parsedEpisodes.length} seasons=${availableSeasons.length}`);
  if (parsedEpisodes.length === 0) {
    throw new Error(`No episodes found for show "${slug}".`);
  }

  const episodeHtmlCache = new Map<string, string>([[firstEpisodeUrl, firstEpisodeHtml]]);
  const importedAt = Date.now();
  const resolvedEpisodes = await mapWithConcurrency(parsedEpisodes, 3, async (episode) => {
    let episodePlayers: LibraryEpisode["players"] = [];
    try {
      const episodeHtml = episodeHtmlCache.get(episode.episodeUrl) ??
        await fetchText(episode.episodeUrl, showUrl, credentials);
      episodeHtmlCache.set(episode.episodeUrl, episodeHtml);
      const sourcePlayers = await extractPlayers(episodeHtml, episode.episodeUrl, credentials);
      const resolvedPlayers = await resolvePlayers(sourcePlayers, episode.episodeUrl, credentials);
      episodePlayers = toEpisodePlayers(resolvedPlayers);
    } catch (error) {
      console.warn("[svetserialu] failed to resolve episode players", {
        episodeUrl: episode.episodeUrl,
        error: error instanceof Error ? error.message : String(error),
      });
    }

    const players = episodePlayers.length > 0
      ? episodePlayers
      : [buildSvetSerialuFallbackPlayer(episode.episodeUrl)];

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
      players,
      selectedPlayerAlias: players[0].alias,
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
    bannerUrl: artwork.bannerUrl ?? null,
    bannerWithLogoUrl: artwork.bannerWithLogoUrl ?? null,
    clearLogoUrl: artwork.clearLogoUrl ?? null,
    availableSeasons: [...availableSeasons].sort((a, b) => a - b),
    importedAt,
    episodes: resolvedEpisodes,
  };
}

export async function verifySvetSerialuLogin(credentials?: SvetSerialuCredentials | null) {
  const normalizedCredentials = normalizeSvetSerialuCredentials(credentials);
  if (!normalizedCredentials) {
    throw new Error("Enter your SvetSerialu username and password first.");
  }

  await getSvetSerialuSession(normalizedCredentials, BASE_URL, true);
  await fetchText(BASE_URL, undefined, normalizedCredentials);
  return { ok: true };
}

export type SvetSerialuSearchResult = {
  title: string;
  slug: string;
  platform: "svetserialu";
  posterUrl?: string | null;
  mediaType?: "serial";
  year?: string | null;
  alternateTitles?: string[];
  description?: string | null;
  genres?: string[];
  csfdRating?: string | number | null;
  actors?: string[];
  directors?: string[];
  detailUrl?: string | null;
  matchScore?: number;
  _source?: "catalog" | "live";
};

async function searchSvetSerialuProvider(
  query: string,
  options: { limit?: number; scoreBoost?: number; strict?: boolean; credentials?: SvetSerialuCredentials | null } = {},
): Promise<SvetSerialuSearchResult[]> {
   try {
      const sanitized = encodeURIComponent(query);
      const limit = options.limit ?? 8;
      // Search results are returned by the homepage endpoint with searchfor param.
      const html = await fetchText(`${BASE_URL}/?searchfor=${sanitized}`, undefined, options.credentials);
      const matches = [...html.matchAll(/href="\/serial\/([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi)];

      const results: SvetSerialuSearchResult[] = [];
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
            const year = yearMatch ? stripTags(yearMatch[1]).trim() : null;
            const baseScore = scoreSearchCandidate(query, [title, altTitle, m[1].replace(/-/g, " "), year], index);
            if (baseScore > 0 && providerCandidateMatches(query, [title, altTitle, m[1].replace(/-/g, " "), year], Boolean(options.strict))) {
              results.push({
                 title,
                 slug: m[1],
                 platform: "svetserialu" as const,
                 posterUrl: posterMatch ? absoluteUrl(posterMatch[1], BASE_URL) : null,
                 mediaType: "serial" as const,
                 year,
                 matchScore: baseScore + (options.scoreBoost ?? 0),
              });
            }
         }
      }

      return Array.from(new Map(results.map(r => [r.slug, r])).values())
        .sort((a, b) => (b.matchScore ?? 0) - (a.matchScore ?? 0))
        .slice(0, limit);
   } catch (error) {
      if (options.credentials) {
        throw error;
      }
      return [];
   }
}

function providerCandidateMatches(query: string, fields: Array<string | null | undefined>, strict: boolean) {
  return strict
    ? hasRequiredSearchTokenCoverage(query, fields)
    : hasSignificantSearchTokenMatch(query, fields);
}

function scoreSvetProviderMatchForCatalog(query: string, result: SvetSerialuSearchResult, catalog: ExternalTitleCandidate, index: number) {
  const titleScore = scoreSearchCandidate(catalog.title, [
    result.title,
    result.slug.replace(/-/g, " "),
    result.year,
  ], index);
  const originalScore = catalog.originalTitle
    ? scoreSearchCandidate(catalog.originalTitle, [result.title, result.slug.replace(/-/g, " "), result.year], index)
    : 0;
  const queryScore = scoreSearchCandidate(query, [catalog.title, catalog.originalTitle, catalog.year], index);
  const yearBonus = catalog.year && result.year === catalog.year ? 220 : 0;
  const yearPenalty = catalog.year && result.year && result.year !== catalog.year ? -160 : 0;

  return Math.max(titleScore, originalScore) + queryScore + yearBonus + yearPenalty + Math.round(catalog.matchScore / 2);
}

async function searchSvetSerialuLegacy(query: string, credentials?: SvetSerialuCredentials | null): Promise<SvetSerialuSearchResult[]> {
  const catalogResults = (await searchSvetSerialuCatalog(query, 8)).map((item) => ({
    title: item.title,
    slug: item.importSlug || item.slug,
    platform: "svetserialu" as const,
    posterUrl: item.posterUrl,
    mediaType: "serial" as const,
    year: item.yearLabel ?? item.year,
    alternateTitles: item.alternateTitles,
    description: item.description,
    genres: item.genres,
    actors: item.actors,
    directors: item.directors,
    detailUrl: item.detailUrl,
    matchScore: item.matchScore,
    _source: "catalog" as const,
  }));

  const direct = (await searchSvetSerialuProvider(query, { limit: 8, credentials }))
    .map((result) => ({ ...result, _source: "live" as const }));

  if (catalogResults.length > 0 && direct.length > 0) {
    const merged = new Map<string, SvetSerialuSearchResult>();
    for (const r of [...catalogResults, ...direct].sort(compareSearchScores)) {
      if (!merged.has(r.slug)) merged.set(r.slug, r);
    }
    return keepHighConfidenceSearchResults([...merged.values()]).slice(0, 8);
  }

  if (catalogResults.length > 0) {
    return catalogResults;
  }

  const catalog = (await searchExternalTitles(query, 8)).filter((candidate) => candidate.mediaType === "serial");
  const targeted = await mapWithConcurrency(catalog, 4, async (candidate) => {
    const terms = [
      candidate.title,
      candidate.originalTitle && candidate.originalTitle !== candidate.title ? candidate.originalTitle : null,
    ].filter(Boolean) as string[];
    const termResults = await mapWithConcurrency(terms, 2, async (term) => (
      searchSvetSerialuProvider(term, {
        limit: 4,
        scoreBoost: Math.round(candidate.matchScore / 3),
        strict: true,
        credentials,
      })
    ));

    return termResults.flat().map((result, index) => ({
      ...result,
      posterUrl: result.posterUrl ?? candidate.posterUrl ?? null,
      year: result.year ?? candidate.year ?? null,
      matchScore: scoreSvetProviderMatchForCatalog(query, result, candidate, index),
      _source: "live" as const,
    }));
  });
  const fallbackDirect = (await searchSvetSerialuProvider(query, { limit: catalog.length > 0 ? 4 : 8, credentials }))
    .map((result) => ({ ...result, _source: "live" as const }));
  const unique = new Map<string, SvetSerialuSearchResult>();

  for (const result of [...targeted.flat(), ...fallbackDirect].sort(compareSearchScores)) {
    if (!unique.has(result.slug)) {
      unique.set(result.slug, result);
    }
  }

  return keepHighConfidenceSearchResults([...unique.values()]).slice(0, 8);
}

type SearchSettled = {
  status: "fulfilled";
  value: SvetSerialuSearchResult[];
} | {
  status: "rejected";
  value: SvetSerialuSearchResult[];
};

function settleSearch(promise: Promise<SvetSerialuSearchResult[]>): Promise<SearchSettled> {
  return promise
    .then((value): SearchSettled => ({ status: "fulfilled", value }))
    .catch((): SearchSettled => ({ status: "rejected", value: [] }));
}

function waitForSearch(
  promise: Promise<SearchSettled>,
  ms: number,
): Promise<SearchSettled | null> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  return Promise.race([
    promise,
    new Promise<null>((resolve) => {
      timeout = setTimeout(() => resolve(null), Math.max(0, ms));
    }),
  ]).finally(() => {
    if (timeout) clearTimeout(timeout);
  });
}

function mergeSvetSerialuResults(...groups: SvetSerialuSearchResult[][]) {
  const unique = new Map<string, SvetSerialuSearchResult>();
  for (const result of groups.flat().sort(compareSearchScores)) {
    const key = result.slug || normalizeSearchText(result.title);
    const existing = unique.get(key);
    if (!existing) {
      unique.set(key, result);
      continue;
    }

    const stronger = (result.matchScore ?? 0) > (existing.matchScore ?? 0) ? result : existing;
    const weaker = stronger === result ? existing : result;
    unique.set(key, {
      ...stronger,
      year: stronger.year ?? weaker.year,
      posterUrl: stronger.posterUrl ?? weaker.posterUrl,
      description: stronger.description ?? weaker.description,
      genres: stronger.genres?.length ? stronger.genres : weaker.genres,
      csfdRating: stronger.csfdRating ?? weaker.csfdRating,
      alternateTitles: stronger.alternateTitles?.length ? stronger.alternateTitles : weaker.alternateTitles,
      actors: stronger.actors?.length ? stronger.actors : weaker.actors,
      directors: stronger.directors?.length ? stronger.directors : weaker.directors,
      detailUrl: stronger.detailUrl ?? weaker.detailUrl,
    });
  }
  return keepHighConfidenceSearchResults([...unique.values()].sort(compareSearchScores)).slice(0, 8);
}

function buildMinimalSvetSerialuIndexRecord(result: SvetSerialuSearchResult): SvetSerialuIndexRecord | null {
  if (!result.slug || !result.title) {
    return null;
  }
  return {
    objectID: result.slug,
    slug: result.slug,
    title: result.title,
    alt_title: result.alternateTitles?.find((title) => title && title !== result.title) ?? null,
    year: result.year ?? null,
    poster_url: result.posterUrl ?? null,
    episode_count: 0,
    season_count: 0,
  };
}

async function scrapeSvetSerialuIndexRecord(slug: string): Promise<SvetSerialuIndexRecord | null> {
  const showUrl = `${BASE_URL}/serial/${slug}`;
  const showHtml = await fetchText(showUrl, undefined, undefined);

  const title = stripTags(matchOne(showHtml, /<h1 class="nunito">([\s\S]*?)<\/h1>/i) ?? slug);
  const altTitle = stripTags(matchOne(showHtml, /<span class="alt-name nunito">([\s\S]*?)<\/span>/i) ?? "");
  const description = stripTags(matchOne(showHtml, /<div class="show-text nunito">([\s\S]*?)<\/div>/i) ?? "");
  const posterPath = matchOne(showHtml, /<div class="show-image">\s*<img src="([^"]+)"/i);
  const years = stripTags(matchOne(showHtml, /<span class="year nunito">([\s\S]*?)<\/span>/i) ?? "");
  const firstEpisodePath = matchOne(
    showHtml,
    /<a href="(\/serial\/[^"]+\/s\d+e\d+)" class="button starwatch/i,
  );

  let scrapedEpisodes: ParsedEpisode[] = [];
  if (firstEpisodePath) {
    const firstEpisodeUrl = absoluteUrl(firstEpisodePath, BASE_URL);
    const firstEpisodeHtml = await fetchText(firstEpisodeUrl, showUrl, undefined);
    const tvShowId = matchOne(firstEpisodeHtml, /\/episodes-list\?tvShowId=(\d+)/i);

    if (tvShowId) {
      const firstSeason = Number.parseInt(firstEpisodeUrl.match(/\/s(\d+)e\d+$/i)?.[1] ?? "1", 10);
      const firstSeasonListHtml = await fetchText(
        `${BASE_URL}/episodes-list?tvShowId=${tvShowId}&season=${firstSeason}&episode=1`,
        firstEpisodeUrl,
        undefined,
      );
      const availableSeasons = getSeasonNumbers(firstSeasonListHtml);
      const lists = await mapWithConcurrency(availableSeasons, 4, async (seasonNumber) =>
        seasonNumber === firstSeason
          ? firstSeasonListHtml
          : await fetchText(
              `${BASE_URL}/episodes-list?tvShowId=${tvShowId}&season=${seasonNumber}&episode=1`,
              showUrl,
              undefined,
            ),
      );
      scrapedEpisodes = lists.flatMap((html, index) => getEpisodesFromList(html, availableSeasons[index]));
    } else {
      const accordionSeasons = getAccordionSeasons(showHtml);
      scrapedEpisodes = (await mapWithConcurrency(accordionSeasons, 4, async (season) => {
        const html = await fetchText(`${showUrl}?loadAccordionId=${season.accordionId}`, showUrl, undefined);
        return getEpisodesFromList(html, season.seasonNumber);
      })).flat();
    }
  }

  const yearStart = years?.match(/\b(19|20)\d{2}\b/)?.[0] ?? null;
  const yearEnd = years?.match(/\b(19|20)\d{2}\b\s*[–-]\s*((?:19|20)\d{2})/)?.[1] ?? yearStart;

  const maxEpisodes = 50;
  const episodes = scrapedEpisodes.slice(0, maxEpisodes).map((episode) => ({
    c: episode.episodeCode ?? `s${String(episode.seasonNumber).padStart(2, "0")}e${String(episode.episodeNumber ?? 0).padStart(2, "0")}`,
    t: episode.episodeTitle ? episode.episodeTitle.substring(0, 80) : null,
    s: episode.seasonNumber,
  }));
  let episodesText: string | null = null;
  if (scrapedEpisodes.length > maxEpisodes) {
    episodesText = scrapedEpisodes.map((episode) =>
      episode.episodeCode ?? `s${String(episode.seasonNumber).padStart(2, "0")}e${String(episode.episodeNumber ?? 0).padStart(2, "0")}`,
    ).join(" ");
    if (episodesText.length > 2000) {
      episodesText = episodesText.substring(0, 2000);
    }
  }

  return {
    objectID: slug,
    slug,
    title,
    alt_title: altTitle || null,
    year: years || null,
    year_start: yearStart ? Number.parseInt(yearStart, 10) : null,
    year_end: yearEnd ? Number.parseInt(yearEnd, 10) : null,
    description: description ? description.substring(0, 500) : null,
    poster_url: posterPath ? absoluteUrl(posterPath, BASE_URL) : null,
    episode_count: scrapedEpisodes.length,
    season_count: new Set(scrapedEpisodes.map((episode) => episode.seasonNumber)).size,
    episodes,
    episodes_text: episodesText,
  };
}

const SVET_INDEX_MAX_CONCURRENCY = 2;
const SVET_INDEX_RECENT_TTL_MS = 10 * 60 * 1000;
const svetIndexInFlight = new Map<string, Promise<void>>();
const svetIndexRecentlyIndexed = new Map<string, number>();
const svetIndexPending: Array<{ slug: string; fallback: SvetSerialuSearchResult | null }> = [];
let svetIndexActive = 0;

function isSvetIndexRecentlyIndexed(slug: string) {
  const indexedAt = svetIndexRecentlyIndexed.get(slug);
  if (!indexedAt) {
    return false;
  }
  if (Date.now() - indexedAt >= SVET_INDEX_RECENT_TTL_MS) {
    svetIndexRecentlyIndexed.delete(slug);
    return false;
  }
  return true;
}

function pumpSvetIndexQueue() {
  while (svetIndexActive < SVET_INDEX_MAX_CONCURRENCY && svetIndexPending.length > 0) {
    const entry = svetIndexPending.shift()!;
    svetIndexActive += 1;
    const task = (async () => {
      try {
        const record = await scrapeSvetSerialuIndexRecord(entry.slug).catch(() => null)
          ?? (entry.fallback ? buildMinimalSvetSerialuIndexRecord(entry.fallback) : null);
        if (record) {
          const saved = await saveSvetSerialuRecords([record]);
          if (saved) {
            svetIndexRecentlyIndexed.set(entry.slug, Date.now());
          }
        }
      } catch {
        // Indexing is best-effort and must never break the search path.
      } finally {
        svetIndexActive -= 1;
        pumpSvetIndexQueue();
      }
    })();
    svetIndexInFlight.set(entry.slug, task);
    void task.finally(() => svetIndexInFlight.delete(entry.slug));
  }
}

function queueSvetSerialuIndexing(results: SvetSerialuSearchResult[]) {
  if (!isSvetSerialuAlgoliaAvailable()) {
    return;
  }
  const queued = results
    .filter((result) => result._source === "live")
    .slice(0, 5);
  for (const result of queued) {
    if (svetIndexInFlight.has(result.slug) || isSvetIndexRecentlyIndexed(result.slug)) {
      continue;
    }
    svetIndexPending.push({ slug: result.slug, fallback: result });
  }
  pumpSvetIndexQueue();
}

export async function searchSvetSerialu(query: string, credentials?: SvetSerialuCredentials | null): Promise<SvetSerialuSearchResult[]> {
  if (query.trim().length < 2) {
    return [];
  }

  const algoliaSearch = settleSearch(searchSvetSerialuAlgolia(query, 12));
  const legacySearch = settleSearch(searchSvetSerialuLegacy(query, credentials));

  const algoliaFast = await waitForSearch(algoliaSearch, 250);
  const legacyFast = await waitForSearch(legacySearch, 0);
  let algoliaFinal: SearchSettled | null;
  let legacyFinal: SearchSettled | null;
  let merged: SvetSerialuSearchResult[];

  if (algoliaFast?.status === "fulfilled" && algoliaFast.value.length >= 4) {
    algoliaFinal = algoliaFast;
    legacyFinal = legacyFast ?? { status: "rejected", value: [] };
    merged = mergeSvetSerialuResults(algoliaFast.value, legacyFast?.value ?? []);
  } else {
    [algoliaFinal, legacyFinal] = await Promise.all([
      algoliaFast ?? waitForSearch(algoliaSearch, 10_000),
      // The public SvetSerialu page commonly answers in 3-7 seconds. A two
      // second race returned an empty result while the healthy request later
      // logged 200 OK, which made command search appear randomly broken.
      legacyFast ?? waitForSearch(legacySearch, 10_000),
    ]);
    merged = mergeSvetSerialuResults(algoliaFinal?.value ?? [], legacyFinal?.value ?? []);
  }

  const algoliaSlugs = new Set((algoliaFinal?.value ?? []).map((result) => result.slug));
  const missingFromIndex = (legacyFinal?.value ?? []).filter((result) => !algoliaSlugs.has(result.slug));
  queueSvetSerialuIndexing(missingFromIndex);

  return merged;
}
