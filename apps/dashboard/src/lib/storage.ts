import type {
  LibraryEpisode,
  LibraryState,
  PlayerAlias,
  ImportedShow,
  LibrarySettings,
  OfflineEpisodeDownload,
} from "./types";
import { archiveImportedShow } from "./import-archive";
import { getIntegrationById, type IntegrationId } from "./integrations";

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
    preferredSeriesSource: "svetserialu",
    preferredMovieSource: "bombuj",
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

function sanitizeImportedShow(show: ImportedShow): ImportedShow {
  return {
    ...show,
    altTitle: isImportHelperText(show.altTitle) ? null : show.altTitle ?? null,
  };
}

function normalizeLibraryStateCandidate(parsed: Partial<LibraryState> | null | undefined): LibraryState {
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
    return normalizeLibraryStateCandidate(parsed);
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

function mergeImportedShow(existingShow: ImportedShow, nextShow: ImportedShow): ImportedShow {
  const existingEpisodesById = new Map(existingShow.episodes.map((episode) => [episode.id, episode]));

  return {
    ...nextShow,
    isFavorite: nextShow.isFavorite ?? existingShow.isFavorite,
    posterUrl: nextShow.posterUrl ?? existingShow.posterUrl,
    backdropUrl: nextShow.backdropUrl ?? existingShow.backdropUrl,
    clearLogoUrl: nextShow.clearLogoUrl ?? existingShow.clearLogoUrl,
    episodes: nextShow.episodes.map((episode) => {
      const existingEpisode = existingEpisodesById.get(episode.id);
      if (!existingEpisode) {
        return episode;
      }

      const shouldKeepExistingTitle =
        isGenericEpisodeTitle(episode.episodeTitle, episode.episodeNumber) &&
        !isGenericEpisodeTitle(existingEpisode.episodeTitle, existingEpisode.episodeNumber);

      return {
        ...episode,
        episodeTitle: shouldKeepExistingTitle ? existingEpisode.episodeTitle : episode.episodeTitle,
        selectedPlayerAlias:
          episode.selectedPlayerAlias ||
          existingEpisode.selectedPlayerAlias,
      };
    }),
  };
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
  const existingIndex = shows.findIndex((entry) => entry.slug === sanitizedShow.slug);

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
