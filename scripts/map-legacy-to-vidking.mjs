#!/usr/bin/env node

import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const TMDB_API_BASE = "https://api.themoviedb.org/3";
const VIDKING_BASE = "https://www.vidking.net";

function parseArgs(argv) {
  const args = {
    input: null,
    out: null,
    limit: null,
    mediaType: null,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--input") {
      args.input = argv[++index] ?? null;
      continue;
    }
    if (arg === "--out") {
      args.out = argv[++index] ?? null;
      continue;
    }
    if (arg === "--limit") {
      args.limit = Number.parseInt(argv[++index] ?? "", 10);
      continue;
    }
    if (arg === "--media-type") {
      const value = argv[++index] ?? "";
      if (value !== "movie" && value !== "serial") {
        throw new Error("--media-type must be movie or serial");
      }
      args.mediaType = value;
      continue;
    }
    if (arg === "--help" || arg === "-h") {
      printHelp();
      process.exit(0);
    }
    if (!args.input) {
      args.input = arg;
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }

  return args;
}

function printHelp() {
  console.log(`Usage:
  node scripts/map-legacy-to-vidking.mjs --input downloads/legacy.json --out downloads/vidking-map.json

Input can be a Spilled library export, fetch-svetserialu-shows output, or an array
of objects with title/showTitle/name and optional mediaType/year/episodes.

Options:
  --input <path>             JSON input file
  --out <path>               Write mapped JSON to this file
  --media-type <movie|serial> Override media type for all loose records
  --limit <count>            Stop after N titles
  --help                     Show this help
`);
}

function getTmdbReadToken() {
  return process.env.TMDB_API_READ_TOKEN?.trim() || "";
}

function parseYear(value) {
  return String(value ?? "").match(/\b(19|20)\d{2}\b/)?.[0] ?? null;
}

function normalizeTitle(value) {
  return String(value ?? "")
    .replace(/\s+-\s+s\d+e\d+.*$/i, "")
    .replace(/\s*\((19|20)\d{2}\)\s*$/i, "")
    .replace(/\s+/g, " ")
    .trim();
}

function inferMediaType(record, override) {
  if (override) return override;
  if (record.mediaType === "movie" || record.episodeCode === "movie") return "movie";
  if (record.mediaType === "serial" || Array.isArray(record.episodes)) return "serial";
  return "serial";
}

function flattenInput(payload, mediaTypeOverride) {
  const source = Array.isArray(payload)
    ? payload
    : Array.isArray(payload.shows)
      ? payload.shows
      : Array.isArray(payload.libraryState?.shows)
        ? payload.libraryState.shows
        : Array.isArray(payload.state?.shows)
          ? payload.state.shows
          : [];

  const records = [];
  for (const item of source) {
    if (!item || typeof item !== "object") {
      continue;
    }
    const title = normalizeTitle(item.title ?? item.showTitle ?? item.name ?? item.slug);
    if (!title) {
      continue;
    }
    records.push({
      legacySlug: item.slug ?? item.showSlug ?? null,
      title,
      year: parseYear(item.years ?? item.year ?? item.releaseDate ?? item.firstAirDate),
      mediaType: inferMediaType(item, mediaTypeOverride),
      source: item.source ?? item.sourceHost ?? item.platform ?? null,
      episodes: Array.isArray(item.episodes)
        ? item.episodes.map((episode) => ({
            seasonNumber: episode.seasonNumber ?? null,
            episodeNumber: episode.episodeNumber ?? null,
            episodeCode: episode.episodeCode ?? null,
            title: episode.episodeTitle ?? null,
          }))
        : [],
    });
  }

  const unique = new Map();
  for (const record of records) {
    unique.set(`${record.mediaType}:${record.title.toLowerCase()}:${record.year ?? ""}`, record);
  }
  return Array.from(unique.values());
}

