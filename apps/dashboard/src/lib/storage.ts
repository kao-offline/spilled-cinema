import type {
  LibraryEpisode,
  LibraryState,
  PlayerAlias,
  ImportedShow,
  LibrarySettings,
  OfflineEpisodeDownload,
  CastMember,
} from "./types";
import { archiveImportedShow } from "./import-archive";
import { HOMEPAGE_ARTWORK_VERSION } from "./import-client";
import { getIntegrationById, type IntegrationId } from "./integrations";
import { balanceImageResolution } from "./image-resolution";

const STORAGE_KEY = "spilled-library.state.v1";
const DOWNLOADED_LANGUAGE_KEY = "spilled-library.downloaded-languages.v1";
const WELCOME_DISMISSED_KEY = "spilled-library.welcome-dismissed.v2";

const emptyState: LibraryState = {
  shows: [],
  query: "",
  offlineDownloads: {},
  settings: {
    autoplayNext: true,
    offlineSizeLimitMb: 2048,
    downloadEngine: "localffmpeg",
    connectedFolderName: undefined,
    preferredSeriesSource: "vidking",
    preferredMovieSource: "vidking",
    artworkSources: {
      tmdb: true,
      fanart: true,
      tvdb: true,
    },
  },
};

function normalizeLooseText(value: string | null | undefined) {
  return String(value || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function isImportHelperText(value: string | null | undefined) {
  const normalized = normalizeLooseText(value);
  return (
    normalized === "ako spustit video" ||
    normalized.startsWith("ako spustit video ") ||
    normalized === "jak spustit video" ||
    normalized.startsWith("jak spustit video ")
  );
}

function uniqueStrings(values: Array<string | null | undefined>) {
  const seen = new Set<string>();
  const result: string[] = [];
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

function mergeCastMembers(existing: CastMember[] = [], incoming: CastMember[] = []) {
  const merged: CastMember[] = [];
  const indexes = new Map<string, number>();

  for (const member of [...existing, ...incoming]) {
    const name = member.name?.trim();
    if (!name) continue;
    const key = normalizeLooseText(name);
    const existingIndex = indexes.get(key);
    if (existingIndex === undefined) {
      indexes.set(key, merged.length);
      merged.push({ ...member, name });
      continue;
    }

    const current = merged[existingIndex];
    merged[existingIndex] = {
      ...current,
      ...member,
      name: current.name || name,
      role: member.role?.trim() || current.role || null,
      profileUrl: member.profileUrl?.trim() || current.profileUrl || null,
    };
  }

  return merged;
}

function parseYearNumber(value: string | number | null | undefined) {
  const match = String(value ?? "").match(/\b(19|20)\d{2}\b/);
  return match ? Number.parseInt(match[0], 10) : null;
}

function parseCsfdRating(value: string | number | null | undefined) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.max(0, Math.min(100, value));
  }
  const match = String(value ?? "").match(/(?:CSFD\s*)?(\d{1,3})\s*%/i);
  if (!match) return null;
  const rating = Number.parseInt(match[1], 10);
  return Number.isFinite(rating) ? Math.max(0, Math.min(100, rating)) : null;
}

function mergeRatings(left: ImportedShow["metadata"], right: ImportedShow["metadata"], ...legacyValues: Array<string | number | null | undefined>) {
  const ratings = [...(left?.ratings ?? []), ...(right?.ratings ?? [])];
  for (const value of legacyValues) {
    const rating = parseCsfdRating(value);
    if (rating !== null) {
      ratings.push({ source: "csfd", value: rating, scale: 100, label: `${rating}%` });
    }
  }

  const seen = new Set<string>();
  return ratings.filter((rating) => {
    const key = `${rating.source}:${rating.value}:${rating.scale}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function inferShowMediaType(show: ImportedShow) {
  return show.mediaType ?? (show.episodes.length === 1 && show.episodes[0]?.episodeCode === "movie" ? "movie" : "serial");
}

function inferRuntimeMinutes(show: ImportedShow) {
  const extendedShow = show as ImportedShow & { runtimeMinutes?: number | null };
  if (typeof show.metadata?.runtimeMinutes === "number" && Number.isFinite(show.metadata.runtimeMinutes)) {
    return show.metadata.runtimeMinutes;
  }
  if (typeof extendedShow.runtimeMinutes === "number" && Number.isFinite(extendedShow.runtimeMinutes)) {
    return extendedShow.runtimeMinutes;
  }
  const movieDuration = show.episodes.length === 1 ? show.episodes[0]?.durationSeconds ?? show.episodes[0]?.playbackDurationSeconds : undefined;
  return typeof movieDuration === "number" && Number.isFinite(movieDuration) && movieDuration > 0
    ? Math.round(movieDuration / 60)
    : null;
}

function hydrateShowArtwork(show: ImportedShow): NonNullable<ImportedShow["artwork"]> {
  return {
    posterUrl: balanceImageResolution(show.artwork?.posterUrl ?? show.posterUrl ?? null, "poster-detail"),
    backdropUrl: balanceImageResolution(show.artwork?.backdropUrl ?? show.backdropUrl ?? null, "backdrop-hero"),
    bannerUrl: balanceImageResolution(show.artwork?.bannerUrl ?? show.bannerUrl ?? null, "backdrop-hero"),
    clearLogoUrl: balanceImageResolution(show.artwork?.clearLogoUrl ?? show.clearLogoUrl ?? null, "logo"),
    bannerWithLogoUrl: balanceImageResolution(show.artwork?.bannerWithLogoUrl ?? show.homepageBannerUrl ?? null, "backdrop-hero"),
  };
}

function hydrateShowMetadata(show: ImportedShow): NonNullable<ImportedShow["metadata"]> {
  const extendedShow = show as ImportedShow & {
    genres?: string[] | null;
    rating?: string | number | null;
    csfdRating?: string | number | null;
  };
  const availableSeasons = Array.from(new Set([
    ...show.availableSeasons,
    ...show.episodes.map((episode) => episode.seasonNumber),
  ])).filter((season) => Number.isFinite(season));
  const year = show.metadata?.year ?? parseYearNumber(show.years) ?? parseYearNumber(show.canonicalIdentity?.year);
  const genres = uniqueStrings([
    ...(show.metadata?.genres ?? []),
    ...(Array.isArray(extendedShow.genres) ? extendedShow.genres : []),
  ]);
  const actors = mergeCastMembers(show.actors ?? [], show.metadata?.actors ?? []);
  const directors = mergeCastMembers(show.directors ?? [], show.metadata?.directors ?? []);

  return {
    title: show.metadata?.title ?? show.title,
    originalTitle: show.metadata?.originalTitle ?? show.altTitle ?? show.canonicalIdentity?.originalTitle ?? null,
    description: show.metadata?.description ?? show.description ?? null,
    year,
    years: show.metadata?.years ?? show.years ?? (year ? String(year) : null),
    mediaType: show.metadata?.mediaType ?? inferShowMediaType(show),
    runtimeMinutes: inferRuntimeMinutes(show),
    seasonCount: availableSeasons.length || (inferShowMediaType(show) === "movie" ? 1 : 0),
    episodeCount: show.episodes.length,
    genres,
    ratings: mergeRatings(show.metadata, undefined, extendedShow.csfdRating, extendedShow.rating, show.years, show.description),
    actors,
    directors,
    updatedAt: show.metadata?.updatedAt ?? Date.now(),
    enrichmentVersion: show.metadata?.enrichmentVersion,
  };
}

function sanitizeImportedShow(show: ImportedShow): ImportedShow {
  const episodes = mergeDuplicateEpisodes(show.episodes ?? []);
  const showWithEpisodes = { ...show, episodes };
  const homepageArtworkIsCurrent = show.homepageArtworkVersion === HOMEPAGE_ARTWORK_VERSION;
  const artwork = hydrateShowArtwork(showWithEpisodes);
  const metadata = hydrateShowMetadata(showWithEpisodes);
  return {
    ...showWithEpisodes,
    altTitle: isImportHelperText(show.altTitle) ? null : show.altTitle ?? null,
    posterUrl: artwork.posterUrl,
    backdropUrl: artwork.backdropUrl,
    bannerUrl: artwork.bannerUrl,
    clearLogoUrl: artwork.clearLogoUrl,
    artwork,
    metadata,
    actors: metadata.actors,
    directors: metadata.directors,
    homepagePosterUrl: homepageArtworkIsCurrent ? balanceImageResolution(show.homepagePosterUrl ?? null, "poster-card") : null,
    homepageBannerUrl: homepageArtworkIsCurrent ? artwork.bannerWithLogoUrl ?? show.homepageBannerUrl ?? null : null,
    homepageArtworkVersion: homepageArtworkIsCurrent ? show.homepageArtworkVersion ?? null : null,
  };
}

export function normalizeLibraryStateCandidate(parsed: Partial<LibraryState> | null | undefined): LibraryState {
  return {
    shows: Array.isArray(parsed?.shows) ? parsed.shows.map((show) => sanitizeImportedShow(show as ImportedShow)) : [],
    selectedEpisodeId: typeof parsed?.selectedEpisodeId === "string" ? parsed.selectedEpisodeId : undefined,
    query: typeof parsed?.query === "string" ? parsed.query : "",
    settings: {
      ...emptyState.settings,
      ...(parsed?.settings ?? {}),
      artworkSources: {
        ...emptyState.settings.artworkSources,
        ...(parsed?.settings?.artworkSources && typeof parsed.settings.artworkSources === "object"
          ? parsed.settings.artworkSources
          : {}),
      },
      preferredSeriesSource: coerceIntegrationId(parsed?.settings?.preferredSeriesSource, emptyState.settings.preferredSeriesSource),
      preferredMovieSource: coerceIntegrationId(parsed?.settings?.preferredMovieSource, emptyState.settings.preferredMovieSource),
    },
    offlineDownloads:
      parsed?.offlineDownloads && typeof parsed.offlineDownloads === "object"
        ? (parsed.offlineDownloads as Record<string, OfflineEpisodeDownload>)
        : {},
  };
}

function canUseStorage() {
  return typeof window !== "undefined";
}

export function hasDismissedWelcome() {
  if (!canUseStorage()) {
    return false;
  }

  return window.localStorage.getItem(WELCOME_DISMISSED_KEY) === "true";
}

export function dismissWelcome() {
  if (!canUseStorage()) {
    return;
  }

  window.localStorage.setItem(WELCOME_DISMISSED_KEY, "true");
}

function coerceIntegrationId(value: unknown, fallback: IntegrationId) {
  if (typeof value !== "string") {
    return fallback;
  }
  return getIntegrationById(value as IntegrationId)?.id ?? fallback;
}

export function readLibraryState(): LibraryState {
  if (!canUseStorage()) {
    return emptyState;
  }

  const raw = window.localStorage.getItem(STORAGE_KEY);
  if (!raw) {
    return emptyState;
  }

  try {
    const parsed = JSON.parse(raw) as Partial<LibraryState>;
    const normalized = normalizeLibraryStateCandidate(parsed);
    const normalizedRaw = JSON.stringify(normalized);
    if (normalizedRaw !== raw) {
      window.localStorage.setItem(STORAGE_KEY, normalizedRaw);
    }
    return normalized;
  } catch {
    return emptyState;
  }
}

export function writeLibraryState(state: LibraryState) {
  if (!canUseStorage()) {
    return;
  }

  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

export function exportLibraryState() {
  return normalizeLibraryStateCandidate(readLibraryState());
}

export function importLibraryState(next: unknown) {
  if (!next || typeof next !== "object") {
    throw new Error("Library snapshot must be a JSON object.");
  }

  const normalized = normalizeLibraryStateCandidate(next as Partial<LibraryState>);
  writeLibraryState(normalized);
  return normalized;
}

type DownloadedLanguageMap = Record<string, string>;

export function readDownloadedLanguageMap(): DownloadedLanguageMap {
  if (!canUseStorage()) {
    return {};
  }
  const raw = window.localStorage.getItem(DOWNLOADED_LANGUAGE_KEY);
  if (!raw) {
    return {};
  }
  try {
    const parsed = JSON.parse(raw) as DownloadedLanguageMap;
    if (!parsed || typeof parsed !== "object") {
      return {};
    }
    return parsed;
  } catch {
    return {};
  }
}

function writeDownloadedLanguageMap(map: DownloadedLanguageMap) {
  if (!canUseStorage()) {
    return;
  }
  window.localStorage.setItem(DOWNLOADED_LANGUAGE_KEY, JSON.stringify(map));
}

export function replaceDownloadedLanguageMap(map: DownloadedLanguageMap) {
  writeDownloadedLanguageMap(map);
  return map;
}

function isGenericEpisodeTitle(value: string | null | undefined, episodeNumber?: number | null) {
  const title = String(value || "").trim();
  if (!title) {
    return true;
  }

  if (/^episode\s+\d+$/i.test(title)) {
    return true;
  }

  if (typeof episodeNumber === "number" && Number.isFinite(episodeNumber) && title.toLowerCase() === `episode ${episodeNumber}`) {
    return true;
  }

  return false;
}

function normalizeIdentityText(value: string | null | undefined) {
  return normalizeLooseText(value).replace(/\s+/g, " ");
}

function parseYear(value: string | number | null | undefined) {
  const match = String(value ?? "").match(/\b(19|20)\d{2}\b/);
  return match?.[0] ?? null;
}

function importedShowIdentityKeys(show: ImportedShow) {
  const keys = new Set<string>([`slug:${show.slug}`]);
  const mediaType = show.mediaType ?? (show.episodes.length === 1 && show.episodes[0]?.episodeCode === "movie" ? "movie" : "serial");
  const normalizedTitle = normalizeIdentityText(show.title);
  const year = parseYear(show.years ?? show.canonicalIdentity?.year);

  for (const [name, value] of Object.entries(show.externalIds ?? {})) {
    if (value) keys.add(`external:${name}:${String(value).toLowerCase()}`);
  }
  for (const [name, value] of Object.entries(show.canonicalIdentity?.externalIds ?? {})) {
    if (value) keys.add(`external:${name}:${String(value).toLowerCase()}`);
  }
  if (show.canonicalIdentity?.identityId) {
    keys.add(`identity:${show.canonicalIdentity.identityId}`);
  }
  if (normalizedTitle && year) {
    keys.add(`title:${mediaType}:${normalizedTitle}:${year}`);
  }

  return keys;
}

function showsReferToSameTitle(left: ImportedShow, right: ImportedShow) {
  const leftKeys = importedShowIdentityKeys(left);
  for (const key of importedShowIdentityKeys(right)) {
    if (leftKeys.has(key)) {
      return true;
    }
  }
  return false;
}

function episodeMergeKey(episode: LibraryEpisode) {
  if (episode.episodeCode === "movie" || episode.episodeNumber === null) {
    return "movie";
  }
  if (Number.isFinite(episode.seasonNumber) && Number.isFinite(episode.episodeNumber)) {
    return `number:${episode.seasonNumber}:${episode.episodeNumber}`;
  }
  const parsedCode = parseEpisodeCode(episode.episodeCode);
  if (parsedCode) {
    return `number:${parsedCode.seasonNumber}:${parsedCode.episodeNumber}`;
  }
  return `number:${episode.seasonNumber}:${episode.episodeNumber ?? "unknown"}`;
}

function parseEpisodeCode(value: string | null | undefined) {
  const match = value?.match(/s0*(\d+)\s*e0*(\d+)/i);
  if (!match) {
    return null;
  }
  return {
    seasonNumber: Number.parseInt(match[1], 10),
    episodeNumber: Number.parseInt(match[2], 10),
  };
}

function uniquePlayerAlias(player: LibraryEpisode["players"][number], players: LibraryEpisode["players"]) {
  if (!players.some((entry) => entry.alias === player.alias)) {
    return player.alias;
  }
  const base = `${player.alias}-${player.provider || "source"}`;
  let candidate = base;
  let suffix = 2;
  while (players.some((entry) => entry.alias === candidate)) {
    candidate = `${base}-${suffix}`;
    suffix += 1;
  }
  return candidate;
}

function normalizeEpisodePlayerAliases(episode: LibraryEpisode): LibraryEpisode {
  const normalizedPlayers: LibraryEpisode["players"] = [];
  for (const player of episode.players ?? []) {
    normalizedPlayers.push({
      ...player,
      alias: uniquePlayerAlias(player, normalizedPlayers) as PlayerAlias,
    });
  }

  return {
    ...episode,
    players: normalizedPlayers,
    selectedPlayerAlias: normalizedPlayers.some((player) => player.alias === episode.selectedPlayerAlias)
      ? episode.selectedPlayerAlias
      : normalizedPlayers[0]?.alias ?? episode.selectedPlayerAlias,
  };
}

function mergeEpisodePlayers(existingPlayers: LibraryEpisode["players"], nextPlayers: LibraryEpisode["players"]) {
  const players = [...existingPlayers];
  const refreshedBombujAliases = new Set<string>();
  const isBombujRefresh = nextPlayers.length > 0 && nextPlayers.every((player) => player.alias.startsWith("bombuj-"));
  for (const nextPlayer of nextPlayers) {
    const exactSourceIndex = players.findIndex((entry) =>
      entry.provider === nextPlayer.provider && entry.embedUrl === nextPlayer.embedUrl
    );
    const compatibleAliasIndex = players.findIndex((entry) =>
      entry.alias === nextPlayer.alias && entry.provider === nextPlayer.provider
    );
    const existingIndex = exactSourceIndex >= 0 ? exactSourceIndex : compatibleAliasIndex;

    if (existingIndex >= 0) {
      const existingPlayer = players[existingIndex];
      const sameSource = exactSourceIndex >= 0;
      const reusableResolution = sameSource && existingPlayer.resolutionStatus === "resolved" && Boolean(existingPlayer.streamUrl);
      players[existingIndex] = reusableResolution
        ? {
            ...nextPlayer,
            alias: existingPlayer.alias,
            streamUrl: existingPlayer.streamUrl,
            streamType: existingPlayer.streamType ?? nextPlayer.streamType,
            streamRefererUrl: existingPlayer.streamRefererUrl ?? nextPlayer.streamRefererUrl,
            subtitlesUrl: nextPlayer.subtitlesUrl ?? existingPlayer.subtitlesUrl,
            resolutionStatus: "resolved",
            resolutionHash: existingPlayer.resolutionHash,
            resolvedAt: existingPlayer.resolvedAt,
          }
        : {
            ...nextPlayer,
            alias: existingPlayer.alias,
            resolutionStatus: nextPlayer.resolutionStatus ?? "unresolved",
            resolutionError: undefined,
            resolutionHash: undefined,
            resolvedAt: undefined,
            streamUrl: undefined,
            streamType: undefined,
            streamRefererUrl: undefined,
          };
      if (isBombujRefresh) {
        refreshedBombujAliases.add(players[existingIndex].alias);
      }
    } else {
      const addedPlayer = {
        ...nextPlayer,
        alias: uniquePlayerAlias(nextPlayer, players),
      };
      players.push(addedPlayer);
      if (isBombujRefresh) {
        refreshedBombujAliases.add(addedPlayer.alias);
      }
    }
  }
  if (!isBombujRefresh) {
    return players;
  }

  // A Bombuj import is a live snapshot of its server rows. Remove stale
  // Bombuj aliases that disappeared (VIP gates, dead aggregators, etc.) while
  // retaining companion sources imported from VidKing or other providers.
  return players.filter((player) =>
    !player.alias.startsWith("bombuj-") || refreshedBombujAliases.has(player.alias)
  );
}

function mergeProviderMatches(existingShow: ImportedShow, nextShow: ImportedShow) {
  const matches = [...(existingShow.providerMatches ?? [])];
  const seen = new Set(matches.map((match) => `${match.integrationId}:${match.providerItemId}`));
  for (const match of nextShow.providerMatches ?? []) {
    const key = `${match.integrationId}:${match.providerItemId}`;
    if (!seen.has(key)) {
      seen.add(key);
      matches.push(match);
    }
  }
  return matches.length > 0 ? matches : undefined;
}

function mergeShowArtwork(existingShow: ImportedShow, nextShow: ImportedShow): NonNullable<ImportedShow["artwork"]> {
  return {
    posterUrl: existingShow.artwork?.posterUrl ?? existingShow.posterUrl ?? nextShow.artwork?.posterUrl ?? nextShow.posterUrl ?? null,
    backdropUrl: existingShow.artwork?.backdropUrl ?? existingShow.backdropUrl ?? nextShow.artwork?.backdropUrl ?? nextShow.backdropUrl ?? null,
    bannerUrl: existingShow.artwork?.bannerUrl ?? existingShow.bannerUrl ?? nextShow.artwork?.bannerUrl ?? nextShow.bannerUrl ?? null,
    clearLogoUrl: existingShow.artwork?.clearLogoUrl ?? existingShow.clearLogoUrl ?? nextShow.artwork?.clearLogoUrl ?? nextShow.clearLogoUrl ?? null,
    bannerWithLogoUrl: existingShow.artwork?.bannerWithLogoUrl ?? existingShow.homepageBannerUrl ?? nextShow.artwork?.bannerWithLogoUrl ?? nextShow.homepageBannerUrl ?? null,
  };
}

function mergeShowMetadata(existingShow: ImportedShow, nextShow: ImportedShow, episodes: LibraryEpisode[]): NonNullable<ImportedShow["metadata"]> {
  const existing = hydrateShowMetadata(existingShow);
  const next = hydrateShowMetadata({ ...nextShow, episodes });
  const availableSeasons = Array.from(new Set([
    ...existingShow.availableSeasons,
    ...nextShow.availableSeasons,
    ...episodes.map((episode) => episode.seasonNumber),
  ])).filter((season) => Number.isFinite(season));

  return {
    ...existing,
    ...next,
    title: next.title || existing.title,
    originalTitle: next.originalTitle ?? existing.originalTitle ?? null,
    description: next.description ?? existing.description ?? null,
    year: next.year ?? existing.year ?? null,
    years: next.years ?? existing.years ?? null,
    mediaType: next.mediaType ?? existing.mediaType,
    runtimeMinutes: next.runtimeMinutes ?? existing.runtimeMinutes ?? null,
    seasonCount: availableSeasons.length || next.seasonCount || existing.seasonCount,
    episodeCount: episodes.length,
    genres: uniqueStrings([...(existing.genres ?? []), ...(next.genres ?? [])]),
    ratings: mergeRatings(existing, next),
    actors: mergeCastMembers(existing.actors, next.actors),
    directors: mergeCastMembers(existing.directors, next.directors),
    updatedAt: Date.now(),
    enrichmentVersion: Math.max(existing.enrichmentVersion ?? 0, next.enrichmentVersion ?? 0) || undefined,
  };
}

function rehomeEpisode(episode: LibraryEpisode, show: ImportedShow, idSuffix = episodeMergeKey(episode)): LibraryEpisode {
  if (episode.showSlug === show.slug) {
    return episode;
  }
  return {
    ...episode,
    id: `${show.slug}:${idSuffix}`,
    showSlug: show.slug,
    showTitle: show.title,
  };
}

function mergeImportedEpisode(existingEpisode: LibraryEpisode, nextEpisode: LibraryEpisode): LibraryEpisode {
  const shouldKeepExistingTitle =
    isGenericEpisodeTitle(nextEpisode.episodeTitle, nextEpisode.episodeNumber) &&
    !isGenericEpisodeTitle(existingEpisode.episodeTitle, existingEpisode.episodeNumber);
  const players = mergeEpisodePlayers(existingEpisode.players, nextEpisode.players);
  const selectedPlayerAlias = players.some((player) => player.alias === existingEpisode.selectedPlayerAlias)
    ? existingEpisode.selectedPlayerAlias
    : nextEpisode.selectedPlayerAlias;

  return {
    ...nextEpisode,
    id: existingEpisode.id,
    showSlug: existingEpisode.showSlug,
    showTitle: existingEpisode.showTitle,
    posterUrl: nextEpisode.posterUrl ?? existingEpisode.posterUrl,
    episodeTitle: shouldKeepExistingTitle ? existingEpisode.episodeTitle : nextEpisode.episodeTitle,
    durationSeconds: existingEpisode.durationSeconds ?? nextEpisode.durationSeconds ?? existingEpisode.playbackDurationSeconds ?? nextEpisode.playbackDurationSeconds,
    playbackPositionSeconds: existingEpisode.playbackPositionSeconds,
    playbackDurationSeconds: existingEpisode.playbackDurationSeconds,
    playbackUpdatedAt: existingEpisode.playbackUpdatedAt,
    players,
    selectedPlayerAlias,
  };
}

function mergeDuplicateEpisodes(episodes: LibraryEpisode[]) {
  const mergedEpisodes = new Map<string, LibraryEpisode>();
  for (const episode of episodes) {
    const key = episodeMergeKey(episode);
    const existingEpisode = mergedEpisodes.get(key);
    mergedEpisodes.set(key, existingEpisode ? mergeImportedEpisode(existingEpisode, episode) : normalizeEpisodePlayerAliases(episode));
  }
  return Array.from(mergedEpisodes.values()).map(normalizeEpisodePlayerAliases).sort((left, right) =>
    left.seasonNumber - right.seasonNumber ||
    (left.episodeNumber ?? 0) - (right.episodeNumber ?? 0) ||
    left.importedAt - right.importedAt
  );
}

function mergeImportedShow(existingShow: ImportedShow, nextShow: ImportedShow): ImportedShow {
  const existingEpisodesById = new Map(existingShow.episodes.map((episode) => [episode.id, episode]));
  const existingEpisodesByKey = new Map(existingShow.episodes.map((episode) => [episodeMergeKey(episode), episode]));
  const mergedEpisodes = new Map<string, LibraryEpisode>();

  for (const episode of nextShow.episodes) {
    const existingEpisode = existingEpisodesById.get(episode.id) ?? existingEpisodesByKey.get(episodeMergeKey(episode));
    if (existingEpisode) {
      mergedEpisodes.set(existingEpisode.id, mergeImportedEpisode(existingEpisode, episode));
    } else {
      const rehomed = rehomeEpisode(episode, existingShow);
      mergedEpisodes.set(rehomed.id, rehomed);
    }
  }

  for (const episode of existingShow.episodes) {
    if (!mergedEpisodes.has(episode.id)) {
      mergedEpisodes.set(episode.id, episode);
    }
  }
  const episodes = Array.from(mergedEpisodes.values()).sort((left, right) =>
    left.seasonNumber - right.seasonNumber ||
    (left.episodeNumber ?? 0) - (right.episodeNumber ?? 0) ||
    left.importedAt - right.importedAt
  );
  const artwork = mergeShowArtwork(existingShow, nextShow);
  const metadata = mergeShowMetadata(existingShow, nextShow, episodes);

  return {
    ...nextShow,
    slug: existingShow.slug,
    isFavorite: nextShow.isFavorite ?? existingShow.isFavorite,
    mediaType: nextShow.mediaType ?? existingShow.mediaType,
    externalIds: {
      ...(existingShow.externalIds ?? {}),
      ...(nextShow.externalIds ?? {}),
    },
    canonicalIdentity: nextShow.canonicalIdentity ?? existingShow.canonicalIdentity,
    providerMatches: mergeProviderMatches(existingShow, nextShow),
    posterUrl: artwork.posterUrl,
    backdropUrl: artwork.backdropUrl,
    bannerUrl: artwork.bannerUrl,
    homepagePosterUrl: nextShow.homepagePosterUrl ?? existingShow.homepagePosterUrl,
    homepageBannerUrl: artwork.bannerWithLogoUrl ?? nextShow.homepageBannerUrl ?? existingShow.homepageBannerUrl,
    homepageArtworkVersion: nextShow.homepageArtworkVersion ?? existingShow.homepageArtworkVersion,
    clearLogoUrl: artwork.clearLogoUrl,
    artwork,
    metadata,
    actors: metadata.actors,
    directors: metadata.directors,
    episodes,
  };
}

export function mergeLibraryStates(primaryState: LibraryState, secondaryState: LibraryState): LibraryState {
  const primary = normalizeLibraryStateCandidate(primaryState);
  const secondary = normalizeLibraryStateCandidate(secondaryState);
  const shows = [...primary.shows];

  for (const incomingShow of secondary.shows) {
    const existingIndex = shows.findIndex((show) => showsReferToSameTitle(show, incomingShow));
    if (existingIndex >= 0) {
      shows[existingIndex] = mergeImportedShow(shows[existingIndex], incomingShow);
    } else {
      shows.push(incomingShow);
    }
  }

  return normalizeLibraryStateCandidate({
    ...secondary,
    ...primary,
    shows: shows.sort((left, right) => right.importedAt - left.importedAt),
    settings: {
      ...secondary.settings,
      ...primary.settings,
      artworkSources: {
        ...secondary.settings.artworkSources,
        ...primary.settings.artworkSources,
      },
    },
    offlineDownloads: {
      ...secondary.offlineDownloads,
      ...primary.offlineDownloads,
    },
  });
}

export function updateShowCast(slug: string, actors: CastMember[], directors: CastMember[] = []) {
  const state = readLibraryState();
  const nextState = {
    ...state,
    shows: state.shows.map((show) => {
      if (show.slug !== slug) return show;
      const metadata = hydrateShowMetadata(show);
      const mergedActors = mergeCastMembers(metadata.actors, actors);
      const mergedDirectors = mergeCastMembers(metadata.directors, directors);
      return {
        ...show,
        actors: mergedActors,
        directors: mergedDirectors,
        metadata: {
          ...metadata,
          actors: mergedActors,
          directors: mergedDirectors,
          updatedAt: Date.now(),
        },
      };
    }),
  };
  writeLibraryState(nextState);
  return nextState;
}

export function setDownloadedLanguage(episodeId: string, language: string) {
  const map = readDownloadedLanguageMap();
  map[episodeId] = language;
  writeDownloadedLanguageMap(map);
}

export function removeDownloadedLanguage(episodeId: string) {
  const map = readDownloadedLanguageMap();
  if (map[episodeId]) {
    delete map[episodeId];
    writeDownloadedLanguageMap(map);
  }
}

export function upsertImportedShow(show: ImportedShow) {
  const state = readLibraryState();
  const shows = [...state.shows];
  const sanitizedShow = sanitizeImportedShow(show);
  const existingIndex = shows.findIndex((entry) => showsReferToSameTitle(entry, sanitizedShow));

  archiveImportedShow(sanitizedShow);

  if (existingIndex >= 0) {
    shows[existingIndex] = mergeImportedShow(shows[existingIndex], sanitizedShow);
  } else {
    shows.unshift(sanitizedShow);
  }

  const nextState = {
    ...state,
    shows: shows.sort((left, right) => right.importedAt - left.importedAt),
  };

  writeLibraryState(nextState);
  return nextState;
}

export function removeShow(slug: string) {
  const state = readLibraryState();
  const showToRemove = state.shows.find((show) => show.slug === slug);
  const nextOffline = { ...state.offlineDownloads };

  if (showToRemove) {
    for (const episode of showToRemove.episodes) {
      delete nextOffline[episode.id];
    }
  }

  const nextState = {
    ...state,
    shows: state.shows.filter((show) => show.slug !== slug),
    offlineDownloads: nextOffline,
  };
  writeLibraryState(nextState);
  return nextState;
}

export function toggleFavorite(slug: string) {
  const state = readLibraryState();
  const nextState = {
    ...state,
    shows: state.shows.map((show) => 
       show.slug === slug ? { ...show, isFavorite: !show.isFavorite } : show
    ),
  };
  writeLibraryState(nextState);
  return nextState;
}

export function updateSettings(updater: Partial<LibrarySettings>) {
  const state = readLibraryState();
  const nextState = {
    ...state,
    settings: {
      ...state.settings,
      ...updater,
    },
  };
  writeLibraryState(nextState);
  return nextState;
}

export function selectEpisode(episodeId?: string) {
  const state = readLibraryState();
  const nextState = {
    ...state,
    selectedEpisodeId: episodeId,
  };
  writeLibraryState(nextState);
  return nextState;
}

export function updateSelectedPlayer(episodeId: string, alias: PlayerAlias) {
  const state = readLibraryState();
  const nextState = {
    ...state,
    shows: state.shows.map((show) => ({
      ...show,
      episodes: show.episodes.map((episode) =>
        episode.id === episodeId
          ? { ...episode, selectedPlayerAlias: alias }
          : episode,
      ),
    })),
  };
  writeLibraryState(nextState);
  return nextState;
}

export function updateEpisodePlayerResolution(
  episodeId: string,
  player: LibraryEpisode["players"][number],
  resolved: {
    resolvedUrl: string;
    refererUrl: string;
    streamType?: LibraryEpisode["players"][number]["streamType"];
    subtitlesUrl?: string;
    resolutionHash?: string;
  },
) {
  const state = readLibraryState();
  const resolvedPlayer: LibraryEpisode["players"][number] = {
    ...player,
    streamUrl: resolved.resolvedUrl,
    streamRefererUrl: resolved.refererUrl,
    streamType: resolved.streamType ?? player.streamType,
    subtitlesUrl: resolved.subtitlesUrl ?? player.subtitlesUrl,
    resolutionStatus: "resolved",
    resolutionError: undefined,
    resolutionHash: resolved.resolutionHash ?? player.resolutionHash,
    resolvedAt: Date.now(),
  };

  const nextState = {
    ...state,
    shows: state.shows.map((show) => ({
      ...show,
      episodes: show.episodes.map((episode) => {
        if (episode.id !== episodeId) {
          return episode;
        }

        const players = [...episode.players];
        const existingIndex = players.findIndex((entry) =>
          entry.alias === resolvedPlayer.alias ||
          (entry.provider === resolvedPlayer.provider && entry.embedUrl === resolvedPlayer.embedUrl)
        );

        if (existingIndex >= 0) {
          players[existingIndex] = {
            ...players[existingIndex],
            ...resolvedPlayer,
            alias: players[existingIndex].alias,
          };
        } else {
          players.push(resolvedPlayer);
        }

        return { ...episode, players };
      }),
    })),
  };
  writeLibraryState(nextState);
  return nextState;
}

export function updateEpisodePlayerFailure(
  episodeId: string,
  player: LibraryEpisode["players"][number],
  error: string,
  resolutionHash?: string,
) {
  const state = readLibraryState();
  const failedPlayer: LibraryEpisode["players"][number] = {
    ...player,
    resolutionStatus: "failed",
    resolutionError: error,
    resolutionHash: resolutionHash ?? player.resolutionHash,
    resolvedAt: Date.now(),
  };

  const nextState = {
    ...state,
    shows: state.shows.map((show) => ({
      ...show,
      episodes: show.episodes.map((episode) => {
        if (episode.id !== episodeId) {
          return episode;
        }

        const players = [...episode.players];
        const existingIndex = players.findIndex((entry) =>
          entry.alias === failedPlayer.alias ||
          (entry.provider === failedPlayer.provider && entry.embedUrl === failedPlayer.embedUrl)
        );

        if (existingIndex >= 0) {
          players[existingIndex] = {
            ...players[existingIndex],
            ...failedPlayer,
            alias: players[existingIndex].alias,
          };
        } else {
          players.push(failedPlayer);
        }

        return { ...episode, players };
      }),
    })),
  };
  writeLibraryState(nextState);
  return nextState;
}

export function updateEpisodePlaybackProgress(
  episodeId: string,
  progress: {
    currentTime: number;
    duration?: number;
  },
) {
  const state = readLibraryState();
  const currentTime = Number.isFinite(progress.currentTime) ? Math.max(0, progress.currentTime) : 0;
  const duration = Number.isFinite(progress.duration) ? Math.max(0, progress.duration ?? 0) : undefined;
  const nextState = {
    ...state,
    shows: state.shows.map((show) => ({
      ...show,
      episodes: show.episodes.map((episode) =>
        episode.id === episodeId
          ? {
              ...episode,
              durationSeconds: duration && duration > 0 ? duration : episode.durationSeconds,
              playbackPositionSeconds: currentTime,
              playbackDurationSeconds: duration && duration > 0 ? duration : episode.playbackDurationSeconds,
              playbackUpdatedAt: Date.now(),
            }
          : episode,
      ),
    })),
  };
  writeLibraryState(nextState);
  return nextState;
}

export function markEpisodeOffline(episodeId: string, urls: string[], sizeBytes: number) {
  const state = readLibraryState();
  const nextState = {
    ...state,
    offlineDownloads: {
      ...state.offlineDownloads,
      [episodeId]: {
        cachedAt: Date.now(),
        urls,
        sizeBytes,
      },
    },
  };
  writeLibraryState(nextState);
  return nextState;
}

export function unmarkEpisodeOffline(episodeId: string) {
  const state = readLibraryState();
  const nextOffline = { ...state.offlineDownloads };
  delete nextOffline[episodeId];

  const nextState = {
    ...state,
    offlineDownloads: nextOffline,
  };
  writeLibraryState(nextState);
  return nextState;
}

export function clearOfflineDownloads() {
  const state = readLibraryState();
  const nextState = {
    ...state,
    offlineDownloads: {},
  };
  writeLibraryState(nextState);
  return nextState;
}

export function flattenEpisodes(shows: ImportedShow[]) {
  return shows.flatMap((show) => show.episodes);
}

export function findSelectedEpisode(state: LibraryState): LibraryEpisode | null {
  return flattenEpisodes(state.shows).find((episode) => episode.id === state.selectedEpisodeId) ?? null;
}
