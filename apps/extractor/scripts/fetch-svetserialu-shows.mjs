#!/usr/bin/env node

import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const BASE_URL = "https://svetserialu.to";
const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36";

function parseArgs(argv) {
  const args = {
    shows: [],
    showsFile: null,
    out: null,
    limitEpisodes: null,
    seasons: [],
    includeUnresolved: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === "--show") {
      args.shows.push(argv[index + 1]);
      index += 1;
      continue;
    }

    if (arg === "--shows-file") {
      args.showsFile = argv[index + 1] ?? null;
      index += 1;
      continue;
    }

    if (arg === "--out") {
      args.out = argv[index + 1] ?? null;
      index += 1;
      continue;
    }

    if (arg === "--limit-episodes") {
      args.limitEpisodes = Number.parseInt(argv[index + 1] ?? "", 10);
      index += 1;
      continue;
    }

    if (arg === "--season") {
      args.seasons.push(Number.parseInt(argv[index + 1] ?? "", 10));
      index += 1;
      continue;
    }

    if (arg === "--include-unresolved") {
      args.includeUnresolved = true;
      continue;
    }

    if (arg === "--help" || arg === "-h") {
      printHelp();
      process.exit(0);
    }

    if (arg.startsWith("--")) {
      throw new Error(`Unknown argument: ${arg}`);
    }

    args.shows.push(arg);
  }

  return args;
}

function printHelp() {
  console.log(`Usage:
  node scripts/fetch-svetserialu-shows.mjs --show upload --show see

Options:
  --show <slug>              Add a show slug from /serial/<slug>
  --shows-file <path>        Load show slugs from a text or JSON file
  --out <path>               Write output JSON to a file
  --limit-episodes <count>   Stop after N episodes per show
  --season <number>          Only fetch specific season(s); may be repeated
  --include-unresolved       Keep players even when the /sources/ page could not be resolved
  --help                     Show this help
`);
}

async function loadShowSlugs(args) {
  const slugs = [...args.shows];

  if (args.showsFile) {
    const filePath = path.resolve(process.cwd(), args.showsFile);
    const raw = await readFile(filePath, "utf8");

    if (filePath.endsWith(".json")) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        parsed.forEach((value) => {
          if (typeof value === "string") {
            slugs.push(value);
          } else if (value && typeof value.slug === "string") {
            slugs.push(value.slug);
          }
        });
      }
    } else {
      raw
        .split(/\r?\n/g)
        .map((line) => line.trim())
        .filter(Boolean)
        .forEach((line) => slugs.push(line));
    }
  }

  return [...new Set(slugs.map((slug) => slug.trim()).filter(Boolean))];
}

function decodeHtml(value) {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ");
}

function stripTags(value) {
  return decodeHtml(value.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ")).trim();
}

function absoluteUrl(value, base = BASE_URL) {
  try {
    return new URL(value, base).toString();
  } catch {
    return value;
  }
}

async function fetchText(url, referer) {
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

function matchOne(html, pattern) {
  const match = html.match(pattern);
  return match?.[1]?.trim() ?? null;
}

function getShowMetadata(slug, html) {
  const title = stripTags(matchOne(html, /<h1 class="nunito">([\s\S]*?)<\/h1>/i) ?? slug);
  const altTitle = stripTags(matchOne(html, /<span class="alt-name nunito">([\s\S]*?)<\/span>/i) ?? "");
  const description = stripTags(matchOne(html, /<div class="show-text nunito">([\s\S]*?)<\/div>/i) ?? "");
  const posterPath = matchOne(
    html,
    /<div class="show-image">\s*<img src="([^"]+)"/i,
  );
  const firstEpisodePath = matchOne(
    html,
    /<a href="(\/serial\/[^"]+\/s\d+e\d+)" class="button starwatch/i,
  );
  const years = stripTags(matchOne(html, /<span class="year nunito">([\s\S]*?)<\/span>/i) ?? "");

  return {
    slug,
    title,
    altTitle: altTitle || null,
    description: description || null,
    years: years || null,
    showUrl: `${BASE_URL}/serial/${slug}`,
    posterUrl: posterPath ? absoluteUrl(posterPath, BASE_URL) : null,
    firstEpisodeUrl: firstEpisodePath ? absoluteUrl(firstEpisodePath, BASE_URL) : null,
  };
}