async function fetchTmdbJson(url) {
  const token = getTmdbReadToken();
  if (!token) {
    throw new Error("TMDB_API_READ_TOKEN is required.");
  }
  const response = await fetch(url, {
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${token}`,
    },
  });
  if (!response.ok) {
    throw new Error(`TMDB request failed: ${response.status} ${response.statusText}`);
  }
  return await response.json();
}

function scoreCandidate(record, candidate) {
  const title = String(candidate.title ?? candidate.name ?? "").toLowerCase();
  const originalTitle = String(candidate.original_title ?? candidate.original_name ?? "").toLowerCase();
  const query = record.title.toLowerCase();
  const year = parseYear(candidate.release_date ?? candidate.first_air_date);
  let score = 0;
  if (title === query || originalTitle === query) score += 100;
  if (title.includes(query) || query.includes(title)) score += 40;
  if (record.year && year === record.year) score += 35;
  score += Math.min(20, Math.round(candidate.popularity ?? 0));
  return score;
}

async function mapRecord(record) {
  const routeType = record.mediaType === "serial" ? "tv" : "movie";
  const url = new URL(`${TMDB_API_BASE}/search/${routeType}`);
  url.searchParams.set("query", record.title);
  url.searchParams.set("include_adult", "false");
  url.searchParams.set("language", "en-US");
  url.searchParams.set("page", "1");
  if (record.year) {
    url.searchParams.set(routeType === "movie" ? "year" : "first_air_date_year", record.year);
  }

  const payload = await fetchTmdbJson(url.toString());
  const candidates = (payload.results ?? [])
    .map((candidate) => ({ candidate, score: scoreCandidate(record, candidate) }))
    .sort((left, right) => right.score - left.score);
  const best = candidates[0];
  if (!best?.candidate?.id || best.score <= 0) {
    return {
      ...record,
      status: "unmatched",
      candidates: candidates.slice(0, 3).map(({ candidate, score }) => ({
        tmdbId: candidate.id,
        title: candidate.title ?? candidate.name ?? null,
        year: parseYear(candidate.release_date ?? candidate.first_air_date),
        score,
      })),
    };
  }

  const tmdbId = String(best.candidate.id);
  const title = best.candidate.title ?? best.candidate.name ?? record.title;
  const vidkingSlug = `${routeType}/${tmdbId}`;
  const embedUrl = `${VIDKING_BASE}/embed/${vidkingSlug}`;
  return {
    ...record,
    status: "matched",
    tmdbId,
    tmdbTitle: title,
    tmdbYear: parseYear(best.candidate.release_date ?? best.candidate.first_air_date),
    matchScore: best.score,
    vidkingSlug,
    embedUrl,
    episodeEmbedUrls: record.mediaType === "serial"
      ? record.episodes
          .filter((episode) => Number.isFinite(episode.seasonNumber) && Number.isFinite(episode.episodeNumber))
          .map((episode) => ({
            seasonNumber: episode.seasonNumber,
            episodeNumber: episode.episodeNumber,
            episodeCode: episode.episodeCode,
            embedUrl: `${VIDKING_BASE}/embed/tv/${tmdbId}/${episode.seasonNumber}/${episode.episodeNumber}`,
          }))
      : [],
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.input) {
    printHelp();
    process.exit(1);
  }

  const inputPath = path.resolve(process.cwd(), args.input);
  const payload = JSON.parse(await readFile(inputPath, "utf8"));
  const records = flattenInput(payload, args.mediaType);
  const limit = Number.isFinite(args.limit) && args.limit > 0 ? args.limit : records.length;
  const mapped = [];

  for (const record of records.slice(0, limit)) {
    console.error(`Mapping ${record.mediaType}: ${record.title}`);
    mapped.push(await mapRecord(record));
  }

  const output = {
    sourceFile: inputPath,
    generatedAt: new Date().toISOString(),
    total: mapped.length,
    matched: mapped.filter((entry) => entry.status === "matched").length,
    unmatched: mapped.filter((entry) => entry.status === "unmatched").length,
    items: mapped,
  };
  const serialized = JSON.stringify(output, null, 2);

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
