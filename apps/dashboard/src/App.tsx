import { startTransition, useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { clsx } from "clsx";
import { Sidebar } from "./components/Sidebar";
import type { SidebarFeedLink, ViewState } from "./components/Sidebar";
import { Header } from "./components/Header";
import { Hero } from "./components/Hero";
import { ShowCard } from "./components/ShowCard";
import { ShowDetail } from "./components/ShowDetail";
import { PlayerModal } from "./components/PlayerModal";
import { ImportView } from "./components/ImportView";
import { SettingsView } from "./components/SettingsView";
import { SupportView } from "./components/SupportView";
import { DownloadedView } from "./components/DownloadedView";
import { ExploreView } from "./components/ExploreView";
import { ProviderFeedPage } from "./components/ProviderFeedPage";
import { DownloadLanguageModal, type DownloadLanguageOption } from "./components/DownloadLanguageModal";
import { DownloadEngineModal } from "./components/DownloadEngineModal";
import { ConfirmDeleteModal } from "./components/ConfirmDeleteModal";
import { ConfirmRemoveShowModal } from "./components/ConfirmRemoveShowModal";
import { WelcomeModal } from "./components/WelcomeModal";
import { importSvetSerialuShow, importBombujMovie, refreshArtworkForShow, searchRemotes } from "./lib/import-client";
import { preloadHeroImage } from "./lib/hero-assets";
import {
  clearOfflineDownloads,
  dismissWelcome,
  findSelectedEpisode,
  hasDismissedWelcome,
  readLibraryState,
  selectEpisode,
  updateSelectedPlayer,
  upsertImportedShow,
  writeLibraryState,
  updateSettings,
  removeShow,
  toggleFavorite,
  readDownloadedLanguageMap,
  replaceDownloadedLanguageMap,
  setDownloadedLanguage,
  removeDownloadedLanguage,
  exportLibraryState,
  importLibraryState,
} from "./lib/storage";
import type { DownloadEngine, ImportedShow, LibraryEpisode, LibraryState, PlayerAlias } from "./lib/types";
import { clearOfflineCache } from "./lib/offline";
import {
  clearEpisodeFolderRecords,
  clearStoredFolderHandle,
  connectLibraryFolder,
  createInitialVaultStatus,
  getVaultDiagnostics,
  getVaultStatus,
  listLibraryVaultArtifacts,
  removeEpisodeFolderRecord,
  readVaultSnapshot,
  requestStoredFolderAccess,
  requireWritableLibraryFolder,
  writeResponseToLibraryVault,
  writeEpisodeFolderRecord,
  writeVaultSnapshot,
  type VaultDiagnostics,
  type VaultSnapshot,
  type VaultStatus,
} from "./lib/library-folder";
import { getLanguagePresentation } from "./lib/language";
import type { IntegrationId } from "./lib/integrations";
import {
  readDownloadQueue,
  replaceDownloadQueue,
  writeDownloadQueue,
  removeDownloadQueueItem,
  type PersistentDownloadJob,
  type PersistentDownloadQueue,
} from "./lib/download-manager";
import {
  cancelDownload,
  deleteDownload,
  getFullDownloadStatus,
  startBrowserResolvedDownload,
  startFullDownload,
  type FullDownloadJob,
} from "./lib/full-download-client";
import { downloadResolvedVideoInBrowser } from "./lib/browser-ffmpeg";
import { formatEpisodeTitle } from "./lib/episode-title";
import { scoreSearchCandidate } from "./lib/search-ranking";
import { buildRuntimeUrl } from "./lib/local-api";
import { probeLocalRuntime, type LocalRuntimeStatus } from "./lib/runtime-bridge";
import { cacheExploreFeed, deriveTasteProfileFromLibraryState, readDiscoveryUiState, readTasteProfile, recordAudioPreferenceSignal, recordEpisodePlaySignal, recordFavoriteSignal, recordImportedShowSignal, recordShowOpenSignal, updateDiscoveryUiState, type DiscoveryUiState } from "./lib/discovery-storage";
import { fetchExploreFeed } from "./lib/discovery-client";
import type {
  EnabledProviderFeed,
  ExploreFeedResponse,
  ExploreFilters,
  ExploreItem,
  ExplorePersonRole,
  ProviderFeedCatalogEntry,
  ProviderFeedResponse,
  ProviderModuleManifest,
  UserTasteProfile,
} from "./lib/types";
import {
  readCachedProviderModules,
  readEnabledProviderFeeds,
  sanitizeEnabledProviderFeeds,
  toggleEnabledProviderFeed,
  writeCachedProviderModules,
  writeEnabledProviderFeeds,
} from "./lib/provider-feed-storage";
import { fetchProviderFeed, fetchProviderModules, searchProviderModuleItems } from "./lib/provider-modules-client";
import {
  createProviderFeedViewId,
  isProviderFeedViewId,
  parseProviderFeedViewId,
} from "./lib/provider-modules-shared";

function sanitizeEpisodeIdForLookup(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]+/g, "_").slice(0, 80).toLowerCase();
}

function normalizeEpisodeIdForLookup(value: string): string {
  const lower = value.trim().toLowerCase();
  if (!lower) {
    return "";
  }

  const seasonEpisodeMatch = lower.match(/^(.*?)(?:[:-_])?s0*(\d+)e0*(\d+)$/i);
  if (seasonEpisodeMatch) {
    const showPart = seasonEpisodeMatch[1]
      .replace(/[_\s]+/g, "-")
      .replace(/-+/g, "-")
      .replace(/[^a-z0-9:-]+/g, "")
      .replace(/:-+/g, ":")
      .replace(/^-+|-+$/g, "");
    const season = Number.parseInt(seasonEpisodeMatch[2], 10);
    const episode = Number.parseInt(seasonEpisodeMatch[3], 10);

    if (Number.isFinite(season) && Number.isFinite(episode)) {
      return `${showPart}:s${season}e${episode}`;
    }
  }

  return lower.replace(/[^a-z0-9]+/g, "");
}

function getEpisodeIdLookupKeys(value: string): string[] {
  const trimmed = value.trim();
  if (!trimmed) {
    return [];
  }

  const sanitized = sanitizeEpisodeIdForLookup(trimmed);
  const normalized = normalizeEpisodeIdForLookup(trimmed);
  const keys = new Set<string>([
    trimmed,
    trimmed.toLowerCase(),
    sanitized,
    normalized,
  ]);

  const fromSanitized = sanitized.replace(/_(?=s\d+e\d+$)/i, ":");
  keys.add(fromSanitized);
  keys.add(normalizeEpisodeIdForLookup(fromSanitized));

  return Array.from(keys).filter(Boolean);
}

function isBrowserDownloadJobId(jobId: string) {
  return jobId.startsWith("browser:");
}