function getSeasonNumbers(episodesListHtml) {
  const seasons = [];
  const pattern = /<option value="(\d+)"/gi;

  for (const match of episodesListHtml.matchAll(pattern)) {
    seasons.push(Number.parseInt(match[1], 10));
  }

  return [...new Set(seasons)].filter(Number.isFinite);
}

function getEpisodesFromList(showSlug, seasonNumber, html) {
  const episodes = [];
  const pattern =
    /<a href="(\/serial\/[^"]+\/s\d+e\d+)" class="[^"]*seasonLinks[^"]*?">([\s\S]*?)<\/a>/gi;

  for (const match of html.matchAll(pattern)) {
    const href = match[1];
    const block = match[2];
    const codeMatch = href.match(/\/(s\d+e\d+)$/i);
    const number = Number.parseInt(
      stripTags(matchOne(block, /<span class="ep_numb[^"]*">([\s\S]*?)<\/span>/i) ?? ""),
      10,
    );
    const title = stripTags(matchOne(block, /<span class="ep_name[^"]*">([\s\S]*?)<\/span>/i) ?? "");

    episodes.push({
      showSlug,
      seasonNumber,
      episodeNumber: Number.isFinite(number) ? number : null,
      episodeCode: codeMatch?.[1]?.toLowerCase() ?? null,
      episodeTitle: title || null,
      episodeUrl: absoluteUrl(href, BASE_URL),
    });
  }

  return episodes;
}

function extractPlayers(episodeHtml, episodeUrl) {
  const players = [];
  const pattern =
    /<a class="source_link ([^"\s]+)[^"]*"[^>]*data-sourceId="([^"]+)"[^>]*data-iframe="([^"]+)"/gi;

  for (const match of episodeHtml.matchAll(pattern)) {
    const provider = match[1].trim().toLowerCase();
    const sourceId = match[2].trim();
    const encoded = match[3].trim();

    let decodedPath = null;
    try {
      decodedPath = Buffer.from(encoded, "base64").toString("utf8");
    } catch {
      decodedPath = null;
    }

    if (!decodedPath) {
      continue;
    }

    players.push({
      provider,
      sourceId,
      sourcePageUrl: absoluteUrl(decodedPath, episodeUrl),
    });
  }

  return players;
}

function resolvePlayerHtml(playerHtml, sourcePageUrl) {
  const iframeSrc = matchOne(playerHtml, /<iframe[^>]+src="([^"]+)"/i);
  if (iframeSrc) {
    const embedUrl = absoluteUrl(iframeSrc, sourcePageUrl);
    let subtitlesUrl = null;

    try {
      subtitlesUrl = new URL(embedUrl).searchParams.get("sub.info");
    } catch {
      subtitlesUrl = null;
    }

    return {
      embedUrl,
      subtitlesUrl,
      resolutionType: "iframe",
    };
  }

  const redirectUrl = matchOne(
    playerHtml,
    /window\.location\.href\s*=\s*["']([^"']+)["']/i,
  );

  if (redirectUrl) {
    return {
      embedUrl: absoluteUrl(redirectUrl, sourcePageUrl),
      subtitlesUrl: null,
      resolutionType: "redirect",
    };
  }

  return {
    embedUrl: null,
    subtitlesUrl: null,
    resolutionType: "unresolved",
  };
}

