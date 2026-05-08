const BASE_URLS = ["https://svetserialov.to", "https://svetserialu.to", "https://svetserialu.io"];
const PRIMARY_BASE_URL = BASE_URLS[0];
const FETCH_PROXY_TEMPLATE = process.env.IMPORT_FETCH_PROXY_TEMPLATE || "";
const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36";

const PLAYER_ALIASES = {
  filemoon: { alias: "file", label: "File" },
  vidmoly: { alias: "monozip", label: "MonoZip" },
  streamtape: { alias: "steamtag", label: "SteamTag" },
  mixdrop: { alias: "nextdrop", label: "NextDrop" },
};

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

function matchOne(html, pattern) {
  const match = String(html || "").match(pattern);
  return match?.[1]?.trim() ?? null;
}

function absoluteUrl(value, baseUrl = PRIMARY_BASE_URL) {
  try {
    return new URL(value, baseUrl).toString();
  } catch {
    return value;
  }
}

function buildProxyUrl(targetUrl) {
  const template = String(FETCH_PROXY_TEMPLATE || "").trim();
  if (!template) return null;

  if (template.includes("{url}")) {
    return template.replaceAll("{url}", encodeURIComponent(targetUrl));
  }

  const separator = template.includes("?") ? "&" : "?";
  return `${template}${separator}url=${encodeURIComponent(targetUrl)}`;
}

async function fetchTextViaProxy(targetUrl, referer, baseUrl) {
  const proxyUrl = buildProxyUrl(targetUrl);
  if (!proxyUrl) {
    return null;
  }

  const response = await fetch(proxyUrl, {
    headers: {
      "User-Agent": USER_AGENT,
      Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8,application/json;q=0.6",
      Referer: referer ?? baseUrl,
      "X-Target-URL": targetUrl,
    },
    redirect: "follow",
  });

  if (!response.ok) {
    throw new Error(`Proxy request failed: ${response.status}`);
  }

  const contentType = response.headers.get("content-type") || "";
  if (contentType.includes("application/json")) {
    const payload = await response.json().catch(() => null);
    const html = payload?.html ?? payload?.content ?? payload?.body ?? payload?.data?.html;
    if (typeof html === "string" && html.trim().length > 0) {
      return html;
    }
    throw new Error("Proxy response did not include HTML payload.");
  }

  return response.text();
}

async function fetchText(url, referer, baseUrl = PRIMARY_BASE_URL) {
  try {
    const response = await fetch(url, {
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
        Referer: referer ?? baseUrl,
      },
      redirect: "follow",
    });

    if (!response.ok) {
      if ((response.status === 403 || response.status === 503) && FETCH_PROXY_TEMPLATE) {
        const proxied = await fetchTextViaProxy(url, referer, baseUrl);
        if (proxied) {
          return proxied;
        }
      }
      throw new Error(`Request failed: ${response.status}`);
    }

    return await response.text();
  } catch (error) {
    console.error(`Fetch failed for ${url}:`, error instanceof Error ? error.message : String(error));
    throw error;
  }
}