function normalizeLooseText(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function getSeasonEpisodeKey(season: number, episode: number | null): string {
  if (!Number.isFinite(season) || episode === null || !Number.isFinite(episode)) {
    return "";
  }
  return `s${season}e${episode}`;
}

function getPlatformPriority(
  platform: IntegrationId,
  preferredSeriesSource: IntegrationId,
  preferredMovieSource: IntegrationId,
  results: {
    mediaType?: "movie" | "serial";
  }[],
) {
  return results.reduce((score, result) => {
    if (result.mediaType === "movie" && platform === preferredMovieSource) {
      return score + 2;
    }
    if (result.mediaType === "serial" && platform === preferredSeriesSource) {
      return score + 2;
    }
    return score;
  }, 0);
}

type RemoteSearchResult = {
  title: string;
  slug: string;
  platform: "svetserialu" | "bombuj";
  posterUrl?: string | null;
  mediaType?: "movie" | "serial";
  year?: string | null;
};

function prioritizeImportSearchResults(results: RemoteSearchResult[]) {
  return results.slice(0, 4);
}

function isExactImportSearchMatch(query: string, result: RemoteSearchResult) {
  const normalizedQuery = normalizeLooseText(query);
  if (!normalizedQuery) {
    return false;
  }

  return (
    normalizeLooseText(result.title) === normalizedQuery ||
    normalizeLooseText(result.slug) === normalizedQuery
  );
}

function resolveImportInput(rawValue: string): {
  mode: "direct" | "search";
  platform?: IntegrationId;
  slug?: string;
  mediaType?: "movie" | "serial";
  query?: string;
} {
  const value = rawValue.trim();
  if (!value) {
    return { mode: "search", query: "" };
  }

  try {
    const parsed = new URL(value);
    const host = parsed.hostname.toLowerCase();
    const path = parsed.pathname.replace(/\/+$/, "");

    if (host.includes("svetserialu")) {
      const serialMatch = path.match(/\/serial\/([^/?#]+)/i);
      if (serialMatch?.[1]) {
        return {
          mode: "direct",
          platform: "svetserialu",
          slug: serialMatch[1].trim().toLowerCase(),
          mediaType: "serial",
        };
      }
    }

    if (host.includes("bombuj")) {
      const tail = path.split("/").filter(Boolean).pop() ?? "";
      const filmMatch = tail.match(/^online-film-(.+)$/i);
      if (filmMatch?.[1]) {
        return {
          mode: "direct",
          platform: "bombuj",
          slug: filmMatch[1].trim().toLowerCase(),
          mediaType: "movie",
        };
      }

      const serialMatch = tail.match(/^online-serial-(.+)$/i);
      if (serialMatch?.[1]) {
        return {
          mode: "direct",
          platform: "bombuj",
          slug: serialMatch[1].trim().toLowerCase(),
          mediaType: "serial",
        };
      }
    }
  } catch {
    // Non-URL input falls through to title search.
  }

  return {
    mode: "search",
    query: value,
  };
}

function parseShowAndSeasonEpisodeFromFileName(fileName: string): { showKey: string; seasonEpisodeKey: string } | null {
  const name = fileName.replace(/\.mp4$/i, "");
  const match = name.match(/^(.*?)\s*-\s*S0*(\d+)\s*E0*(\d+)\b/i);
  if (!match) {
    return null;
  }

  const showKey = normalizeLooseText(match[1] ?? "");
  const season = Number.parseInt(match[2] ?? "", 10);
  const episode = Number.parseInt(match[3] ?? "", 10);

  if (!showKey || !Number.isFinite(season) || !Number.isFinite(episode)) {
    return null;
  }

  return {
    showKey,
    seasonEpisodeKey: `s${season}e${episode}`,
  };
}

function toggleListValue(values: string[], value: string) {
  return values.includes(value) ? values.filter((entry) => entry !== value) : [...values, value];
}

type ProviderFeedPageState = {
  query: string;
  feed: ProviderFeedResponse | null;
  feedLoading: boolean;
  feedError: string | null;
  searchResults: ExploreItem[];
  searchLoading: boolean;
  searchError: string | null;
  lastSearchQuery: string | null;
};

function createEmptyProviderFeedPageState(): ProviderFeedPageState {
  return {
    query: "",
    feed: null,
    feedLoading: false,
    feedError: null,
    searchResults: [],
    searchLoading: false,
    searchError: null,
    lastSearchQuery: null,
  };
}

function mergeProviderFeedItems(left: ExploreItem[], right: ExploreItem[]) {
  const merged = new Map<string, ExploreItem>();
  for (const item of [...left, ...right]) {
    merged.set(item.id, item);
  }
  return Array.from(merged.values());
}

function App() {
  const HERO_ROTATION_MS = 7000;
  const cachedProviderModules = readCachedProviderModules();
  const [state, setState] = useState<LibraryState>(() => readLibraryState());
  const [importSlug, setImportSlug] = useState("");
  const [importing, setImporting] = useState(false);
  const [importMessage, setImportMessage] = useState<string | null>(null);
  const [activeShowSlug, setActiveShowSlug] = useState<string | null>(null);
  const [activeView, setActiveView] = useState<ViewState>("home");
  const [mediaFilter, setMediaFilter] = useState<"all" | "movies" | "series">("all");
  const [welcomeOpen, setWelcomeOpen] = useState<boolean>(() => !hasDismissedWelcome());
  const [downloadedEpisodeIds, setDownloadedEpisodeIds] = useState<Set<string>>(new Set());
  const [downloadedEpisodeFileById, setDownloadedEpisodeFileById] = useState<Map<string, string>>(new Map());
  const [downloadedEpisodeLanguageById, setDownloadedEpisodeLanguageById] = useState<Map<string, string>>(
    () => new Map(Object.entries(readDownloadedLanguageMap()))
  );
  const [downloadQueue, setDownloadQueue] = useState<PersistentDownloadQueue>(() => readDownloadQueue());
  const [downloadLanguageChoice, setDownloadLanguageChoice] = useState<{
    episode: LibraryEpisode;
    options: DownloadLanguageOption[];
  } | null>(null);
  const [downloadEngineChoice, setDownloadEngineChoice] = useState<{
    episode: LibraryEpisode;
    selectedAlias: PlayerAlias;
  } | null>(null);
  const [pendingDeleteEpisode, setPendingDeleteEpisode] = useState<LibraryEpisode | null>(null);
  const [pendingRemoveShow, setPendingRemoveShow] = useState<ImportedShow | null>(null);
  const activeDownloadPollsRef = useRef(new Set<string>());
  const activeBrowserDownloadControllersRef = useRef(new Map<string, AbortController>());
  const [downloadBackendAvailable, setDownloadBackendAvailable] = useState<boolean | null>(null);
  const [localRuntimeStatus, setLocalRuntimeStatus] = useState<LocalRuntimeStatus>({
    available: false,
    transport: null,
  });
  const [vaultStatus, setVaultStatus] = useState<VaultStatus>(() => createInitialVaultStatus());
  const [vaultDiagnostics, setVaultDiagnostics] = useState<VaultDiagnostics>(() => getVaultDiagnostics());
  
  // Remote Search State
  const [remoteResults, setRemoteResults] = useState<{
    title: string;
    slug: string;
    platform: "svetserialu" | "bombuj";
    posterUrl?: string | null;
    mediaType?: "movie" | "serial";
    year?: string | null;
  }[]>([]);
  const [isSearchingRemote, setIsSearchingRemote] = useState(false);
  const [importSearchResults, setImportSearchResults] = useState<RemoteSearchResult[]>([]);
  const [isSearchingImport, setIsSearchingImport] = useState(false);
  const [artworkRefreshBusy, setArtworkRefreshBusy] = useState(false);
  const [artworkRefreshSummary, setArtworkRefreshSummary] = useState<string | null>(null);
  const [heroIndex, setHeroIndex] = useState(0);
  const [vaultSnapshotReady, setVaultSnapshotReady] = useState(false);
  const [discoveryState, setDiscoveryState] = useState<DiscoveryUiState>(() => readDiscoveryUiState());
  const [tasteProfile, setTasteProfile] = useState<UserTasteProfile>(() => readTasteProfile());
  const [exploreFeed, setExploreFeed] = useState<ExploreFeedResponse | null>(readDiscoveryUiState().cachedExplore?.payload ?? null);
  const [exploreCursor, setExploreCursor] = useState<string | null>(readDiscoveryUiState().cachedExplore?.payload.continueCursor ?? null);
  const [exploreLoading, setExploreLoading] = useState(false);
  const [exploreError, setExploreError] = useState<string | null>(null);
  const [providerModules, setProviderModules] = useState<ProviderModuleManifest[]>(() => cachedProviderModules.modules);
  const [enabledProviderFeeds, setEnabledProviderFeeds] = useState<EnabledProviderFeed[]>(() =>
    sanitizeEnabledProviderFeeds(readEnabledProviderFeeds(), cachedProviderModules.modules),
  );
  const [providerFeedStates, setProviderFeedStates] = useState<Record<string, ProviderFeedPageState>>({});
  const stateRef = useRef(state);
  const downloadedLanguageMapRef = useRef(downloadedEpisodeLanguageById);
  const downloadQueueRef = useRef(downloadQueue);
  const lastKnownVaultSnapshotAtRef = useRef(0);
  const skipNextVaultWriteRef = useRef(false);
  const deferredExploreQuery = useDeferredValue(discoveryState.exploreQuery);

  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  useEffect(() => {
    setTasteProfile(deriveTasteProfileFromLibraryState(state));
  }, [state]);

  useEffect(() => {
    downloadedLanguageMapRef.current = downloadedEpisodeLanguageById;
  }, [downloadedEpisodeLanguageById]);

  useEffect(() => {
    downloadQueueRef.current = downloadQueue;
  }, [downloadQueue]);

  useEffect(() => {
    let canceled = false;

    const loadProviderModuleCatalog = async () => {
      try {
        const modules = await fetchProviderModules();
        if (canceled) {
          return;
        }

        setProviderModules(modules);
        writeCachedProviderModules(modules);
        setEnabledProviderFeeds((current) => {
          const next = sanitizeEnabledProviderFeeds(current, modules);
          writeEnabledProviderFeeds(next);
          return next;
        });
      } catch {
        // Keep cached manifests if the control plane is unavailable.
      }
    };

    void loadProviderModuleCatalog();

    return () => {
      canceled = true;
    };
  }, []);

  async function refreshVaultState() {
    const status = await getVaultStatus();
    setVaultStatus(status);
    setVaultDiagnostics(getVaultDiagnostics());
    return status;
  }

  function applyVaultSnapshot(snapshot: VaultSnapshot, preserveUiState: boolean) {
    const currentState = stateRef.current;
    const importedState = importLibraryState(snapshot.libraryState);
    const nextState = {
      ...importedState,
      query: preserveUiState ? currentState.query : importedState.query,
      selectedEpisodeId: preserveUiState ? currentState.selectedEpisodeId : importedState.selectedEpisodeId,
      settings: {
        ...importedState.settings,
        connectedFolderName: vaultStatus.folderName ?? currentState.settings.connectedFolderName,
      },
    };

    writeLibraryState(nextState);
    setState(nextState);

    const restoredLanguages = replaceDownloadedLanguageMap(snapshot.downloadedLanguages ?? readDownloadedLanguageMap());
    setDownloadedEpisodeLanguageById(new Map(Object.entries(restoredLanguages)));

    const restoredQueue = replaceDownloadQueue(snapshot.downloadQueue ?? readDownloadQueue());
    setDownloadQueue(restoredQueue);
    lastKnownVaultSnapshotAtRef.current = Math.max(lastKnownVaultSnapshotAtRef.current, snapshot.updatedAt);
  }

  async function syncDownloadedArtifacts(shows: ImportedShow[]) {
    if (vaultStatus.code === "stored_handle_needs_access" && vaultStatus.handleStored) {
      return;
    }

    const episodes = shows.flatMap((show) => show.episodes);
    const knownEpisodeIds = new Set(episodes.map((episode) => episode.id));
    const knownByLookupKey = new Map<string, string>();
    const knownByShowAndSeasonEpisode = new Map<string, string>();
    const knownBySeasonEpisode = new Map<string, string[]>();

    for (const episode of episodes) {
      for (const key of getEpisodeIdLookupKeys(episode.id)) {
        if (!knownByLookupKey.has(key)) {
          knownByLookupKey.set(key, episode.id);
        }
      }

      const seasonEpisodeKey = getSeasonEpisodeKey(episode.seasonNumber, episode.episodeNumber);
      if (!seasonEpisodeKey) {
        continue;
      }

      const titleKey = normalizeLooseText(episode.showTitle);
      if (titleKey) {
        const key = `${titleKey}|${seasonEpisodeKey}`;
        if (!knownByShowAndSeasonEpisode.has(key)) {
          knownByShowAndSeasonEpisode.set(key, episode.id);
        }
      }

      const slugKey = normalizeLooseText(episode.showSlug);
      if (slugKey) {
        const key = `${slugKey}|${seasonEpisodeKey}`;
        if (!knownByShowAndSeasonEpisode.has(key)) {
          knownByShowAndSeasonEpisode.set(key, episode.id);
        }
      }

      if (!knownBySeasonEpisode.has(seasonEpisodeKey)) {
        knownBySeasonEpisode.set(seasonEpisodeKey, []);
      }
      knownBySeasonEpisode.get(seasonEpisodeKey)!.push(episode.id);
    }

    const vaultArtifacts = await listLibraryVaultArtifacts();
    const downloadedArtifacts = {
      episodeIds: vaultArtifacts.episodeIds,
      files: vaultArtifacts.files,
    };
    const vaultFilesByEpisodeId = vaultArtifacts.filesByEpisodeId ?? {};

    const next = new Set<string>();
    const nextFiles = new Map<string, string>();

    for (const downloadedId of downloadedArtifacts.episodeIds) {
      if (knownEpisodeIds.has(downloadedId)) {
        next.add(downloadedId);
        const linkedFile = vaultFilesByEpisodeId[downloadedId];
        if (linkedFile) {
          nextFiles.set(downloadedId, linkedFile);
        }
        continue;
      }

      for (const key of getEpisodeIdLookupKeys(downloadedId)) {
        const mapped = knownByLookupKey.get(key);
        if (mapped) {
          next.add(mapped);
          const linkedFile = vaultFilesByEpisodeId[downloadedId];
          if (linkedFile) {
            nextFiles.set(mapped, linkedFile);
          }
          break;
        }
      }
    }

    for (const fileName of downloadedArtifacts.files) {
      const parsed = parseShowAndSeasonEpisodeFromFileName(fileName);
      const tagMatch = fileName.match(/\[([^\]]+)\]\.mp4$/i);
      const fileTag = tagMatch?.[1]?.trim();

      if (!fileTag && !parsed) {
        continue;
      }

      if (fileTag) {
        for (const key of getEpisodeIdLookupKeys(fileTag)) {
          const mapped = knownByLookupKey.get(key);
          if (mapped) {
            next.add(mapped);
            nextFiles.set(mapped, fileName);
            break;
          }
        }
      }

      if (!parsed) {
        continue;
      }

      const key = `${parsed.showKey}|${parsed.seasonEpisodeKey}`;
      const mapped = knownByShowAndSeasonEpisode.get(key);
      if (mapped) {
        next.add(mapped);
        nextFiles.set(mapped, fileName);
        continue;
      }

      const episodeCandidates = knownBySeasonEpisode.get(parsed.seasonEpisodeKey);
      if (episodeCandidates && episodeCandidates.length === 1) {
        next.add(episodeCandidates[0]);
        nextFiles.set(episodeCandidates[0], fileName);
      }
    }

    const idsChanged = next.size !== downloadedEpisodeIds.size || [...next].some((episodeId) => !downloadedEpisodeIds.has(episodeId));
    const filesChanged =
      nextFiles.size !== downloadedEpisodeFileById.size ||
      [...nextFiles.entries()].some(([episodeId, fileName]) => downloadedEpisodeFileById.get(episodeId) !== fileName);

    if (idsChanged) {
      setDownloadedEpisodeIds(next);
    }

    if (filesChanged) {
      setDownloadedEpisodeFileById(nextFiles);
    }
  }

  function getOutputFileName(outputPath: string | undefined, episodeId: string) {
    const rawName = outputPath?.split(/[\\/]/).pop()?.trim();
    if (rawName) {
      return rawName;
    }
    return `${sanitizeEpisodeIdForLookup(episodeId)}.mp4`;
  }

  function buildRuntimeDownloadFileUrl(episodeId: string, fileName?: string) {
    const query = new URLSearchParams({ episodeId });
    if (fileName) {
      query.set("file", fileName);
    }

    return buildRuntimeUrl(`/api/download-full/file?${query.toString()}`);
  }

  async function mirrorCompletedDownloadToVault(episodeId: string, outputPath?: string) {
    if (!vaultStatus.connected) {
      return null;
    }

    const episode = stateRef.current.shows.flatMap((show) => show.episodes).find((entry) => entry.id === episodeId);
    if (!episode) {
      return null;
    }

    const fileName = getOutputFileName(outputPath, episodeId);
    const response = await fetch(buildRuntimeDownloadFileUrl(episodeId, fileName));
    const saved = await writeResponseToLibraryVault(fileName, response);
    await writeEpisodeFolderRecord(episode, [saved.fileName], 0, saved.fileName);
    return saved.fileName;
  }

  useEffect(() => {
    setState(readLibraryState());
  }, []);

  useEffect(() => {
    void refreshVaultState();
  }, []);

  useEffect(() => {
    let canceled = false;

    const hydrateVaultSnapshot = async () => {
      setVaultSnapshotReady(false);

      if (!vaultStatus.connected || !vaultStatus.folderName) {
        setVaultSnapshotReady(true);
        return;
      }

      const snapshot = await readVaultSnapshot();
      setVaultDiagnostics(getVaultDiagnostics());
      if (canceled) {
        return;
      }

      if (snapshot?.libraryState) {
        applyVaultSnapshot(snapshot, false);
      }

      setVaultSnapshotReady(true);
    };

    void hydrateVaultSnapshot();

    return () => {
      canceled = true;
    };
  }, [vaultStatus.connected, vaultStatus.folderName]);

  useEffect(() => {
    if (!vaultStatus.connected || !vaultStatus.folderName || !vaultSnapshotReady) {
      return;
    }

    if (skipNextVaultWriteRef.current) {
      skipNextVaultWriteRef.current = false;
      return;
    }

    const timeout = window.setTimeout(() => {
      void (async () => {
        const snapshotUpdatedAt = Date.now();
        lastKnownVaultSnapshotAtRef.current = Math.max(lastKnownVaultSnapshotAtRef.current, snapshotUpdatedAt);
        await writeVaultSnapshot({
          version: 1,
          updatedAt: snapshotUpdatedAt,
          libraryState: state,
          downloadedLanguages: Object.fromEntries(downloadedLanguageMapRef.current),
          downloadQueue: downloadQueueRef.current,
        });
        setVaultDiagnostics(getVaultDiagnostics());
      })();
    }, 200);

    return () => window.clearTimeout(timeout);
  }, [downloadQueue, downloadedEpisodeLanguageById, state, vaultSnapshotReady, vaultStatus.connected, vaultStatus.folderName]);

  useEffect(() => {
    setArtworkRefreshSummary(null);
  }, [state.settings.artworkSources.fanart, state.settings.artworkSources.tmdb, state.settings.artworkSources.tvdb]);

  useEffect(() => {
    if (state.shows.length <= 1) {
      setHeroIndex(0);
      return;
    }

    setHeroIndex((current) => current % state.shows.length);
    const interval = window.setInterval(() => {
      setHeroIndex((current) => (current + 1) % state.shows.length);
    }, HERO_ROTATION_MS);

    return () => window.clearInterval(interval);
  }, [state.shows.length]);

  useEffect(() => {
    const urls = state.shows.flatMap((show) => [show.backdropUrl, show.clearLogoUrl]).filter((value): value is string => Boolean(value));
    for (const url of urls) {
      void preloadHeroImage(url).catch(() => undefined);
    }
  }, [state.shows, vaultStatus.connected, vaultStatus.folderName]);

  useEffect(() => {
    let canceled = false;

    const probeDownloadBackend = async () => {
      try {
        const response = await fetch("/api/status", { method: "GET" });
        if (!canceled) {
          // Browser resolver or ffmpeg backend available
          setDownloadBackendAvailable(response.ok);
        }
      } catch {
        if (!canceled) {
          // Assume browser resolver is still available even if probe fails
          setDownloadBackendAvailable(true);
        }
      }
    };

    void probeDownloadBackend();

    return () => {
      canceled = true;
    };
  }, []);

  useEffect(() => {
    let canceled = false;

    const probe = async () => {
      const status = await probeLocalRuntime();
      if (!canceled) {
        setLocalRuntimeStatus(status);
      }
    };

    void probe();

    return () => {
      canceled = true;
    };
  }, []);

  useEffect(() => {
    const q = state.query.trim();
    if (q.length < 3) {
      setRemoteResults([]);
      setIsSearchingRemote(false);
      return;
    }
    
    setIsSearchingRemote(true);
    const timeout = setTimeout(() => {
       searchRemotes(q).then(res => {
          setRemoteResults(res);
       }).catch(() => {
          setRemoteResults([]);
       }).finally(() => {
          setIsSearchingRemote(false);
       });
    }, 600);

    return () => clearTimeout(timeout);
  }, [state.query]);

  useEffect(() => {
    const syncFromPath = () => {
      const raw = window.location.pathname.replace(/^\/+/, "");
      const slug = raw ? raw.split("/")[0] : null;
      setActiveShowSlug(slug ? slug.toLowerCase() : null);
    };

    syncFromPath();
    window.addEventListener("popstate", syncFromPath);
    return () => window.removeEventListener("popstate", syncFromPath);
  }, []);

  useEffect(() => {
    if (activeView !== "explore" || activeShowSlug) {
      return;
    }

    void loadExplore(null);
  }, [activeShowSlug, activeView, deferredExploreQuery, discoveryState.exploreFilters, tasteProfile]);

  const filteredShows = useMemo(() => {
    const query = state.query.trim();
    let shows = state.shows;

    if (activeView === "favorites") {
      shows = shows.filter((show) => show.isFavorite);
    }

    if (activeView === "home" || activeView === "favorites") {
      if (mediaFilter === "movies") {
         shows = shows.filter(s => s.availableSeasons.length <= 1 && s.episodes.length <= 1);
      } else if (mediaFilter === "series") {
         shows = shows.filter(s => s.availableSeasons.length > 1 || s.episodes.length > 1);
      }
    }

    if (!query) return shows;

    return shows
      .map((show, showIndex) => {
        const episodeMatches = show.episodes
          .map((episode, episodeIndex) => {
            const episodeScore = scoreSearchCandidate(query, [
              show.title,
              show.altTitle,
              show.slug,
              episode.episodeTitle,
              episode.episodeCode,
              ...episode.players.map((player) => player.label),
            ], episodeIndex);

            return {
              episode,
              score: episodeScore,
            };
          })
          .filter((entry) => entry.score > 0)
          .sort((left, right) => right.score - left.score);

        const showScore = scoreSearchCandidate(query, [
          show.title,
          show.altTitle,
          show.slug,
          show.description,
          ...show.episodes.map((episode) => episode.episodeTitle ?? ""),
        ], showIndex);

        return {
          show: {
            ...show,
            episodes: episodeMatches.length > 0 ? episodeMatches.map((entry) => entry.episode) : show.episodes,
          },
          score: Math.max(showScore, episodeMatches[0]?.score ?? 0),
          hasEpisodeMatches: episodeMatches.length > 0,
        };
      })
      .filter((entry) => entry.score > 0 && (entry.hasEpisodeMatches || entry.score > 0))
      .sort((left, right) => right.score - left.score)
      .map((entry) => {
        if (entry.hasEpisodeMatches) {
          return entry.show;
        }

        return {
          ...entry.show,
          episodes: entry.show.episodes,
        };
      });
  }, [state.query, state.shows, activeView, mediaFilter]);

  const selectedEpisode = useMemo(() => findSelectedEpisode(state), [state]);
  const totalOfflineBytes = useMemo(
    () => Object.values(state.offlineDownloads).reduce((sum, entry) => sum + (entry.sizeBytes ?? 0), 0),
    [state.offlineDownloads],
  );
  const featuredShow = state.shows.length > 0 ? state.shows[heroIndex % state.shows.length] : null;
  const latestEpisodeOfFeatured = featuredShow?.episodes[featuredShow.episodes.length - 1];
  const downloadedCountByShow = useMemo(() => {
    const counter: Record<string, number> = {};
    const offlineIds = new Set(Object.keys(state.offlineDownloads));

    for (const show of state.shows) {
      const uniqueEpisodeIds = new Set<string>();
      for (const episode of show.episodes) {
        if (offlineIds.has(episode.id) || downloadedEpisodeIds.has(episode.id)) {
          uniqueEpisodeIds.add(episode.id);
        }
      }

      if (uniqueEpisodeIds.size > 0) {
        counter[show.slug] = uniqueEpisodeIds.size;
      }
    }

    return counter;
  }, [downloadedEpisodeIds, state.offlineDownloads, state.shows]);
  const downloadedShows = useMemo(
    () => state.shows.filter((show) => (downloadedCountByShow[show.slug] ?? 0) > 0),
    [downloadedCountByShow, state.shows],
  );
  const remoteByPlatform = useMemo(() => {
    return remoteResults.reduce(
      (acc, item) => {
        acc[item.platform].push(item);
        return acc;
      },
      {
        svetserialu: [] as typeof remoteResults,
        bombuj: [] as typeof remoteResults,
      },
    );
  }, [remoteResults]);
  const remotePlatformOrder = useMemo(() => {
    const baseOrder: IntegrationId[] = ["svetserialu", "bombuj"];
    return [...baseOrder].sort((left, right) => {
      const rightScore = getPlatformPriority(
        right,
        state.settings.preferredSeriesSource,
        state.settings.preferredMovieSource,
        remoteByPlatform[right],
      );
      const leftScore = getPlatformPriority(
        left,
        state.settings.preferredSeriesSource,
        state.settings.preferredMovieSource,
        remoteByPlatform[left],
      );

      if (leftScore === rightScore) {
        return baseOrder.indexOf(left) - baseOrder.indexOf(right);
      }
      return rightScore - leftScore;
    });
  }, [remoteByPlatform, state.settings.preferredMovieSource, state.settings.preferredSeriesSource]);

  const providerFeedCatalog = useMemo<ProviderFeedCatalogEntry[]>(
    () =>
      providerModules.flatMap((module) =>
        module.capabilities.feeds.map((feed) => ({
          moduleId: module.moduleId,
          feedId: feed.feedId,
          providerId: module.providerId,
          providerName: module.displayName,
          title: feed.title,
          description: feed.description,
          pageTitle: feed.pageTitle,
          enabled: enabledProviderFeeds.some(
            (enabledFeed) => enabledFeed.moduleId === module.moduleId && enabledFeed.feedId === feed.feedId,
          ),
        })),
      ),
    [enabledProviderFeeds, providerModules],
  );

  const providerFeedLinks = useMemo<SidebarFeedLink[]>(
    () =>
      enabledProviderFeeds.flatMap((enabledFeed) => {
        const module = providerModules.find((entry) => entry.moduleId === enabledFeed.moduleId);
        const feed = module?.capabilities.feeds.find((entry) => entry.feedId === enabledFeed.feedId);
        if (!module || !feed) {
          return [];
        }

        return [
          {
            id: createProviderFeedViewId(module.moduleId, feed.feedId),
            label: feed.pageTitle,
          },
        ];
      }),
    [enabledProviderFeeds, providerModules],
  );

  const activeProviderFeedMeta = useMemo(() => {
    if (!isProviderFeedViewId(activeView)) {
      return null;
    }

    const parsed = parseProviderFeedViewId(activeView);
    if (!parsed) {
      return null;
    }

    const module = providerModules.find((entry) => entry.moduleId === parsed.moduleId);
    const feed = module?.capabilities.feeds.find((entry) => entry.feedId === parsed.feedId);
    if (!module || !feed) {
      return null;
    }

    return {
      viewId: activeView,
      module,
      feed,
    };
  }, [activeView, providerModules]);

  const activeProviderFeedPageState = activeProviderFeedMeta
    ? (providerFeedStates[activeProviderFeedMeta.viewId] ?? createEmptyProviderFeedPageState())
    : null;
  const deferredProviderFeedQuery = useDeferredValue(activeProviderFeedPageState?.query ?? "");

  function updateProviderFeedPageState(viewId: string, patch: Partial<ProviderFeedPageState>) {
    setProviderFeedStates((current) => ({
      ...current,
      [viewId]: {
        ...(current[viewId] ?? createEmptyProviderFeedPageState()),
        ...patch,
      },
    }));
  }

  function findImportedShowForItem(item: Pick<ExploreItem, "provider" | "importSlug">) {
    return state.shows.find((show) => {
      if (item.provider === "bombuj") {
        return show.slug === `bombuj-${item.importSlug}`;
      }
      return show.slug === item.importSlug;
    }) ?? null;
  }

  const activeProviderFeedItems = useMemo(() => {
    if (!activeProviderFeedPageState) {
      return [];
    }

    const sourceItems = activeProviderFeedPageState.query.trim()
      ? activeProviderFeedPageState.searchResults
      : activeProviderFeedPageState.feed?.items ?? [];

    return sourceItems.map((item) => ({
      ...item,
      inVault: Boolean(findImportedShowForItem(item)),
    }));
  }, [activeProviderFeedPageState, state.shows]);

  useEffect(() => {
    if (!activeProviderFeedMeta) {
      return;
    }

    const viewId = activeProviderFeedMeta.viewId;
    const query = deferredProviderFeedQuery.trim();
    const current = providerFeedStates[viewId] ?? createEmptyProviderFeedPageState();

    if (query) {
      if (current.searchLoading && current.query.trim() === query) {
        return;
      }

      if (current.lastSearchQuery === query) {
        return;
      }

      updateProviderFeedPageState(viewId, {
        searchLoading: true,
        searchError: null,
      });

      void searchProviderModuleItems({
        moduleId: activeProviderFeedMeta.module.moduleId,
        query,
      })
        .then((results) => {
          updateProviderFeedPageState(viewId, {
            searchResults: results,
            searchLoading: false,
            searchError: null,
            lastSearchQuery: query,
          });
        })
        .catch((error) => {
          updateProviderFeedPageState(viewId, {
            searchResults: [],
            searchLoading: false,
            searchError: error instanceof Error ? error.message : "Failed to search this provider.",
            lastSearchQuery: query,
          });
        });
      return;
    }

    if (current.searchResults.length > 0 || current.searchError || current.searchLoading) {
      updateProviderFeedPageState(viewId, {
        searchResults: [],
        searchLoading: false,
        searchError: null,
        lastSearchQuery: null,
      });
    }

    if (current.feed || current.feedLoading) {
      return;
    }

    updateProviderFeedPageState(viewId, {
      feedLoading: true,
      feedError: null,
    });

    void fetchProviderFeed({
      moduleId: activeProviderFeedMeta.module.moduleId,
      feedId: activeProviderFeedMeta.feed.feedId,
      limit: 24,
    })
      .then((feed) => {
        updateProviderFeedPageState(viewId, {
          feed,
          feedLoading: false,
          feedError: null,
          searchResults: [],
          searchLoading: false,
          searchError: null,
        });
      })
      .catch((error) => {
        updateProviderFeedPageState(viewId, {
          feedLoading: false,
          feedError: error instanceof Error ? error.message : "Failed to load provider feed.",
        });
      });
  }, [activeProviderFeedMeta, deferredProviderFeedQuery, providerFeedStates]);

  useEffect(() => {
    if (isProviderFeedViewId(activeView) && !activeProviderFeedMeta) {
      setActiveView("home");
    }
  }, [activeProviderFeedMeta, activeView]);

  function setDiscoveryStateAndPersist(change: Partial<DiscoveryUiState>) {
    startTransition(() => {
      setDiscoveryState((current) => {
        const next = {
          ...current,
          ...change,
          exploreFilters: {
            ...current.exploreFilters,
            ...(change.exploreFilters ?? {}),
          },
        };
        updateDiscoveryUiState(next);
        return next;
      });
    });
  }

  function toggleExploreFilter<K extends "providers" | "genres" | "audioBuckets" | "sections" | "networks" | "mediaTypes">(key: K, value: ExploreFilters[K][number]) {
    setDiscoveryState((current) => {
      const next = {
        ...current,
        exploreFilters: {
          ...current.exploreFilters,
          [key]: toggleListValue(current.exploreFilters[key] as string[], String(value)),
        },
      } satisfies DiscoveryUiState;
      updateDiscoveryUiState(next);
      return next;
    });
  }

  async function loadExplore(cursor?: string | null) {
    setExploreLoading(true);
    setExploreError(null);

    try {
      const feed = await fetchExploreFeed({
        query: deferredExploreQuery,
        filters: discoveryState.exploreFilters,
        cursor: cursor ?? null,
        limit: 48,
        librarySnapshot: stateRef.current,
        tasteProfile,
      });

      if (cursor) {
        setExploreFeed((current) => current ? {
          ...feed,
          items: [...current.items, ...feed.items],
        } : feed);
      } else {
        setExploreFeed(feed);
      }
      setExploreCursor(feed.continueCursor);
      cacheExploreFeed(JSON.stringify({ query: deferredExploreQuery, filters: discoveryState.exploreFilters }), feed);
    } catch (error) {
      setExploreError(error instanceof Error ? error.message : "Failed to load Explore.");
    } finally {
      setExploreLoading(false);
    }
  }

    const fullDownloadJobsByEpisode = useMemo(() => {
      const next: Record<string, FullDownloadJob> = {};
      for (const item of Object.values(downloadQueue)) {
        next[item.episodeId] = {
          id: item.jobId,
          episodeId: item.episodeId,
          state: item.state,
          percent: item.percent,
          message: item.message,
          outputPath: item.outputPath,
          error: item.error,
        };
      }
      return next;
    }, [downloadQueue]);

    const downloadJobs = useMemo(() => Object.values(downloadQueue).sort((left, right) => right.updatedAt - left.updatedAt), [downloadQueue]);

    useEffect(() => {
      writeDownloadQueue(downloadQueue);
    }, [downloadQueue]);

    useEffect(() => {
      setDownloadQueue((prev) => {
        const next: PersistentDownloadQueue = {};
        let changed = false;

        for (const [episodeId, item] of Object.entries(prev)) {
          if (isBrowserDownloadJobId(item.jobId)) {
            changed = true;
            continue;
          }
          if (item.state === "queued" || item.state === "resolving" || item.state === "downloading" || item.state === "failed") {
            next[episodeId] = item;
          } else {
            changed = true;
          }
        }

        return changed ? next : prev;
      });
    }, []);

  useEffect(() => {
    let canceled = false;

    const syncDownloaded = async () => {
      try {
        if (canceled) {
          return;
        }
        await syncDownloadedArtifacts(state.shows);
        return;

        /*
        const episodes = state.shows.flatMap((show) => show.episodes);
        const knownEpisodeIds = new Set(episodes.map((episode) => episode.id));
        const knownByLookupKey = new Map<string, string>();
        const knownByShowAndSeasonEpisode = new Map<string, string>();
        const knownBySeasonEpisode = new Map<string, string[]>();
        for (const episode of episodes) {
          for (const key of getEpisodeIdLookupKeys(episode.id)) {
            if (!knownByLookupKey.has(key)) {
              knownByLookupKey.set(key, episode.id);
            }
          }

          const seasonEpisodeKey = getSeasonEpisodeKey(episode.seasonNumber, episode.episodeNumber);
          if (seasonEpisodeKey) {
            const titleKey = normalizeLooseText(episode.showTitle);
            if (titleKey) {
              const key = `${titleKey}|${seasonEpisodeKey}`;
              if (!knownByShowAndSeasonEpisode.has(key)) {
                knownByShowAndSeasonEpisode.set(key, episode.id);
              }
            }

            const slugKey = normalizeLooseText(episode.showSlug);
            if (slugKey) {
              const key = `${slugKey}|${seasonEpisodeKey}`;
              if (!knownByShowAndSeasonEpisode.has(key)) {
                knownByShowAndSeasonEpisode.set(key, episode.id);
              }
            }

            if (!knownBySeasonEpisode.has(seasonEpisodeKey)) {
              knownBySeasonEpisode.set(seasonEpisodeKey, []);
            }
            knownBySeasonEpisode.get(seasonEpisodeKey)!.push(episode.id);
          }
        }
        const [runtimeArtifacts, vaultArtifacts] = await Promise.all([
          listDownloadedArtifacts(),
          listLibraryVaultArtifacts(),
        ]);
        const downloadedArtifacts = vaultStatus.connected && vaultStatus.folderName
          ? {
              episodeIds: vaultArtifacts.episodeIds,
              files: vaultArtifacts.files,
            }
          : {
              episodeIds: Array.from(new Set([...runtimeArtifacts.episodeIds, ...vaultArtifacts.episodeIds])),
              files: Array.from(new Set([...runtimeArtifacts.files, ...vaultArtifacts.files])),
            };

        if (canceled) {
          return;
        }

        console.log("[SYNC] Downloaded artifacts:", downloadedArtifacts);
        console.log("[SYNC] Known by lookup key count:", knownByLookupKey.size);

        const next = new Set<string>();
        const nextFiles = new Map<string, string>();
        for (const downloadedId of downloadedArtifacts.episodeIds) {
          if (knownEpisodeIds.has(downloadedId)) {
            console.log("[SYNC] Matched direct ID:", downloadedId);
            next.add(downloadedId);
            continue;
          }

          for (const key of getEpisodeIdLookupKeys(downloadedId)) {
            const mapped = knownByLookupKey.get(key);
            if (mapped) {
              console.log("[SYNC] Mapped ID via key", key, ":", downloadedId, "→", mapped);
              next.add(mapped);
              break;
            }
          }
        }

        for (const fileName of downloadedArtifacts.files) {
          const parsed = parseShowAndSeasonEpisodeFromFileName(fileName);
          const tagMatch = fileName.match(/\[([^\]]+)\]\.mp4$/i);
          const fileTag = tagMatch?.[1]?.trim();

          console.log("[SYNC] Processing file:", fileName, { fileTag, parsed });

          if (!fileTag && !parsed) {
            console.log("[SYNC] Skipping file - no tag and no parsed show/season/episode");
            continue;
          }

          if (fileTag) {
            for (const key of getEpisodeIdLookupKeys(fileTag)) {
              const mapped = knownByLookupKey.get(key);
              if (mapped) {
                console.log("[SYNC] Mapped file tag", fileTag, "via key", key, "→", mapped);
                next.add(mapped);
                nextFiles.set(mapped, fileName);
                break;
              }
            }
          }

          if (!parsed) {
            continue;
          }

          const key = `${parsed.showKey}|${parsed.seasonEpisodeKey}`;
          const mapped = knownByShowAndSeasonEpisode.get(key);
          if (mapped) {
            console.log("[SYNC] Mapped file via show+season+episode", key, "→", mapped);
            next.add(mapped);
            nextFiles.set(mapped, fileName);
            continue;
          }

          const seasonEpisodeKey = parsed.seasonEpisodeKey;
          const episodeCandidates = knownBySeasonEpisode.get(seasonEpisodeKey);
          if (episodeCandidates && episodeCandidates.length === 1) {
            console.log("[SYNC] Mapped file via season+episode alone", seasonEpisodeKey, "→", episodeCandidates[0]);
            next.add(episodeCandidates[0]);
            nextFiles.set(episodeCandidates[0], fileName);
          }
        }

        console.log("[SYNC] Final matched episodes:", Array.from(next));
        setDownloadedEpisodeIds(next);
        setDownloadedEpisodeFileById(nextFiles);
        */
      } catch (error) {
        console.error("[SYNC] Error during sync:", error);
      }
    };

    void syncDownloaded();
    return () => {
      canceled = true;
    };
  }, [state.shows, vaultStatus.connected, vaultStatus.folderName]);

  useEffect(() => {
    if (!vaultStatus.connected || !vaultStatus.folderName || !vaultSnapshotReady) {
      return;
    }

    let canceled = false;

    const syncVaultInBackground = async () => {
      try {
        const snapshot = await readVaultSnapshot();
        setVaultDiagnostics(getVaultDiagnostics());

        if (canceled) {
          return;
        }

        if (snapshot?.libraryState && snapshot.updatedAt > lastKnownVaultSnapshotAtRef.current) {
          skipNextVaultWriteRef.current = true;
          applyVaultSnapshot(snapshot, true);
        }

        await syncDownloadedArtifacts(stateRef.current.shows);
      } catch (error) {
        console.error("[vault] background sync failed", error);
      }
    };

    void syncVaultInBackground();
    const interval = window.setInterval(() => {
      void syncVaultInBackground();
    }, 5000);

    return () => {
      canceled = true;
      window.clearInterval(interval);
    };
  }, [vaultSnapshotReady, vaultStatus.connected, vaultStatus.folderName]);

  async function persistDownloadJobUpdate(episodeId: string, patch: Partial<PersistentDownloadJob> | null) {
    setDownloadQueue((prev) => {
      const current = prev[episodeId];
      if (!current) {
        return prev;
      }

      if (patch === null) {
        activeDownloadPollsRef.current.delete(episodeId);
        return removeDownloadQueueItem(prev, episodeId);
      }

      return {
        ...prev,
        [episodeId]: {
          ...current,
          ...patch,
          updatedAt: Date.now(),
        },
      };
    });
  }

  async function startBrowserManagedDownload(episode: LibraryEpisode) {
    await requireWritableLibraryFolder();

    const existing = downloadQueue[episode.id];
    if (existing && (existing.state === "queued" || existing.state === "resolving" || existing.state === "downloading")) {
      return;
    }

    const selectedPlayer = episode.players.find((player) => player.alias === episode.selectedPlayerAlias) ?? episode.players[0];
    const jobId = `browser:${episode.id}:${Date.now()}`;
    const controller = new AbortController();
    activeBrowserDownloadControllersRef.current.set(episode.id, controller);

    setDownloadQueue((prev) => ({
      ...prev,
      [episode.id]: {
        episodeId: episode.id,
        jobId,
        showTitle: episode.showTitle,
        episodeTitle: formatEpisodeTitle(episode),
        seasonNumber: episode.seasonNumber,
        episodeNumber: episode.episodeNumber,
        episodeCode: episode.episodeCode,
        selectedPlayerAlias: episode.selectedPlayerAlias,
        playerLabel: selectedPlayer?.label ?? "Unknown",
        language: selectedPlayer?.language,
        state: "resolving",
        percent: 1,
        message: "Preparing browser download",
        updatedAt: Date.now(),
      },
    }));

    try {
      const resolved = await startBrowserResolvedDownload(episode);
      const saved = await downloadResolvedVideoInBrowser(
        episode,
        resolved,
        (progress) => {
          void persistDownloadJobUpdate(episode.id, {
            state: progress.percent < 10 ? "resolving" : "downloading",
            percent: Math.max(1, progress.percent),
            message: progress.message,
            error: undefined,
          });
        },
        controller.signal,
      );
      if (selectedPlayer?.language) {
        setDownloadedLanguage(episode.id, selectedPlayer.language);
        setDownloadedEpisodeLanguageById((prev) => {
          const next = new Map(prev);
          next.set(episode.id, selectedPlayer.language as string);
          return next;
        });
      }
      setDownloadedEpisodeIds((prev) => {
        const next = new Set(prev);
        next.add(episode.id);
        return next;
      });
      setDownloadedEpisodeFileById((prev) => {
        const next = new Map(prev);
        next.set(episode.id, saved.fileName);
        return next;
      });
      await writeEpisodeFolderRecord(episode, [saved.fileName], 0, saved.fileName);
      setDownloadQueue((prev) => removeDownloadQueueItem(prev, episode.id));
    } catch (error) {
      if (controller.signal.aborted) {
        setDownloadQueue((prev) => removeDownloadQueueItem(prev, episode.id));
        return;
      }

      const message = error instanceof Error ? error.message : "Failed to start browser download.";
      await persistDownloadJobUpdate(episode.id, {
        state: "failed",
        percent: 0,
        message,
        error: message,
      });
    } finally {
      activeBrowserDownloadControllersRef.current.delete(episode.id);
    }
  }

  async function resumeDownloadJob(item: PersistentDownloadJob) {
    if (activeDownloadPollsRef.current.has(item.episodeId)) {
      return;
    }

    activeDownloadPollsRef.current.add(item.episodeId);

    const poll = async () => {
      try {
        const nextJob = await getFullDownloadStatus(item.jobId);

        if (nextJob.state === "completed") {
          setDownloadedEpisodeIds((prev) => {
            const next = new Set(prev);
            next.add(item.episodeId);
            return next;
          });
          const mirroredFileName = await mirrorCompletedDownloadToVault(item.episodeId, nextJob.outputPath);
          if (mirroredFileName) {
            setDownloadedEpisodeFileById((prev) => {
              const next = new Map(prev);
              next.set(item.episodeId, mirroredFileName);
              return next;
            });
          }
          if (item.language) {
            setDownloadedLanguage(item.episodeId, item.language);
            setDownloadedEpisodeLanguageById((prev) => {
              const next = new Map(prev);
              next.set(item.episodeId, item.language as string);
              return next;
            });
          }

          setDownloadQueue((prev) => removeDownloadQueueItem(prev, item.episodeId));
          activeDownloadPollsRef.current.delete(item.episodeId);
          return;
        }

        if (nextJob.state === "failed") {
          console.error("[DOWNLOAD] Job failed", {
            episodeId: item.episodeId,
            jobId: item.jobId,
            error: nextJob.error ?? nextJob.message,
          });
          await persistDownloadJobUpdate(item.episodeId, {
            state: "failed",
            percent: 0,
            message: nextJob.error ?? nextJob.message ?? "Download failed",
            error: nextJob.error ?? nextJob.message,
          });
          activeDownloadPollsRef.current.delete(item.episodeId);
          return;
        }

        await persistDownloadJobUpdate(item.episodeId, {
          state: nextJob.state,
          percent: nextJob.percent,
          message: nextJob.message,
          outputPath: nextJob.outputPath,
          error: nextJob.error,
        });

        window.setTimeout(poll, 1200);
      } catch (error) {
        const message = error instanceof Error ? error.message : "Failed to fetch job status.";
        console.error("[DOWNLOAD] Poll error", {
          episodeId: item.episodeId,
          jobId: item.jobId,
          message,
        });

        if (/job not found/i.test(message)) {
          await persistDownloadJobUpdate(item.episodeId, {
            state: "failed",
            percent: 0,
            message: "Download was interrupted or the server restarted.",
            error: message,
          });
          activeDownloadPollsRef.current.delete(item.episodeId);
          return;
        }

        window.setTimeout(poll, 2000);
      }
    };

    void poll();
  }

  useEffect(() => {
    for (const item of Object.values(downloadQueue)) {
      if (item.state === "queued" || item.state === "resolving" || item.state === "downloading") {
        void resumeDownloadJob(item);
      }
    }
    // Resume once on startup; new items are resumed immediately after creation.
  }, []);

  function withLocalPlayer(episode: LibraryEpisode): LibraryEpisode {
    if (!downloadedEpisodeIds.has(episode.id)) {
      return episode;
    }

    const localAlias = "spillsave-file" as PlayerAlias;
    const fileName = downloadedEpisodeFileById.get(episode.id);
    const savedLanguage = downloadedEpisodeLanguageById.get(episode.id);
    const inferredLanguage =
      savedLanguage ??
      episode.players.find((player) => player.alias === episode.selectedPlayerAlias)?.language ??
      episode.players.find((player) => player.provider !== "local")?.language;
    const localUrl = buildRuntimeDownloadFileUrl(episode.id, fileName);
    const localPlayer = {
      alias: localAlias,
      provider: "spillsave",
      label: "Spillsave",
      language: inferredLanguage,
      sourcePageUrl: localUrl,
      embedUrl: localUrl,
    };

    const filteredPlayers = episode.players.filter(
      (player) => player.alias !== "local-file" && player.alias !== localAlias && player.provider !== "local"
    );
    const basePlayers = [localPlayer, ...filteredPlayers];
    const hasSelectedAlias =
      basePlayers.some((player) => player.alias === episode.selectedPlayerAlias) ||
      episode.selectedPlayerAlias === "local-file";

    return {
      ...episode,
      players: basePlayers,
      selectedPlayerAlias: hasSelectedAlias ? (episode.selectedPlayerAlias === "local-file" ? localAlias : episode.selectedPlayerAlias) : localAlias,
    };
  }

  const selectedEpisodeWithLocal = useMemo(() => {
    if (!selectedEpisode) {
      return null;
    }
    return withLocalPlayer(selectedEpisode);
  }, [selectedEpisode, downloadedEpisodeIds, downloadedEpisodeFileById]);

  const activeShowWithLocal = useMemo(() => {
    if (!activeShowSlug) {
      return null;
    }
    const show = state.shows.find((entry) => entry.slug === activeShowSlug) ?? null;
    if (!show) {
      return null;
    }

    return {
      ...show,
      episodes: show.episodes.map((episode) => withLocalPlayer(episode)),
    };
  }, [activeShowSlug, downloadedEpisodeIds, downloadedEpisodeFileById, state.shows]);

  async function handleImport(
    platform: IntegrationId,
    overrideSlug?: string,
    mediaType?: "movie" | "serial",
  ) {
    const slug = (overrideSlug ?? importSlug).trim().toLowerCase();
    if (!slug) {
      setImportMessage("Enter a show slug, for example `upload` or `see`.");
      return;
    }

    setImporting(true);
    setImportMessage(null);

    try {
      const show = platform === "bombuj" 
        ? await importBombujMovie(slug, mediaType)
         : await importSvetSerialuShow(slug);

      const nextState = upsertImportedShow(show);
      setState(nextState);
      setTasteProfile(recordImportedShowSignal(show));
      setImportSlug("");
      setImportMessage(
        `${show.title}: imported ${show.episodes.length} episode entries across ${show.availableSeasons.length} season(s).`,
      );
    } catch (error) {
      setImportMessage(error instanceof Error ? error.message : "Failed to import show.");
    } finally {
      setImporting(false);
    }
  }

  async function handleImportSubmit() {
    const resolved = resolveImportInput(importSlug);

    if (resolved.mode === "direct" && resolved.platform && resolved.slug) {
      setImportSearchResults([]);
      await handleImport(resolved.platform, resolved.slug, resolved.mediaType);
      return;
    }

    const query = resolved.query?.trim() ?? "";
    if (!query) {
      setImportMessage("Paste a supported link or type a movie or series name.");
      setImportSearchResults([]);
      return;
    }

    setIsSearchingImport(true);
    setImportMessage(null);

    try {
      const results = await searchRemotes(query);
      const prioritizedResults = prioritizeImportSearchResults(results);
      const topResult = prioritizedResults[0];

      if (topResult && isExactImportSearchMatch(query, topResult)) {
        setImportSearchResults([]);
        await handleImport(topResult.platform, topResult.slug, topResult.mediaType);
        return;
      }

      setImportSearchResults(prioritizeImportSearchResults(results));
      if (results.length === 0) {
        setImportMessage("No external titles found.");
      }
    } catch (error) {
      setImportSearchResults([]);
      setImportMessage(error instanceof Error ? error.message : "Search failed.");
    } finally {
      setIsSearchingImport(false);
    }
  }

  async function handleImportSearchPick(result: RemoteSearchResult) {
    setImportSlug(result.slug);
    setImportSearchResults([]);
    await handleImport(result.platform, result.slug, result.mediaType);
  }

  function handleQueryChange(value: string) {
    if (activeView === "explore") {
      setDiscoveryStateAndPersist({ exploreQuery: value });
      return;
    }

    if (isProviderFeedViewId(activeView)) {
      updateProviderFeedPageState(activeView, {
        query: value,
        ...(value.trim()
          ? {}
          : {
              searchResults: [],
              searchError: null,
              searchLoading: false,
              lastSearchQuery: null,
            }),
      });
      return;
    }

    handleLibraryQueryChange(value);
  }

  async function handleRefreshProviderFeed() {
    if (!activeProviderFeedMeta) {
      return;
    }

    const viewId = activeProviderFeedMeta.viewId;
    const query = (providerFeedStates[viewId] ?? createEmptyProviderFeedPageState()).query.trim();

    if (query) {
      updateProviderFeedPageState(viewId, {
        searchLoading: true,
        searchError: null,
      });

      try {
        const results = await searchProviderModuleItems({
          moduleId: activeProviderFeedMeta.module.moduleId,
          query,
        });
        updateProviderFeedPageState(viewId, {
          searchResults: results,
          searchLoading: false,
          searchError: null,
          lastSearchQuery: query,
        });
      } catch (error) {
        updateProviderFeedPageState(viewId, {
          searchResults: [],
          searchLoading: false,
          searchError: error instanceof Error ? error.message : "Failed to search this provider.",
          lastSearchQuery: query,
        });
      }
      return;
    }

    updateProviderFeedPageState(viewId, {
      feedLoading: true,
      feedError: null,
    });

    try {
      const feed = await fetchProviderFeed({
        moduleId: activeProviderFeedMeta.module.moduleId,
        feedId: activeProviderFeedMeta.feed.feedId,
        limit: 24,
      });
      updateProviderFeedPageState(viewId, {
        feed,
        feedLoading: false,
        feedError: null,
      });
    } catch (error) {
      updateProviderFeedPageState(viewId, {
        feedLoading: false,
        feedError: error instanceof Error ? error.message : "Failed to load provider feed.",
      });
    }
  }

  async function handleLoadMoreProviderFeed() {
    if (!activeProviderFeedMeta) {
      return;
    }

    const viewId = activeProviderFeedMeta.viewId;
    const current = providerFeedStates[viewId] ?? createEmptyProviderFeedPageState();
    if (current.query.trim() || current.feedLoading || !current.feed?.continueCursor) {
      return;
    }

    updateProviderFeedPageState(viewId, {
      feedLoading: true,
      feedError: null,
    });

    try {
      const nextFeed = await fetchProviderFeed({
        moduleId: activeProviderFeedMeta.module.moduleId,
        feedId: activeProviderFeedMeta.feed.feedId,
        cursor: current.feed.continueCursor,
        limit: 24,
      });
      updateProviderFeedPageState(viewId, {
        feed: {
          ...nextFeed,
          items: mergeProviderFeedItems(current.feed.items, nextFeed.items),
        },
        feedLoading: false,
        feedError: null,
      });
    } catch (error) {
      updateProviderFeedPageState(viewId, {
        feedLoading: false,
        feedError: error instanceof Error ? error.message : "Failed to load more provider feed items.",
      });
    }
  }

  function handleToggleProviderFeed(moduleId: string, feedId: string) {
    const viewId = createProviderFeedViewId(moduleId, feedId);
    setEnabledProviderFeeds((current) => {
      const next = sanitizeEnabledProviderFeeds(
        toggleEnabledProviderFeed(current, { moduleId, feedId }),
        providerModules,
      );
      writeEnabledProviderFeeds(next);
      if (activeView === viewId && !next.some((feed) => feed.moduleId === moduleId && feed.feedId === feedId)) {
        setActiveView("home");
      }
      return next;
    });
  }

  function handleOpenDiscoveryItem(item: ExploreItem) {
    const inVaultShow = findImportedShowForItem(item);

    if (inVaultShow) {
      handleOpenShow(inVaultShow.slug);
      return;
    }

    void handleImport(item.provider, item.importSlug, item.mediaType);
  }

  function handleLibraryQueryChange(value: string) {
    const nextState = {
      ...state,
      query: value,
    };
    setState(nextState);
    writeLibraryState(nextState);
  }

  function handleSelectEpisode(episode: LibraryEpisode) {
    const nextState = selectEpisode(episode.id);
    setState(nextState);
    const show = state.shows.find((entry) => entry.episodes.some((entryEpisode) => entryEpisode.id === episode.id));
    if (show) {
      setTasteProfile(recordEpisodePlaySignal(show, episode));
      const selectedPlayer = episode.players.find((player) => player.alias === episode.selectedPlayerAlias);
      setTasteProfile(recordAudioPreferenceSignal(selectedPlayer?.language));
    }

    if (downloadedEpisodeIds.has(episode.id)) {
      const withLocalSelected = updateSelectedPlayer(episode.id, "local-file");
      setState(withLocalSelected);
    }
  }

  function handleOpenShow(slug: string) {
    const nextPath = `/${slug}`;
    window.history.pushState({}, "", nextPath);
    setActiveShowSlug(slug);
    const show = state.shows.find((entry) => entry.slug === slug);
    if (show) {
      setTasteProfile(recordShowOpenSignal(show));
    }
  }

  function handleCloseShow() {
    window.history.pushState({}, "", "/");
    setActiveShowSlug(null);
  }

  function handleRemoveShow(slug: string) {
    const show = state.shows.find((entry) => entry.slug === slug) ?? null;
    if (!show) {
      return;
    }
    setPendingRemoveShow(show);
  }

  function handleConfirmRemoveShow(show: ImportedShow) {
    setPendingRemoveShow(null);
    const nextState = removeShow(show.slug);
    setState(nextState);
    if (activeShowSlug === show.slug) {
      handleCloseShow();
    }
  }

  function handleToggleFavorite(slug: string) {
    const nextState = toggleFavorite(slug);
    setState(nextState);
    const show = nextState.shows.find((entry) => entry.slug === slug);
    if (show) {
      setTasteProfile(recordFavoriteSignal(show, Boolean(show.isFavorite)));
    }
  }

  function handleClosePlayer() {
    const nextState = selectEpisode(undefined);
    setState(nextState);
  }

  function handleChangeExploreVaultFilter(value: ExploreFilters["inVault"]) {
    setDiscoveryState((current) => {
      const next = {
        ...current,
        exploreFilters: {
          ...current.exploreFilters,
          inVault: value,
        },
      } satisfies DiscoveryUiState;
      updateDiscoveryUiState(next);
      return next;
    });
  }

  function handleChangeExploreAvailability(value: ExploreFilters["availability"]) {
    setDiscoveryState((current) => {
      const next = {
        ...current,
        exploreFilters: {
          ...current.exploreFilters,
          availability: value,
        },
      } satisfies DiscoveryUiState;
      updateDiscoveryUiState(next);
      return next;
    });
  }

  function handleChangeExploreYear(key: "yearMin" | "yearMax", rawValue: string) {
    const trimmed = rawValue.trim();
    const parsed = trimmed ? Number.parseInt(trimmed, 10) : undefined;
    setDiscoveryState((current) => {
      const next = {
        ...current,
        exploreFilters: {
          ...current.exploreFilters,
          [key]: Number.isFinite(parsed ?? Number.NaN) ? parsed : undefined,
        },
      } satisfies DiscoveryUiState;
      updateDiscoveryUiState(next);
      return next;
    });
  }

  function handleChangeExplorePersonQuery(value: string) {
    setDiscoveryState((current) => {
      const next = {
        ...current,
        exploreFilters: {
          ...current.exploreFilters,
          personQuery: value,
        },
      } satisfies DiscoveryUiState;
      updateDiscoveryUiState(next);
      return next;
    });
  }

  function handleChangeExplorePersonRole(value: ExplorePersonRole) {
    setDiscoveryState((current) => {
      const next = {
        ...current,
        exploreFilters: {
          ...current.exploreFilters,
          personRole: value,
        },
      } satisfies DiscoveryUiState;
      updateDiscoveryUiState(next);
      return next;
    });
  }

  function handleSetExploreFilters(nextFilters: ExploreFilters) {
    setDiscoveryStateAndPersist({
      exploreFilters: {
        mediaTypes: nextFilters.mediaTypes,
        providers: nextFilters.providers,
        genres: nextFilters.genres,
        audioBuckets: nextFilters.audioBuckets,
        networks: nextFilters.networks,
        sections: nextFilters.sections,
        inVault: nextFilters.inVault,
        availability: nextFilters.availability,
        yearMin: nextFilters.yearMin,
        yearMax: nextFilters.yearMax,
        personQuery: nextFilters.personQuery,
        personRole: nextFilters.personRole ?? "any",
      },
    });
  }

  function handleResetExploreFilters() {
    setDiscoveryStateAndPersist({
      exploreQuery: "",
      exploreFilters: {
        mediaTypes: [],
        providers: [],
        genres: [],
        audioBuckets: [],
        networks: [],
        sections: [],
        inVault: "all",
        availability: "all",
        yearMin: undefined,
        yearMax: undefined,
        personQuery: "",
        personRole: "any",
      },
    });
  }

  function handleLoadMoreExplore() {
    if (!exploreCursor || exploreLoading) {
      return;
    }

    void loadExplore(exploreCursor);
  }

  function buildDownloadLanguageOptions(episode: LibraryEpisode): DownloadLanguageOption[] {
    const remotePlayers = episode.players.filter((player) => player.provider !== "local");
    const byLanguage = new Map<string, typeof remotePlayers>();
    for (const player of remotePlayers) {
      const key = (player.language || "Unspecified").trim();
      const list = byLanguage.get(key) ?? [];
      list.push(player);
      byLanguage.set(key, list);
    }

    return Array.from(byLanguage.entries()).map(([language, players]) => {
      const presentation = getLanguagePresentation(language);
      const preferred =
        players.find((player) => player.alias === episode.selectedPlayerAlias) ?? players[0];

      return {
        language: presentation.label,
        flags: presentation.flags,
        playerCount: players.length,
        providers: players.map((player) => player.provider),
        preferredAlias: preferred?.alias ?? players[0]?.alias ?? episode.selectedPlayerAlias,
      };
    });
  }

  async function startFullDownloadForEpisode(episode: LibraryEpisode, selectedAlias?: PlayerAlias, engine: DownloadEngine = state.settings.downloadEngine) {
    await requireWritableLibraryFolder();

    const episodeForDownload =
      selectedAlias && selectedAlias !== episode.selectedPlayerAlias
        ? { ...episode, selectedPlayerAlias: selectedAlias }
        : episode;

    if (selectedAlias && selectedAlias !== episode.selectedPlayerAlias) {
      const nextState = updateSelectedPlayer(episode.id, selectedAlias);
      setState(nextState);
    }

    if (engine === "wasm") {
      await startBrowserManagedDownload(episodeForDownload);
      return;
    }

    if (downloadBackendAvailable === false) {
      window.alert("Local FFmpeg downloads require the server runtime. Switch the download engine to FFmpeg.wasm or start the local backend.");
      return;
    }

    if (downloadedEpisodeIds.has(episode.id)) {
      return;
    }

    const existing = downloadQueue[episode.id];
    if (existing && (existing.state === "queued" || existing.state === "resolving" || existing.state === "downloading")) {
      return;
    }

    try {
      const job = await startFullDownload(episodeForDownload);

      const selectedPlayer = episodeForDownload.players.find((player) => player.alias === episodeForDownload.selectedPlayerAlias) ?? episodeForDownload.players[0];

      setDownloadQueue((prev) => ({
        ...prev,
        [episode.id]: {
          episodeId: episode.id,
          jobId: job.id,
          showTitle: episode.showTitle,
          episodeTitle: formatEpisodeTitle(episode),
          seasonNumber: episode.seasonNumber,
          episodeNumber: episode.episodeNumber,
          episodeCode: episode.episodeCode,
          selectedPlayerAlias: episodeForDownload.selectedPlayerAlias,
          playerLabel: selectedPlayer?.label ?? "Unknown",
          language: selectedPlayer?.language,
          state: job.state,
          percent: job.percent,
          message: job.message,
          outputPath: job.outputPath,
          error: job.error,
          updatedAt: Date.now(),
        },
      }));

      await resumeDownloadJob({
        episodeId: episode.id,
        jobId: job.id,
        showTitle: episode.showTitle,
        episodeTitle: formatEpisodeTitle(episode),
        seasonNumber: episode.seasonNumber,
        episodeNumber: episode.episodeNumber,
        episodeCode: episode.episodeCode,
        selectedPlayerAlias: episodeForDownload.selectedPlayerAlias,
        playerLabel: selectedPlayer?.label ?? "Unknown",
        language: selectedPlayer?.language,
        state: job.state,
        percent: job.percent,
        message: job.message,
        outputPath: job.outputPath,
        error: job.error,
        updatedAt: Date.now(),
      });
    } catch (error) {
      window.alert(error instanceof Error ? error.message : "Failed to start full download.");
    }
  }

  async function handleStartFullDownload(episode: LibraryEpisode) {
    const options = buildDownloadLanguageOptions(episode);

    if (options.length === 0) {
      window.alert("No downloadable remote players are available for this episode.");
      return;
    }

    if (options.length > 1) {
      setDownloadLanguageChoice({ episode, options });
      return;
    }

    const selectedAlias = options[0]?.preferredAlias ?? episode.selectedPlayerAlias;
    setDownloadEngineChoice({ episode, selectedAlias });
  }

  async function handleSelectDownloadLanguage(alias: PlayerAlias) {
    if (!downloadLanguageChoice) {
      return;
    }

    const { episode } = downloadLanguageChoice;
    setDownloadLanguageChoice(null);
    setDownloadEngineChoice({ episode, selectedAlias: alias });
  }

  async function handleSelectDownloadEngine(engine: DownloadEngine) {
    if (!downloadEngineChoice) {
      return;
    }

    const { episode, selectedAlias } = downloadEngineChoice;
    setDownloadEngineChoice(null);

    try {
      await requireWritableLibraryFolder();
    } catch (error) {
      window.alert(error instanceof Error ? error.message : "Connect a writable vault folder before downloading.");
      return;
    }

    const nextState = updateSettings({ downloadEngine: engine });
    setState(nextState);
    await startFullDownloadForEpisode(episode, selectedAlias, engine);
  }

  async function handleDeleteFullDownload(episode: LibraryEpisode) {
    setPendingDeleteEpisode(episode);
  }

  async function handleCancelFullDownload(episode: LibraryEpisode) {
    try {
      const existing = downloadQueue[episode.id];
      if (existing && isBrowserDownloadJobId(existing.jobId)) {
        activeBrowserDownloadControllersRef.current.get(episode.id)?.abort();
        activeBrowserDownloadControllersRef.current.delete(episode.id);
        await removeEpisodeFolderRecord(episode.id).catch(() => undefined);
        setDownloadQueue((prev) => removeDownloadQueueItem(prev, episode.id));
        return;
      }

      await cancelDownload(episode.id);
      setDownloadedEpisodeIds((prev) => {
        const next = new Set(prev);
        next.delete(episode.id);
        return next;
      });
      setDownloadedEpisodeFileById((prev) => {
        const next = new Map(prev);
        next.delete(episode.id);
        return next;
      });
      removeDownloadedLanguage(episode.id);
      setDownloadedEpisodeLanguageById((prev) => {
        const next = new Map(prev);
        next.delete(episode.id);
        return next;
      });
      await removeEpisodeFolderRecord(episode.id).catch(() => undefined);
      await persistDownloadJobUpdate(episode.id, {
        state: "failed",
        percent: 0,
        message: "Download canceled",
        error: "Canceled by user",
        outputPath: undefined,
      });
      activeDownloadPollsRef.current.delete(episode.id);
    } catch (error) {
      window.alert(error instanceof Error ? error.message : "Failed to cancel download.");
    }
  }

  async function handleConfirmDelete(episode: LibraryEpisode) {
    setPendingDeleteEpisode(null);
    try {
      await deleteDownload(episode.id);
      setDownloadedEpisodeIds((prev) => {
        const next = new Set(prev);
        next.delete(episode.id);
        return next;
      });
      setDownloadedEpisodeFileById((prev) => {
        const next = new Map(prev);
        next.delete(episode.id);
        return next;
      });
      removeDownloadedLanguage(episode.id);
      setDownloadedEpisodeLanguageById((prev) => {
        const next = new Map(prev);
        next.delete(episode.id);
        return next;
      });
      await removeEpisodeFolderRecord(episode.id).catch(() => undefined);
      setDownloadQueue((prev) => removeDownloadQueueItem(prev, episode.id));
    } catch (error) {
      window.alert(error instanceof Error ? error.message : "Failed to delete download.");
    }
  }

  function handleDismissDownloadJob(episodeId: string) {
    setDownloadQueue((prev) => removeDownloadQueueItem(prev, episodeId));
  }

  async function handleClearOffline() {
    await clearOfflineCache();
    await clearEpisodeFolderRecords();
    const nextState = clearOfflineDownloads();
    setState(nextState);
  }

  async function handleRefreshArtwork() {
    if (artworkRefreshBusy) {
      return;
    }

    if (state.shows.length === 0) {
      setArtworkRefreshSummary("No titles in the library yet.");
      return;
    }

    setArtworkRefreshBusy(true);
    setArtworkRefreshSummary(`Refreshing artwork for ${state.shows.length} title(s)...`);

    try {
      let updatedCount = 0;
      const refreshedShows = await Promise.all(
        state.shows.map(async (show) => {
          try {
            const artwork = await refreshArtworkForShow(show, state.settings.artworkSources);
            const nextShow = {
              ...show,
              posterUrl: artwork.posterUrl ?? show.posterUrl ?? null,
              backdropUrl: artwork.backdropUrl ?? show.backdropUrl ?? null,
              clearLogoUrl: artwork.clearLogoUrl ?? show.clearLogoUrl ?? null,
            };

            if (
              nextShow.posterUrl !== show.posterUrl ||
              nextShow.backdropUrl !== show.backdropUrl ||
              nextShow.clearLogoUrl !== show.clearLogoUrl
            ) {
              updatedCount += 1;
            }

            return nextShow;
          } catch {
            return show;
          }
        }),
      );

      const nextState = {
        ...state,
        shows: refreshedShows,
      };
      writeLibraryState(nextState);
      setState(nextState);
      setArtworkRefreshSummary(`Artwork refreshed. Updated ${updatedCount} of ${state.shows.length} title(s).`);
    } catch (error) {
      setArtworkRefreshSummary(error instanceof Error ? error.message : "Artwork refresh failed.");
    } finally {
      setArtworkRefreshBusy(false);
    }
  }

  function handleUpdateShowArtwork(
    slug: string,
    artwork: {
      posterUrl?: string | null;
      backdropUrl?: string | null;
      clearLogoUrl?: string | null;
    },
  ) {
    const nextState = {
      ...state,
      shows: state.shows.map((show) =>
        show.slug === slug
          ? {
              ...show,
              posterUrl: artwork.posterUrl ?? null,
              backdropUrl: artwork.backdropUrl ?? null,
              clearLogoUrl: artwork.clearLogoUrl ?? null,
            }
          : show,
      ),
    };
    writeLibraryState(nextState);
    setState(nextState);
  }

  function handleExportLibrary() {
    const snapshot = exportLibraryState();
    const blob = new Blob([JSON.stringify(snapshot, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    anchor.href = url;
    anchor.download = `spilled-library-${stamp}.json`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 0);
  }

  async function handleImportLibrary(file: File) {
    const text = await file.text();
    const parsed = JSON.parse(text) as unknown;
    const nextState = importLibraryState(parsed);
    setState(nextState);
    setImportMessage(`Imported library snapshot with ${nextState.shows.length} title(s).`);
    setActiveShowSlug(null);
    setActiveView("settings");
  }

  function handlePrevHero() {
    if (state.shows.length <= 1) return;
    setHeroIndex((current) => (current - 1 + state.shows.length) % state.shows.length);
  }

  function handleNextHero() {
    if (state.shows.length <= 1) return;
    setHeroIndex((current) => (current + 1) % state.shows.length);
  }


  function handleSelectPlayer(episodeId: string, alias: PlayerAlias) {
    const nextState = updateSelectedPlayer(episodeId, alias);
    setState(nextState);
  }

  function handleCloseWelcome() {
    dismissWelcome();
    setWelcomeOpen(false);
  }

  function handleOpenSettingsFromWelcome() {
    setActiveView("settings");
    handleCloseShow();
  }

  async function handleConnectVault() {
    const connected = await connectLibraryFolder();
    const nextState = updateSettings({ connectedFolderName: connected.name });
    setState(nextState);
    await refreshVaultState();
  }

  async function handleReconnectVaultAccess() {
    const connected = await requestStoredFolderAccess();
    const nextState = updateSettings({ connectedFolderName: connected.name });
    setState(nextState);
    await refreshVaultState();
  }

  async function handleDisconnectVault() {
    await clearStoredFolderHandle();
    const nextState = updateSettings({ connectedFolderName: undefined });
    setState(nextState);
    await refreshVaultState();
  }

  async function handleResetVaultLink() {
    await clearStoredFolderHandle();
    const nextState = updateSettings({ connectedFolderName: undefined });
    setState(nextState);
    setVaultSnapshotReady(false);
    await refreshVaultState();
  }

  async function handleConnectVaultFromWelcome() {
    await handleConnectVault();
  }

  const isExploreSurface = activeView === "explore" || Boolean(activeProviderFeedMeta);
  const headerQuery = activeView === "explore"
    ? discoveryState.exploreQuery
    : activeProviderFeedMeta
      ? activeProviderFeedPageState?.query ?? ""
      : state.query;
  const headerPlaceholder = activeView === "explore"
    ? "Search the live catalog..."
    : activeProviderFeedMeta
      ? `Search inside ${activeProviderFeedMeta.module.displayName}...`
      : "Search movies, series, shows...";
  const headerSearchWidth = isExploreSurface ? "compact" : "default";
  const showHeader = true;

  return (
    <div className="flex min-h-screen overflow-x-hidden bg-[#0c0d12] selection:bg-white/20 selection:text-white lg:h-screen lg:overflow-hidden">
      <Sidebar
        activeView={activeView}
        onChangeView={(v) => {
          setActiveView(v);
          handleCloseShow();
        }}
        feedLinks={providerFeedLinks}
        downloadJobs={downloadJobs}
        onCancelDownload={(episodeId) => {
          const show = state.shows.find((entry) => entry.episodes.some((episode) => episode.id === episodeId));
          const episode = show?.episodes.find((entry) => entry.id === episodeId);
          if (!episode) {
            return;
          }
          void handleCancelFullDownload(episode);
        }}
        onDismissDownload={handleDismissDownloadJob}
      />

      <div className="flex min-h-screen min-w-0 flex-1 flex-col pb-28 pl-0 lg:min-h-0 lg:pb-0 lg:pl-64">
        {showHeader ? (
          <Header
            query={headerQuery}
            onQueryChange={handleQueryChange}
            mediaFilter={mediaFilter}
            setMediaFilter={setMediaFilter}
            onOpenSettings={handleOpenSettingsFromWelcome}
            localRuntimeStatus={localRuntimeStatus}
            showMediaFilter={activeView === "home" || activeView === "favorites"}
            searchPlaceholder={headerPlaceholder}
            searchWidth={headerSearchWidth}
          />
        ) : null}

        {downloadBackendAvailable === false && state.settings.downloadEngine === "localffmpeg" ? (
          <div className="mx-4 mt-4 rounded-2xl border border-amber-500/20 bg-amber-500/10 px-4 py-3 text-sm text-amber-100 sm:mx-6 lg:mx-10">
            Local FFmpeg is selected, but the server-side download runtime is unavailable. Switch to FFmpeg.wasm or start the local backend.
          </div>
        ) : null}

        <main className={clsx(
          "min-w-0 flex-1 overflow-visible pb-8 lg:min-h-0 lg:overflow-y-auto lg:pb-10",
          showHeader ? "pt-4 lg:pt-6" : "pt-0",
        )}>
          {activeShowSlug ? (
            <ShowDetail
              show={activeShowWithLocal}
              onBack={handleCloseShow}
              onSelectEpisode={handleSelectEpisode}
              onRemoveShow={() => handleRemoveShow(activeShowSlug)}
              onToggleFavorite={() => handleToggleFavorite(activeShowSlug)}
              onUpdateArtwork={(artwork) => handleUpdateShowArtwork(activeShowSlug, artwork)}
              fullDownloadJobsByEpisode={fullDownloadJobsByEpisode}
              onStartFullDownload={handleStartFullDownload}
              onCancelFullDownload={handleCancelFullDownload}
              downloadedEpisodeIds={downloadedEpisodeIds}
              onDeleteFullDownload={handleDeleteFullDownload}
            />
          ) : activeView === "import" ? (
            <ImportView 
              importSlug={importSlug}
              onImportSlugChange={(value) => {
                setImportSlug(value);
                setImportSearchResults([]);
                if (importMessage?.toLowerCase().includes("no external titles found")) {
                  setImportMessage(null);
                }
              }}
              onSubmit={handleImportSubmit}
              importing={importing}
              importMessage={importMessage}
              isSearching={isSearchingImport}
              searchResults={importSearchResults}
              onPickResult={(result) => {
                void handleImportSearchPick(result);
              }}
            />
          ) : activeView === "downloaded" ? (
            <DownloadedView
              shows={downloadedShows}
              downloadedCountByShow={downloadedCountByShow}
              onOpenShow={handleOpenShow}
            />
          ) : activeView === "settings" ? (
            <SettingsView 
               settings={state.settings}
              offlineUsageBytes={totalOfflineBytes}
              offlineEpisodeCount={Object.keys(state.offlineDownloads).length}
              onClearOffline={handleClearOffline}
              onRefreshArtwork={handleRefreshArtwork}
              artworkRefreshBusy={artworkRefreshBusy}
              artworkRefreshSummary={artworkRefreshSummary}
              onExportLibrary={handleExportLibrary}
              onImportLibrary={handleImportLibrary}
              localRuntimeStatus={localRuntimeStatus}
              onRefreshLocalRuntime={() => {
                void probeLocalRuntime().then(setLocalRuntimeStatus);
              }}
              vaultStatus={vaultStatus}
              vaultDiagnostics={vaultDiagnostics}
              onConnectVault={handleConnectVault}
              onReconnectVaultAccess={handleReconnectVaultAccess}
              onDisconnectVault={handleDisconnectVault}
              onResetVaultLink={handleResetVaultLink}
              onRefreshVaultStatus={() => {
                void refreshVaultState();
              }}
              providerFeeds={providerFeedCatalog}
              onToggleProviderFeed={handleToggleProviderFeed}
               onSettingsChange={(change) => {
                  const nextState = updateSettings(change);
                  setState(nextState);
               }}
            />
          ) : activeView === "support" ? (
             <SupportView />
          ) : activeView === "explore" ? (
            <ExploreView
              query={discoveryState.exploreQuery}
              onQueryChange={handleQueryChange}
              feed={exploreFeed}
              loading={exploreLoading}
              error={exploreError}
              filters={discoveryState.exploreFilters}
              onToggleProvider={(provider) => toggleExploreFilter("providers", provider)}
              onToggleMediaType={(mediaType) => toggleExploreFilter("mediaTypes", mediaType)}
              onToggleGenre={(genre) => toggleExploreFilter("genres", genre)}
              onToggleNetwork={(network) => toggleExploreFilter("networks", network)}
              onToggleSection={(section) => toggleExploreFilter("sections", section)}
              onToggleAudio={(bucket) => toggleExploreFilter("audioBuckets", bucket)}
              onChangeVaultFilter={handleChangeExploreVaultFilter}
              onChangeAvailability={handleChangeExploreAvailability}
              onChangeYearMin={(value) => handleChangeExploreYear("yearMin", value)}
              onChangeYearMax={(value) => handleChangeExploreYear("yearMax", value)}
              onChangePersonQuery={handleChangeExplorePersonQuery}
              onChangePersonRole={handleChangeExplorePersonRole}
              onSetFilters={handleSetExploreFilters}
              onResetFilters={handleResetExploreFilters}
              onLoadMore={handleLoadMoreExplore}
              onImport={(item) => {
                void handleImport(item.provider, item.importSlug, item.mediaType);
              }}
              onOpenVault={handleOpenDiscoveryItem}
            />
          ) : activeProviderFeedMeta && activeProviderFeedPageState ? (
            <ProviderFeedPage
              module={activeProviderFeedMeta.module}
              feed={activeProviderFeedMeta.feed}
              items={activeProviderFeedItems}
              query={activeProviderFeedPageState.query}
              loading={activeProviderFeedPageState.query.trim() ? activeProviderFeedPageState.searchLoading : activeProviderFeedPageState.feedLoading}
              error={activeProviderFeedPageState.query.trim() ? activeProviderFeedPageState.searchError : activeProviderFeedPageState.feedError}
              stale={activeProviderFeedPageState.feed?.stale ?? false}
              generatedAt={activeProviderFeedPageState.feed?.generatedAt ?? null}
              continueCursor={activeProviderFeedPageState.feed?.continueCursor ?? null}
              onRefresh={() => {
                void handleRefreshProviderFeed();
              }}
              onLoadMore={() => {
                void handleLoadMoreProviderFeed();
              }}
              onImport={(item) => {
                void handleImport(item.provider, item.importSlug, item.mediaType);
              }}
              onOpenVault={handleOpenDiscoveryItem}
            />
          ) : (
            <>
              {/* Only show Hero if no search query, or adjust logically */}
              {!state.query && activeView === "home" && (
                <Hero 
                  featuredShow={featuredShow} 
                  onPrev={handlePrevHero}
                  onNext={handleNextHero}
                  progressKey={featuredShow?.slug}
                  progressDurationMs={HERO_ROTATION_MS}
                  onPlay={() => {
                    if (latestEpisodeOfFeatured) {
                      handleSelectEpisode(latestEpisodeOfFeatured);
                    } else if (featuredShow) {
                      handleOpenShow(featuredShow.slug);
                    }
                  }} 
                  onToggleFavorite={featuredShow ? () => handleToggleFavorite(featuredShow.slug) : undefined}
                />
              )}

              <div className="mt-4 px-4 pb-12 sm:px-6 lg:px-10">
                <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                  <h2 className="text-xl font-semibold tracking-tight text-white capitalize">
                    {state.query ? "Local Vault" : activeView === "favorites" ? "Favorites" : "All Library"}
                  </h2>
                </div>

                <div
                  className="animate-fade-in grid grid-cols-[repeat(auto-fill,minmax(150px,182px))] justify-start gap-5 opacity-0 sm:grid-cols-[repeat(auto-fill,minmax(168px,190px))] xl:grid-cols-[repeat(auto-fill,minmax(182px,210px))]"
                  style={{ animationDelay: "0.2s" }}
                >
                  {filteredShows.map((show: ImportedShow) => (
                    <ShowCard key={show.slug} show={show} onOpen={handleOpenShow} />
                  ))}
                  
                  {filteredShows.length === 0 && !state.query && (
                    <div className="col-span-full py-24 flex flex-col items-center justify-center text-center">
                      <span className="text-white/20 mb-2">🎬</span>
                      <span className="text-sm font-medium text-white/40">
                         {activeView === "favorites" ? "You haven't liked any titles yet." : "No shows found."}
                      </span>
                    </div>
                  )}
                </div>

                {/* Remote Search Module (Shown only when querying) */}
                {state.query && (
                  <div className="mt-10 animate-fade-in">
                    <div className="mb-4 flex items-center justify-between">
                      <h2 className="text-base font-semibold tracking-tight text-white/80 flex items-center gap-3">
                        Web Matches
                        {isSearchingRemote && (
                          <span className="text-[10px] font-medium text-orange-400 animate-pulse bg-orange-400/10 px-2 py-1 rounded-md">
                            Searching Extractors...
                          </span>
                        )}
                      </h2>
                    </div>

                    {remoteResults.length > 0 ? (
                      <div className="space-y-6">
                        {remotePlatformOrder.map((platformKey) => {
                          const list = remoteByPlatform[platformKey];
                          if (list.length === 0) return null;
                          const sectionLabel = platformKey === "svetserialu" ? "Svetserialu" : "Bombuj";
                          return (
                            <div key={platformKey} className="rounded-2xl border border-white/5 bg-white/5 p-4">
                              <div className="mb-3 flex items-center justify-between">
                                <span className="text-xs font-semibold uppercase tracking-[0.32em] text-white/40">
                                  {sectionLabel}
                                </span>
                                <span className="text-[10px] font-medium text-white/30">{list.length} results</span>
                              </div>
                              <div className="flex gap-3 overflow-x-auto pb-2">
                                {list.map((r) => {
                                  const platformLabel = r.platform === "svetserialu" ? "Svetserialu." : "Bombuj";
                                  const typeLabel =
                                    r.mediaType === "movie" ? "Movie" : r.mediaType === "serial" ? "Serial" : "Title";
                                  return (
                                    <div
                                      key={`${r.platform}-${r.slug}`}
                                      className="group relative w-40 shrink-0 overflow-hidden rounded-xl border border-white/10 bg-[#14151b] shadow-[0_8px_20px_rgba(0,0,0,0.35)]"
                                    >
                                      <div
                                        className="relative aspect-[2/3] w-full bg-[#0f1016] bg-cover bg-center"
                                        style={r.posterUrl ? { backgroundImage: `url(${r.posterUrl})` } : undefined}
                                      >
                                        <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/20 to-transparent" />
                                        <div className="absolute inset-x-2 top-2 flex items-center justify-end">
                                          <span className="rounded-full bg-white/90 px-2 py-0.5 text-[9px] font-semibold uppercase tracking-[0.18em] text-black/85 whitespace-nowrap shadow-sm">
                                            {typeLabel}
                                          </span>
                                        </div>

                                        <div className="absolute inset-x-2 bottom-2 flex flex-col gap-1.5">
                                          <div className="inline-flex max-w-full rounded-md bg-white/90 px-2.5 py-1 text-[11px] font-semibold text-black shadow-lg backdrop-blur">
                                            <span className="truncate">{r.title}</span>
                                          </div>
                                          <div className="flex items-center gap-1.5">
                                            <span className="rounded-full bg-black/70 px-2 py-0.5 text-[8px] font-semibold uppercase tracking-[0.18em] text-white/85 whitespace-nowrap shadow-sm">
                                              {platformLabel}
                                            </span>
                                            <button
                                              onClick={() => {
                                                setImportSlug(r.slug);
                                                handleImport(r.platform, r.slug, r.mediaType);
                                              }}
                                              disabled={importing}
                                              className="ml-auto rounded-full bg-white px-2.5 py-0.5 text-[8px] font-bold uppercase tracking-[0.2em] text-black/90 shadow-sm transition-colors hover:bg-white disabled:cursor-not-allowed disabled:opacity-60 whitespace-nowrap"
                                              title="Import to Vault"
                                            >
                                              Add
                                            </button>
                                          </div>
                                        </div>

                                        {!r.posterUrl && (
                                          <div className="absolute inset-0 flex items-center justify-center">
                                            <span className="text-[9px] font-semibold uppercase tracking-[0.32em] text-white/40">
                                              No Poster
                                            </span>
                                          </div>
                                        )}
                                      </div>
                                    </div>
                                  );
                                })}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    ) : !isSearchingRemote && state.query.length >= 3 && (
                      <div className="py-8 border border-dashed border-white/10 rounded-2xl flex flex-col items-center justify-center text-center">
                        <span className="text-sm font-medium text-white/40">No external titles found across active modules.</span>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </>
          )}
        </main>
      </div>

      <DownloadLanguageModal
        episode={downloadLanguageChoice?.episode ?? null}
        options={downloadLanguageChoice?.options ?? []}
        onClose={() => setDownloadLanguageChoice(null)}
        onSelect={handleSelectDownloadLanguage}
      />

      <DownloadEngineModal
        episode={downloadEngineChoice?.episode ?? null}
        preferredEngine={state.settings.downloadEngine}
        localBackendAvailable={downloadBackendAvailable !== false}
        vaultConnected={vaultStatus.connected}
        onClose={() => setDownloadEngineChoice(null)}
        onSelect={handleSelectDownloadEngine}
      />

      <ConfirmDeleteModal
        episode={pendingDeleteEpisode}
        onCancel={() => setPendingDeleteEpisode(null)}
        onConfirm={handleConfirmDelete}
      />

      <ConfirmRemoveShowModal
        show={pendingRemoveShow}
        downloadedCount={pendingRemoveShow ? (downloadedCountByShow[pendingRemoveShow.slug] ?? 0) : 0}
        onCancel={() => setPendingRemoveShow(null)}
        onConfirm={handleConfirmRemoveShow}
      />

      <PlayerModal
        episode={selectedEpisodeWithLocal}
        onClose={handleClosePlayer}
        onSelectPlayer={handleSelectPlayer}
      />

      {welcomeOpen ? (
        <WelcomeModal
          vaultConnected={vaultStatus.connected}
          connectedFolderName={vaultStatus.folderName ?? undefined}
          onClose={handleCloseWelcome}
          onConnectVault={handleConnectVaultFromWelcome}
          onOpenSettings={() => {
            handleOpenSettingsFromWelcome();
            handleCloseWelcome();
          }}
        />
      ) : null}
    </div>
  );
}

export default App;