async function resolvePlayers(players, episodeUrl, includeUnresolved) {
  const resolved = [];

  for (const player of players) {
    try {
      const html = await fetchText(player.sourcePageUrl, episodeUrl);
      const resolution = resolvePlayerHtml(html, player.sourcePageUrl);

      if (!resolution.embedUrl && !includeUnresolved) {
        continue;
      }

      resolved.push({
        ...player,
        ...resolution,
      });
    } catch (error) {
      if (!includeUnresolved) {
        continue;
      }

      resolved.push({
        ...player,
        embedUrl: null,
        subtitlesUrl: null,
        resolutionType: "error",
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return resolved;
}

async function fetchShow(slug, args) {
  const showHtml = await fetchText(`${BASE_URL}/serial/${slug}`);
  const show = getShowMetadata(slug, showHtml);

  if (!show.firstEpisodeUrl) {
    throw new Error(`Could not find a first episode link for show "${slug}"`);
  }

  const firstEpisodeHtml = await fetchText(show.firstEpisodeUrl, show.showUrl);
  const tvShowId = matchOne(firstEpisodeHtml, /\/episodes-list\?tvShowId=(\d+)/i);

  if (!tvShowId) {
    throw new Error(`Could not find tvShowId on ${show.firstEpisodeUrl}`);
  }

  const firstSeasonMatch = show.firstEpisodeUrl.match(/\/s(\d+)e(\d+)$/i);
  const initialSeason = Number.parseInt(firstSeasonMatch?.[1] ?? "1", 10);
  const episodesListHtml = await fetchText(
    `${BASE_URL}/episodes-list?tvShowId=${tvShowId}&season=${initialSeason}&episode=1`,
    show.firstEpisodeUrl,
  );

  const availableSeasons = getSeasonNumbers(episodesListHtml);
  const requestedSeasons =
    args.seasons.length > 0
      ? availableSeasons.filter((season) => args.seasons.includes(season))
      : availableSeasons;

  const episodes = [];

  for (const seasonNumber of requestedSeasons) {
    const seasonHtml =
      seasonNumber === initialSeason
        ? episodesListHtml
        : await fetchText(
            `${BASE_URL}/episodes-list?tvShowId=${tvShowId}&season=${seasonNumber}&episode=1`,
            show.showUrl,
          );

    const seasonEpisodes = getEpisodesFromList(slug, seasonNumber, seasonHtml);

    for (const episode of seasonEpisodes) {
      if (
        Number.isFinite(args.limitEpisodes) &&
        args.limitEpisodes !== null &&
        episodes.length >= args.limitEpisodes
      ) {
        return {
          ...show,
          tvShowId,
          availableSeasons,
          episodes,
        };
      }

      const episodeHtml = await fetchText(episode.episodeUrl, show.showUrl);
      const rawPlayers = extractPlayers(episodeHtml, episode.episodeUrl);
      const players = await resolvePlayers(
        rawPlayers,
        episode.episodeUrl,
        args.includeUnresolved,
      );

      episodes.push({
        ...episode,
        players,
      });
    }
  }

  return {
    ...show,
    tvShowId,
    availableSeasons,
    episodes,
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const showSlugs = await loadShowSlugs(args);

  if (showSlugs.length === 0) {
    printHelp();
    process.exit(1);
  }

  const startedAt = new Date().toISOString();
  const results = [];

  for (const slug of showSlugs) {
    console.error(`Fetching ${slug}...`);
    results.push(await fetchShow(slug, args));
  }

  const payload = {
    source: BASE_URL,
    fetchedAt: new Date().toISOString(),
    startedAt,
    showCount: results.length,
    shows: results,
  };

  const serialized = JSON.stringify(payload, null, 2);

  if (args.out) {
    const outputPath = path.resolve(process.cwd(), args.out);
    await mkdir(path.dirname(outputPath), { recursive: true });
    await writeFile(outputPath, serialized, "utf8");
    console.error(`Wrote ${outputPath}`);
  } else {
    console.log(serialized);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exit(1);
});