async function mapWithConcurrency(items, concurrency, task) {
  const results = new Array(items.length);
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

function detectLanguage(rawHints) {
  const normalized = String(rawHints || "")
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

function normalizeSourceLanguageLabel(rawLabel) {
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

function normalizeEpisodeTitle(rawTitle, episodeNumber) {
  let title = stripTags(rawTitle).replace(/\s+/g, " ").trim();
  if (!title) {
    return null;
  }

  if (Number.isFinite(episodeNumber)) {
    title = title.replace(new RegExp(`^${episodeNumber}\\s+`), "").trim();
  }

  title = title
    .replace(/\s+\b(?:tit(?:ulky)?|dab|dabing|dubbed)\b(?:\s+\b(?:tit(?:ulky)?|dab|dabing|dubbed)\b)*$/i, "")
    .replace(/\s{2,}/g, " ")
    .trim();

  return title || null;
}

async function extractPlayers(episodeHtml, episodeUrl) {
  const players = [];
  const linkPattern = /<a([^>]*\bclass="[^"]*\bsource_link\b[^"]*"[^>]*)>([\s\S]*?)<\/a>/gi;

  const extractFromBlock = (htmlBlock, blockLanguage) => {
    for (const match of String(htmlBlock || "").matchAll(linkPattern)) {
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

  const langGroupChunks = String(episodeHtml || "").split('<div class="LangGroup').slice(1);
  let parsedFromGroups = 0;

  for (const chunk of langGroupChunks) {
    const groupHtml = `<div class="LangGroup${chunk}`;
    const headerMatch = groupHtml.match(/<div class="LangHeader[^>]*>([\s\S]*?)<\/div>/i);
    const language = normalizeSourceLanguageLabel(headerMatch?.[1] ?? "");
    const tabsheMatch = groupHtml.match(/<div class="tabshe[^\"]*"([^>]*)>([\s\S]*?)<\/div>/i);
    const tabsheAttrs = tabsheMatch?.[1] ?? "";
    const tabsheBody = tabsheMatch?.[2] ?? "";
    const dataIframeUrl = matchOne(tabsheAttrs, /\bdata-iframe-url="([^"]+)"/i);

    const before = players.length;
    if (dataIframeUrl) {
      try {
        const loadedList = await fetchText(absoluteUrl(dataIframeUrl, episodeUrl), episodeUrl);
        extractFromBlock(loadedList, language);
      } catch {
        // Fall back to inline content.
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

function resolvePlayerHtml(playerHtml, sourcePageUrl) {
  const iframeSrc = matchOne(playerHtml, /<iframe[^>]+src="([^"]+)"/i);
  if (iframeSrc) {
    const embedUrl = absoluteUrl(iframeSrc, sourcePageUrl);
    if (!embedUrl.includes("svetserialu.to/sources/")) {
      let subtitlesUrl;

      try {
        subtitlesUrl = new URL(embedUrl).searchParams.get("sub.info") ?? undefined;
      } catch {
        subtitlesUrl = undefined;
      }

      return { embedUrl, subtitlesUrl };
    }
  }

  const redirectUrl = matchOne(playerHtml, /window\.location\.href\s*=\s*["']([^"']+)["']/i);
  if (!redirectUrl) {
    return null;
  }

  const embedUrl = absoluteUrl(redirectUrl, sourcePageUrl);
  if (embedUrl.includes("svetserialu.to/sources/")) {
    return null;
  }

  return {
    embedUrl,
    subtitlesUrl: undefined,
  };
}

async function resolvePlayers(players, episodeUrl) {
  const resolved = await mapWithConcurrency(players, 4, async (player) => {
    try {
      const html = await fetchText(player.sourcePageUrl, episodeUrl);
      const result = resolvePlayerHtml(html, player.sourcePageUrl);
      if (!result?.embedUrl) {
        return null;
      }

      const providerConfig = PLAYER_ALIASES[player.provider];
      if (!providerConfig) {
        return null;
      }

      return {
        alias: providerConfig.alias,
        provider: player.provider,
        label: providerConfig.label,
        language: player.language,
        sourcePageUrl: player.sourcePageUrl,
        embedUrl: result.embedUrl,
        subtitlesUrl: result.subtitlesUrl ?? null,
      };
    } catch {
      return null;
    }
  });

  const deduped = [];
  const seen = new Set();
  for (const player of resolved.filter(Boolean)) {
    const key = `${player.alias}:${player.embedUrl}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    deduped.push(player);
  }
  return deduped;
}

export async function fetchSvetSerialuShow(slug) {
  if (!slug || typeof slug !== "string" || !/^[a-z0-9-]+$/.test(slug)) {
    throw new Error("Provide a valid show slug.");
  }

  const attempts = [];

  for (const baseUrl of BASE_URLS) {
    try {
      const showUrl = `${baseUrl}/serial/${slug}`;
      const showHtml = await fetchText(showUrl, undefined, baseUrl);

      const title = stripTags(
        matchOne(showHtml, /<h1 class="nunito">([\s\S]*?)<\/h1>/i) ??
          matchOne(showHtml, /<h1[^>]*>([\s\S]*?)<\/h1>/i) ??
          slug,
      );
      const altTitle = stripTags(matchOne(showHtml, /<span class="alt-name nunito">([\s\S]*?)<\/span>/i) ?? "");
      const description = stripTags(matchOne(showHtml, /<div class="show-text nunito">([\s\S]*?)<\/div>/i) ?? "");
      const posterPath = matchOne(showHtml, /<div class="show-image">\s*<img src="([^"]+)"/i);
      const years = stripTags(matchOne(showHtml, /<span class="year nunito">([\s\S]*?)<\/span>/i) ?? "");
      const firstEpisodePath =
        matchOne(showHtml, /<a href="(\/serial\/[^"]+\/s\d+e\d+)" class="button starwatch/i) ||
        matchOne(showHtml, /<a href="(\/serial\/[^"]+\/s\d+e\d+)"[^>]*>\s*(?:ZAÄŒAÅ¤|ZAÄŒÃT|WATCH|POZERAÅ¤)/i) ||
        matchOne(showHtml, /<a href="(\/serial\/[^"]+\/s\d+e\d+)"/i);

      if (!firstEpisodePath) {
        throw new Error(`Could not find first episode link for show "${slug}".`);
      }

      const firstEpisodeUrl = absoluteUrl(firstEpisodePath, baseUrl);
      const firstEpisodeHtml = await fetchText(firstEpisodeUrl, showUrl, baseUrl);
      const tvShowId = matchOne(firstEpisodeHtml, /\/episodes-list\?tvShowId=(\d+)/i);

      if (!tvShowId) {
        throw new Error(`Could not find tvShowId for "${slug}".`);
      }

      const firstSeason = parseInt(firstEpisodeUrl.match(/\/s(\d+)e\d+$/i)?.[1] ?? "1", 10);
      const firstSeasonListUrl = `${baseUrl}/episodes-list?tvShowId=${tvShowId}&season=${firstSeason}&episode=1`;
      const firstSeasonListHtml = await fetchText(firstSeasonListUrl, firstEpisodeUrl, baseUrl);

      const allSeasons = new Set();
      for (const match of firstSeasonListHtml.matchAll(/<option value="(\d+)"/gi)) {
        allSeasons.add(parseInt(match[1], 10));
      }
      if (allSeasons.size === 0) {
        allSeasons.add(firstSeason);
      }

      const seasons = Array.from(allSeasons).sort((a, b) => a - b);
      const seasonHtmlEntries = await Promise.all(
        seasons.map(async (season) => {
          const seasonHtml =
            season === firstSeason
              ? firstSeasonListHtml
              : await fetchText(`${baseUrl}/episodes-list?tvShowId=${tvShowId}&season=${season}&episode=1`, showUrl, baseUrl);
          return { season, seasonHtml };
        }),
      );

      const parsedEpisodes = [];
      const episodePattern = /<a href="(\/serial\/[^"]+\/s\d+e\d+)"[^>]*>([\s\S]*?)<\/a>/gi;

      for (const { seasonHtml } of seasonHtmlEntries) {
        for (const match of seasonHtml.matchAll(episodePattern)) {
          const href = match[1];
          const block = match[2];
          const codeMatch = href.match(/\/(s\d+e\d+)$/i);
          const seasonEpisodeCode = codeMatch?.[1]?.toLowerCase() ?? "";

          if (!seasonEpisodeCode) continue;

          const seasonMatch = seasonEpisodeCode.match(/s(\d+)/i);
          const episodeMatch = seasonEpisodeCode.match(/e(\d+)/i);
          if (!seasonMatch || !episodeMatch) continue;

          const seasonNumber = parseInt(seasonMatch[1], 10);
          const episodeNumber = parseInt(episodeMatch[1], 10);
          if (!Number.isFinite(seasonNumber) || !Number.isFinite(episodeNumber)) continue;

          const rawEpisodeTitle =
            matchOne(block, /<span class="ep_name[^"]*">([\s\S]*?)<\/span>/i) ??
            block;

          parsedEpisodes.push({
            id: `${slug}:${seasonEpisodeCode}`,
            showSlug: slug,
            showTitle: title,
            posterUrl: posterPath ? absoluteUrl(posterPath, baseUrl) : null,
            seasonNumber,
            episodeNumber,
            episodeCode: seasonEpisodeCode,
            episodeTitle:
              normalizeEpisodeTitle(rawEpisodeTitle, episodeNumber) ?? `Season ${seasonNumber} Episode ${episodeNumber}`,
            episodeUrl: absoluteUrl(href, baseUrl),
          });
        }
      }

      if (parsedEpisodes.length === 0) {
        throw new Error(`No episodes found for show "${slug}".`);
      }

      const importedAt = Date.now();
      const episodesWithPlayers = await mapWithConcurrency(parsedEpisodes, 3, async (episode) => {
        try {
          const episodeHtml = await fetchText(episode.episodeUrl, showUrl, baseUrl);
          const extracted = await extractPlayers(episodeHtml, episode.episodeUrl);
          const players = await resolvePlayers(extracted, episode.episodeUrl);
          return {
            ...episode,
            players,
            selectedPlayerAlias: players[0]?.alias ?? "",
            importedAt,
          };
        } catch {
          return {
            ...episode,
            players: [],
            selectedPlayerAlias: "",
            importedAt,
          };
        }
      });

      const resolvedPlayerCount = episodesWithPlayers.reduce((count, episode) => count + episode.players.length, 0);
      if (resolvedPlayerCount === 0) {
        throw new Error(`No playable providers were resolved for show "${slug}".`);
      }

      return {
        slug,
        title,
        altTitle: altTitle || null,
        description: description || null,
        years: years || null,
        posterUrl: posterPath ? absoluteUrl(posterPath, baseUrl) : null,
        availableSeasons: Array.from(allSeasons).sort((a, b) => a - b),
        importedAt,
        episodes: episodesWithPlayers.sort((a, b) => {
          if (a.seasonNumber !== b.seasonNumber) {
            return a.seasonNumber - b.seasonNumber;
          }
          return (a.episodeNumber ?? 0) - (b.episodeNumber ?? 0);
        }),
      };
    } catch (innerError) {
      const message = innerError instanceof Error ? innerError.message : String(innerError);
      attempts.push(`${baseUrl}: ${message}`);

      const retryable = /Request failed:\s*(403|5\d\d)/i.test(message);
      if (!retryable) {
        throw innerError;
      }
    }
  }

  throw new Error(`All SvetSerialu hosts failed. ${attempts.join(" | ")}`);
}
