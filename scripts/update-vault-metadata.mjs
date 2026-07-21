#!/usr/bin/env node
import { existsSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";

const HOMEPAGE_ARTWORK_VERSION = 5;

function normalizeLooseText(value) {
  return String(value || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function isImportHelperText(value) {
  const normalized = normalizeLooseText(value);
  return (
    normalized === "ako spustit video" ||
    normalized.startsWith("ako spustit video ") ||
    normalized === "jak spustit video" ||
    normalized.startsWith("jak spustit video ")
  );
}

function uniqueStrings(values) {
  const seen = new Set();
  const result = [];
  for (const value of values) {
    const normalized = value?.trim();
    if (!normalized) continue;
    const key = normalized.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(normalized);
  }
  return result;
}

function parseYearNumber(value) {
  const match = String(value ?? "").match(/\b(19|20)\d{2}\b/);
  return match ? Number.parseInt(match[0], 10) : null;
}

function parseCsfdRating(value) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.max(0, Math.min(100, value));
  }
  const match = String(value ?? "").match(/(?:CSFD\s*)?(\d{1,3})\s*%/i);
  if (!match) return null;
  const rating = Number.parseInt(match[1], 10);
  return Number.isFinite(rating) ? Math.max(0, Math.min(100, rating)) : null;
}

function mergeRatings(left, right, ...legacyValues) {
  const ratings = [...(left?.ratings ?? []), ...(right?.ratings ?? [])];
  for (const value of legacyValues) {
    const rating = parseCsfdRating(value);
    if (rating !== null) {
      ratings.push({ source: "csfd", value: rating, scale: 100, label: `${rating}%` });
    }
  }

  const seen = new Set();
  return ratings.filter((rating) => {
    const key = `${rating.source}:${rating.value}:${rating.scale}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function inferShowMediaType(show) {
  return show.mediaType ?? (show.episodes?.length === 1 && show.episodes?.[0]?.episodeCode === "movie" ? "movie" : "serial");
}

function inferRuntimeMinutes(show) {
  if (typeof show.metadata?.runtimeMinutes === "number" && Number.isFinite(show.metadata.runtimeMinutes)) {
    return show.metadata.runtimeMinutes;
  }
  if (typeof show.runtimeMinutes === "number" && Number.isFinite(show.runtimeMinutes)) {
    return show.runtimeMinutes;
  }
  const movieDuration = show.episodes?.length === 1 ? show.episodes?.[0]?.durationSeconds ?? show.episodes?.[0]?.playbackDurationSeconds : undefined;
  return typeof movieDuration === "number" && Number.isFinite(movieDuration) && movieDuration > 0
    ? Math.round(movieDuration / 60)
    : null;
}

function hydrateArtwork(show) {
  return {
    posterUrl: show.artwork?.posterUrl ?? show.posterUrl ?? null,
    backdropUrl: show.artwork?.backdropUrl ?? show.backdropUrl ?? null,
    bannerUrl: show.artwork?.bannerUrl ?? show.bannerUrl ?? null,
    clearLogoUrl: show.artwork?.clearLogoUrl ?? show.clearLogoUrl ?? null,
    bannerWithLogoUrl: show.artwork?.bannerWithLogoUrl ?? show.homepageBannerUrl ?? null,
  };
}

function hydrateMetadata(show) {
  const episodes = Array.isArray(show.episodes) ? show.episodes : [];
  const availableSeasons = Array.from(new Set([
    ...(Array.isArray(show.availableSeasons) ? show.availableSeasons : []),
    ...episodes.map((episode) => episode.seasonNumber),
  ])).filter((season) => Number.isFinite(season));
  const year = show.metadata?.year ?? parseYearNumber(show.years) ?? parseYearNumber(show.canonicalIdentity?.year);
  const genres = uniqueStrings([
    ...(show.metadata?.genres ?? []),
    ...(Array.isArray(show.genres) ? show.genres : []),
  ]);
  const actors = show.metadata?.actors?.length ? show.metadata.actors : show.actors ?? [];
  const directors = show.metadata?.directors?.length ? show.metadata.directors : show.directors ?? [];

  return {
    title: show.metadata?.title ?? show.title ?? "Untitled",
    originalTitle: show.metadata?.originalTitle ?? show.altTitle ?? show.canonicalIdentity?.originalTitle ?? null,
    description: show.metadata?.description ?? show.description ?? null,
    year,
    years: show.metadata?.years ?? show.years ?? (year ? String(year) : null),
    mediaType: show.metadata?.mediaType ?? inferShowMediaType(show),
    runtimeMinutes: inferRuntimeMinutes(show),
    seasonCount: availableSeasons.length || (inferShowMediaType(show) === "movie" ? 1 : 0),
    episodeCount: episodes.length,
    genres,
    ratings: mergeRatings(show.metadata, undefined, show.csfdRating, show.rating, show.years, show.description),
    actors,
    directors,
    updatedAt: show.metadata?.updatedAt ?? Date.now(),
  };
}

function normalizeShow(show) {
  const episodes = Array.isArray(show.episodes)
    ? show.episodes.map((episode) => ({
        ...episode,
        durationSeconds: episode.durationSeconds ?? episode.playbackDurationSeconds,
        players: Array.isArray(episode.players) ? episode.players : [],
      }))
    : [];
  const showWithEpisodes = {
    ...show,
    episodes,
    availableSeasons: Array.isArray(show.availableSeasons)
      ? show.availableSeasons
      : Array.from(new Set(episodes.map((episode) => episode.seasonNumber))).filter((season) => Number.isFinite(season)),
  };
  const homepageArtworkIsCurrent = showWithEpisodes.homepageArtworkVersion === HOMEPAGE_ARTWORK_VERSION;
  const artwork = hydrateArtwork(showWithEpisodes);
  const metadata = hydrateMetadata(showWithEpisodes);

  return {
    ...showWithEpisodes,
    altTitle: isImportHelperText(showWithEpisodes.altTitle) ? null : showWithEpisodes.altTitle ?? null,
    posterUrl: artwork.posterUrl,
    backdropUrl: artwork.backdropUrl,
    bannerUrl: artwork.bannerUrl,
    clearLogoUrl: artwork.clearLogoUrl,
    artwork,
    metadata,
    actors: metadata.actors,
    directors: metadata.directors,
    homepagePosterUrl: homepageArtworkIsCurrent ? showWithEpisodes.homepagePosterUrl ?? null : null,
    homepageBannerUrl: homepageArtworkIsCurrent ? artwork.bannerWithLogoUrl ?? showWithEpisodes.homepageBannerUrl ?? null : null,
    homepageArtworkVersion: homepageArtworkIsCurrent ? showWithEpisodes.homepageArtworkVersion ?? null : null,
    episodes,
  };
}

function normalizeLibraryState(state) {
  return {
    ...state,
    shows: Array.isArray(state?.shows) ? state.shows.map(normalizeShow) : [],
    query: typeof state?.query === "string" ? state.query : "",
    offlineDownloads: state?.offlineDownloads && typeof state.offlineDownloads === "object" ? state.offlineDownloads : {},
    settings: state?.settings ?? {},
  };
}

function findSnapshotPath(inputPath) {
  const target = resolve(inputPath || process.cwd());
  const candidates = [
    target,
    join(target, "library-state.json"),
    join(target, "spilled-library", "library-state.json"),
  ];
  for (const candidate of candidates) {
    if (existsSync(candidate) && statSync(candidate).isFile()) return candidate;
  }
  throw new Error(`Could not find library-state.json from ${target}`);
}

function main() {
  const snapshotPath = findSnapshotPath(process.argv[2]);
  const raw = readFileSync(snapshotPath, "utf8");
  const parsed = JSON.parse(raw);
  const hasVaultEnvelope = parsed && typeof parsed === "object" && "libraryState" in parsed;
  const normalized = hasVaultEnvelope
    ? { ...parsed, libraryState: normalizeLibraryState(parsed.libraryState), updatedAt: Date.now() }
    : normalizeLibraryState(parsed);
  const output = `${JSON.stringify(normalized, null, 2)}\n`;
  const backupPath = `${snapshotPath}.bak-${new Date().toISOString().replace(/[:.]/g, "-")}`;

  renameSync(snapshotPath, backupPath);
  writeFileSync(snapshotPath, output, "utf8");

  const showCount = hasVaultEnvelope
    ? normalized.libraryState.shows.length
    : normalized.shows.length;
  console.log(`Updated ${showCount} title(s) in ${snapshotPath}`);
  console.log(`Backup: ${backupPath}`);
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  console.error(`Usage: node ${basename(process.argv[1])} [vault-folder-or-library-state.json]`);
  process.exit(1);
}
