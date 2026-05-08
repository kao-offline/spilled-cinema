import { hostnameFromUrl } from "@/lib/utils";
import type { MediaItem } from "@/lib/types";

const BASE_URL = "https://svetserialu.to";
const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36";

export type SvetSerialuImportItem = Omit<
  MediaItem,
  "id" | "createdAt" | "updatedAt" | "resumePositionSeconds"
>;

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
  subtitlesUrl: string | null;
};

type FetchOptions = {
  seasonNumbers?: number[];
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

async function fetchText(url: string, referer?: string) {
  const response = await fetch(url, {
    headers: {
      "User-Agent": USER_AGENT,
      Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "Accept-Language": "cs-CZ,cs;q=0.9,en;q=0.8",
      Referer: referer ?? BASE_URL,
    },
    redirect: "follow",
  });

  if (!response.ok) {
    throw new Error(`Request failed: ${response.status} ${response.statusText} for ${url}`);
  }

  return response.text();
}

function matchOne(html: string, pattern: RegExp) {
  const match = html.match(pattern);
  return match?.[1]?.trim() ?? null;
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

function extractPlayers(episodeHtml: string, episodeUrl: string) {
  const players: { provider: string; sourcePageUrl: string }[] = [];
  const pattern =
    /<a class="source_link ([^"\s]+)[^"]*"[^>]*data-sourceId="([^"]+)"[^>]*data-iframe="([^"]+)"/gi;

  for (const match of episodeHtml.matchAll(pattern)) {
    const provider = match[1].trim().toLowerCase();
    const encoded = match[3].trim();

    try {
      const decodedPath = Buffer.from(encoded, "base64").toString("utf8");
      players.push({
        provider,
        sourcePageUrl: absoluteUrl(decodedPath, episodeUrl),
      });
    } catch {
      continue;
    }
  }

  return players;
}

function resolvePlayerHtml(playerHtml: string, sourcePageUrl: string) {
  const iframeSrc = matchOne(playerHtml, /<iframe[^>]+src="([^"]+)"/i);
  if (iframeSrc) {
    const embedUrl = absoluteUrl(iframeSrc, sourcePageUrl);
    let subtitlesUrl: string | null = null;

    try {
      subtitlesUrl = new URL(embedUrl).searchParams.get("sub.info");
    } catch {
      subtitlesUrl = null;
    }

    return { embedUrl, subtitlesUrl };
  }

  const redirectUrl = matchOne(
    playerHtml,
    /window\.location\.href\s*=\s*["']([^"']+)["']/i,
  );

  if (!redirectUrl) {
    return null;
  }

  return {
    embedUrl: absoluteUrl(redirectUrl, sourcePageUrl),
    subtitlesUrl: null,
  };
}

async function resolvePlayers(
  players: { provider: string; sourcePageUrl: string }[],
  episodeUrl: string,
) {
  const resolved: ParsedPlayer[] = [];

  for (const player of players) {
    try {
      const html = await fetchText(player.sourcePageUrl, episodeUrl);
      const next = resolvePlayerHtml(html, player.sourcePageUrl);
      if (!next?.embedUrl) {
        continue;
      }

      resolved.push({
        provider: player.provider,
        sourcePageUrl: player.sourcePageUrl,
        embedUrl: next.embedUrl,
        subtitlesUrl: next.subtitlesUrl,
      });
    } catch {
      continue;
    }
  }

  return resolved;
}

function buildEpisodeTitle(showTitle: string, episode: ParsedEpisode) {
  const parts = [showTitle];
  if (episode.episodeCode) {
    parts.push(episode.episodeCode.toUpperCase());
  }
  if (episode.episodeTitle) {
    parts.push(episode.episodeTitle);
  }
  return parts.join(" • ");
}

export async function fetchSvetSerialuShow(
  slug: string,
  libraryToken: string,
  options: FetchOptions = {},
) {
  const showUrl = `${BASE_URL}/serial/${slug}`;
  const showHtml = await fetchText(showUrl);

  const showTitle = stripTags(matchOne(showHtml, /<h1 class="nunito">([\s\S]*?)<\/h1>/i) ?? slug);
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

  const availableSeasons = getSeasonNumbers(firstSeasonListHtml);
  const selectedSeasons =
    options.seasonNumbers && options.seasonNumbers.length > 0
      ? availableSeasons.filter((season) => options.seasonNumbers?.includes(season))
      : availableSeasons;

  const items: SvetSerialuImportItem[] = [];

  for (const seasonNumber of selectedSeasons) {
    const seasonHtml =
      seasonNumber === firstSeason
        ? firstSeasonListHtml
        : await fetchText(
            `${BASE_URL}/episodes-list?tvShowId=${tvShowId}&season=${seasonNumber}&episode=1`,
            showUrl,
          );

    const episodes = getEpisodesFromList(seasonHtml, seasonNumber);

    for (const episode of episodes) {
      const episodeHtml = await fetchText(episode.episodeUrl, showUrl);
      const players = await resolvePlayers(
        extractPlayers(episodeHtml, episode.episodeUrl),
        episode.episodeUrl,
      );

      for (const player of players) {
        items.push({
          libraryToken,
          title: buildEpisodeTitle(showTitle, episode),
          sourcePageUrl: episode.episodeUrl,
          sourceHost: hostnameFromUrl(episode.episodeUrl),
          posterUrl: posterPath ? absoluteUrl(posterPath, BASE_URL) : undefined,
          playback: {
            primaryUrl: player.embedUrl,
            kind: "embed",
            subtitleTracks: player.subtitlesUrl
              ? [{ url: player.subtitlesUrl, label: "default" }]
              : [],
          },
          tags: [
            "svetserialu",
            slug,
            `season:${episode.seasonNumber}`,
            player.provider,
            ...(episode.episodeNumber !== null ? [`episode:${episode.episodeNumber}`] : []),
            ...(episode.episodeCode ? [episode.episodeCode] : []),
          ],
        });
      }
    }
  }

  return {
    slug,
    title: showTitle,
    altTitle: altTitle || null,
    description: description || null,
    years: years || null,
    showUrl,
    tvShowId,
    availableSeasons,
    items,
  };
}
