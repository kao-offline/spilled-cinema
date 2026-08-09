import { startTransition, useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { RefreshCw } from "lucide-react";
import { clsx } from "clsx";
import { Sidebar } from "./components/Sidebar";
import type { SidebarFeedLink, ViewState } from "./components/Sidebar";
import { Header } from "./components/Header";
import { Hero } from "./components/Hero";
import { ShowCard } from "./components/ShowCard";
import { CinematicHomePage } from "./components/CinematicHomePage";
import { MobileDock, type MobileDockItem } from "./components/MobileDock";
import { ShowDetail } from "./components/ShowDetail";
import { PlayerModal } from "./components/PlayerModal";
import { ImportView, type ImportPlatformFilter } from "./components/ImportView";
import { SettingsView } from "./components/SettingsView";
import { NodeSetupView } from "./components/NodeSetupView";
import { NodeAdminView } from "./components/NodeAdminView";
import { SupportView } from "./components/SupportView";
import { DownloadedView } from "./components/DownloadedView";
import { ExploreView } from "./components/ExploreView";
import { ProviderFeedPage } from "./components/ProviderFeedPage";
import { DownloadLanguageModal, type DownloadLanguageOption } from "./components/DownloadLanguageModal";
import { DownloadEngineModal } from "./components/DownloadEngineModal";
import { ConfirmDeleteModal } from "./components/ConfirmDeleteModal";
import { ConfirmRemoveShowModal } from "./components/ConfirmRemoveShowModal";
import { WelcomeModal } from "./components/WelcomeModal";
import { fetchHomepageTextArtworkForShow, fetchTitleMetadataForShow, HOMEPAGE_ARTWORK_VERSION, importProviderItem, refreshArtworkForShow, searchRemotes } from "./lib/import-client";
import { preloadHeroImage } from "./lib/hero-assets";
import { getShowArtwork, mergeTitleMetadata, needsTitleMetadataEnrichment } from "./lib/media-library";
import {
  clearOfflineDownloads,
  dismissWelcome,
  findSelectedEpisode,
  hasDismissedWelcome,
  readLibraryState,
  selectEpisode,
  updateSelectedPlayer,
  updateEpisodePlaybackProgress,
  updateEpisodePlayerFailure,
  updateEpisodePlayerResolution,
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
  mergeLibraryStates,
  normalizeLibraryStateCandidate,
  updateShowCast,
  mergeImportedShowIntoState,
} from "./lib/storage";
import type { DownloadEngine, EpisodePlayer, ImportedShow, LibraryEpisode, LibraryState, PlayerAlias } from "./lib/types";
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
import { getCanonicalLanguageLabel, getCanonicalLanguageKey, getLanguagePresentation } from "./lib/language";
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
  getFullDownloadStatusFromNode,
  resolveUniversalPlayback,
  startBrowserResolvedDownload,
  startFullDownload,
  startFullDownloadOnNode,
  type FullDownloadJob,
  type PlaybackResolveResult,
} from "./lib/full-download-client";
import { downloadResolvedVideoInBrowser } from "./lib/browser-ffmpeg";
import { formatEpisodeTitle } from "./lib/episode-title";
import { scoreSearchCandidate } from "./lib/search-ranking";
import { prioritizeImportSearchResults, resolveImportInput } from "./lib/import-search";
import { buildRuntimeUrl } from "./lib/local-api";
import { probeLocalRuntime, type LocalRuntimeStatus } from "./lib/runtime-bridge";
import { resetLocalNodeProbeCache } from "./lib/local-api";
import { balancedBackgroundImage } from "./lib/image-resolution";
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
  IntegrationManifestV2,
  UserTasteProfile,
} from "./lib/types";
import {
  readCachedProviderModules,
  readEnabledProviderFeeds,
  readProviderRepositoryUrls,
  sanitizeEnabledProviderFeeds,
  toggleEnabledProviderFeed,
  writeCachedProviderModules,
  writeEnabledProviderFeeds,
  writeProviderRepositoryUrls,
} from "./lib/provider-feed-storage";
import { fetchIntegrationCatalog, fetchProviderFeed, fetchProviderModules, searchProviderModuleItems } from "./lib/provider-modules-client";
import {
  createProviderFeedViewId,
  isProviderFeedViewId,
  parseProviderFeedViewId,
} from "./lib/provider-modules-shared";
import { readPrivateNodeConnection, registerPrivateNodeDownload } from "./lib/private-node-client";
import { buildLibraryPath, buildLibraryShowPath, buildLibraryWatchPath, parseLibraryPath } from "./lib/library-routes";
import { scanProviderFeeds } from "./lib/library-watcher";

type ViewTransitionDocument = Document & {
  startViewTransition?: (callback: () => void) => { finished: Promise<void> };
};

function runRouteTransition(update: () => void) {
  const transitionDocument = document as ViewTransitionDocument;
  if (!transitionDocument.startViewTransition || window.matchMedia("(max-width: 1023px)").matches) {
    update();
    return;
  }
  transitionDocument.startViewTransition(() => {
    flushSync(update);
  });
}

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

function isRemoteResolvablePlayer(player: EpisodePlayer) {
  const provider = player.provider?.toLowerCase();
  return Boolean(player.embedUrl) && provider !== "local" && provider !== "spillsave";
}

function stablePlayerResolutionHash(player: EpisodePlayer) {
  const fingerprint = [
    player.provider,
    player.label,
    player.language,
    player.sourcePageUrl,
    player.embedUrl,
    player.subtitlesUrl,
  ].map((value) => String(value ?? "")).join("\u001f");

  let hash = 2166136261;
  for (let index = 0; index < fingerprint.length; index += 1) {
    hash ^= fingerprint.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `v3:${(hash >>> 0).toString(36)}`;
}

function playerNeedsStandbyResolve(player: EpisodePlayer) {
  if (!isRemoteResolvablePlayer(player)) return false;
  const currentHash = stablePlayerResolutionHash(player);
  if (player.resolutionHash !== currentHash) return true;
  return player.resolutionStatus !== "resolved" && player.resolutionStatus !== "failed";
}

function buildSinglePlayerEpisode(episode: LibraryEpisode, player: EpisodePlayer): LibraryEpisode {
  return {
    ...episode,
    players: [player],
    selectedPlayerAlias: player.alias,
  };
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
  platform?: IntegrationId;
  provider?: IntegrationId;
  posterUrl?: string | null;
  mediaType?: "movie" | "serial";
  year?: string | null;
};

function remoteResultPlatform(result: RemoteSearchResult): IntegrationId | null {
  return result.platform ?? result.provider ?? null;
}

function parseRemoteYear(value: string | number | null | undefined) {
  const match = String(value ?? "").match(/\b(19|20)\d{2}\b/);
  return match ? Number.parseInt(match[0], 10) : null;
}

function inferShowSearchMediaType(show: ImportedShow): "movie" | "serial" {
  return show.mediaType === "movie" || show.episodes.length <= 1 ? "movie" : "serial";
}

function remoteResultMatchesShow(show: ImportedShow, result: RemoteSearchResult) {
  const resultPlatform = remoteResultPlatform(result);
  if (!resultPlatform) {
    return false;
  }

  const showMediaType = inferShowSearchMediaType(show);
  if (result.mediaType && result.mediaType !== showMediaType) {
    return false;
  }

  if (resultPlatform === "vidking" && show.externalIds?.tmdb && result.slug.includes(show.externalIds.tmdb)) {
    return true;
  }

  const showYear = parseRemoteYear(show.metadata?.year ?? show.years ?? show.canonicalIdentity?.year);
  const resultYear = parseRemoteYear(result.year);
  if (showYear !== null && resultYear !== null && Math.abs(showYear - resultYear) > 1) {
    return false;
  }

  const titleKeys = new Set([
    show.title,
    show.altTitle,
    show.metadata?.title,
    show.metadata?.originalTitle,
    show.canonicalIdentity?.canonicalTitle,
    show.canonicalIdentity?.originalTitle,
  ].map((value) => normalizeLooseText(String(value ?? ""))).filter(Boolean));

  return titleKeys.has(normalizeLooseText(result.title));
}

function filterImportSearchResults(results: RemoteSearchResult[], platformFilter: ImportPlatformFilter) {
  if (platformFilter === "all") {
    return results;
  }
  return results.filter((result) => remoteResultPlatform(result) === platformFilter);
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
    if (!merged.has(item.id)) {
      merged.set(item.id, item);
    }
  }
  return Array.from(merged.values());
}

function App() {
  const routePath = typeof window !== "undefined" ? window.location.pathname : "/";
  if (routePath === "/node/setup") {
    return <NodeSetupView />;
  }
  if (routePath === "/node/admin") {
    return <NodeAdminView />;
  }
  return <AppContent />;
}

function AppContent() {
  const HERO_ROTATION_MS = 7000;
  const initialProviderRepositoryUrls = readProviderRepositoryUrls();
  const cachedProviderModules = readCachedProviderModules();
  const initialProviderModules = initialProviderRepositoryUrls.length > 0 ? cachedProviderModules.modules : [];
  const [state, setState] = useState<LibraryState>(() => readLibraryState());
  const [importSlug, setImportSlug] = useState("");
  const [importing, setImporting] = useState(false);
  const [importMessage, setImportMessage] = useState<string | null>(null);
  const [importPlatformFilter, setImportPlatformFilter] = useState<ImportPlatformFilter>("all");
  const [activeShowSlug, setActiveShowSlug] = useState<string | null>(null);
  const [activeWatchEpisodeId, setActiveWatchEpisodeId] = useState<string | null>(null);
  const [playerAutoPlayToken, setPlayerAutoPlayToken] = useState<number | null>(null);
  const [activeView, setActiveView] = useState<ViewState>("home");
  const [routePath, setRoutePath] = useState(() => window.location.pathname);
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
  const playerReturnPathRef = useRef("/");
  const [downloadEngineChoice, setDownloadEngineChoice] = useState<{
    episode: LibraryEpisode;
    selectedAlias: PlayerAlias;
  } | null>(null);
  const [privateNodeConnection, setPrivateNodeConnection] = useState(() => readPrivateNodeConnection());
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
    platform: IntegrationId;
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
  const [providerModules, setProviderModules] = useState<ProviderModuleManifest[]>(() => initialProviderModules);
  const [integrationCatalog, setIntegrationCatalog] = useState<IntegrationManifestV2[]>([]);
  const [providerRepositoryUrls, setProviderRepositoryUrls] = useState<string[]>(() => initialProviderRepositoryUrls);
  const [enabledProviderFeeds, setEnabledProviderFeeds] = useState<EnabledProviderFeed[]>(() =>
    sanitizeEnabledProviderFeeds(readEnabledProviderFeeds(), initialProviderModules),
  );
  const [providerFeedStates, setProviderFeedStates] = useState<Record<string, ProviderFeedPageState>>({});
  const [newEpisodeCheckState, setNewEpisodeCheckState] = useState<{ checking: boolean; message: string | null; error: boolean }>({
    checking: false,
    message: null,
    error: false,
  });
  const stateRef = useRef(state);
  const downloadedLanguageMapRef = useRef(downloadedEpisodeLanguageById);
  const downloadQueueRef = useRef(downloadQueue);
  const lastKnownVaultSnapshotAtRef = useRef(0);
  const skipNextVaultWriteRef = useRef(false);
  const standbyResolverActiveRef = useRef(false);
  const playerPrefetchKeysRef = useRef(new Set<string>());
  const companionSourceImportsRef = useRef(new Set<string>());
  const metadataEnrichmentActiveRef = useRef(false);
  const metadataEnrichmentAttemptedRef = useRef(new Set<string>());
  const libraryWatcherActiveRef = useRef(false);
  const activeWatchEpisodeIdRef = useRef(activeWatchEpisodeId);
  const deferredExploreQuery = useDeferredValue(discoveryState.exploreQuery);

  function pushRoute(path: string) {
    window.history.pushState({}, "", path);
    setRoutePath(path);
  }

  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  useEffect(() => {
    if (!vaultSnapshotReady || metadataEnrichmentActiveRef.current) return;
    const candidates = state.shows.filter((show) =>
      needsTitleMetadataEnrichment(show) && !metadataEnrichmentAttemptedRef.current.has(show.slug),
    );
    if (candidates.length === 0) return;

    metadataEnrichmentActiveRef.current = true;
    for (const show of candidates) metadataEnrichmentAttemptedRef.current.add(show.slug);

    void (async () => {
      const enriched = new Map<string, Awaited<ReturnType<typeof fetchTitleMetadataForShow>>>();
      let cursor = 0;
      const worker = async () => {
        while (true) {
          const show = candidates[cursor++];
          if (!show) return;
          try {
            enriched.set(show.slug, await fetchTitleMetadataForShow(show));
          } catch {
            enriched.set(show.slug, null);
          }
        }
      };
      await Promise.all(Array.from({ length: Math.min(4, candidates.length) }, worker));

      const latestState = stateRef.current;
      let changed = false;
      const shows = latestState.shows.map((show) => {
        const metadata = enriched.get(show.slug);
        if (!metadata) return show;
        const nextShow = mergeTitleMetadata(show, metadata);
        changed ||= nextShow.metadata?.updatedAt !== show.metadata?.updatedAt;
        return nextShow;
      });
      if (changed) {
        const nextState = { ...latestState, shows };
        writeLibraryState(nextState);
        stateRef.current = nextState;
        setState(nextState);
      }
    })().finally(() => {
      metadataEnrichmentActiveRef.current = false;
    });
  }, [state.shows, vaultSnapshotReady]);

  useEffect(() => {
    activeWatchEpisodeIdRef.current = activeWatchEpisodeId;
  }, [activeWatchEpisodeId]);

  function prefetchEpisodePlayers(episodes: LibraryEpisode[], limit = 4) {
    const candidates = episodes.flatMap((episode) => {
      const selectedPlayer = episode.players.find((player) => player.alias === episode.selectedPlayerAlias);
      const orderedPlayers = [
        selectedPlayer,
        ...episode.players.filter((player) => player.alias !== selectedPlayer?.alias),
      ].filter((player): player is EpisodePlayer => Boolean(player));
      return orderedPlayers
        .filter((player) => playerNeedsStandbyResolve(player))
        .map((player) => ({ episode, player }));
    }).slice(0, limit);

    for (const { episode, player } of candidates) {
      const hash = stablePlayerResolutionHash(player);
      const key = `${episode.id}:${player.provider}:${player.embedUrl}:${hash}`;
      if (playerPrefetchKeysRef.current.has(key)) {
        continue;
      }
      playerPrefetchKeysRef.current.add(key);

      void (async () => {
        try {
          const latestEpisode = stateRef.current.shows
            .flatMap((show) => show.episodes)
            .find((entry) => entry.id === episode.id);
          const latestPlayer = latestEpisode?.players.find((entry) =>
            entry.alias === player.alias ||
            (entry.provider === player.provider && entry.embedUrl === player.embedUrl)
          );
          if (!latestEpisode || !latestPlayer || !playerNeedsStandbyResolve(latestPlayer)) {
            return;
          }

          const result = await resolveUniversalPlayback(buildSinglePlayerEpisode(latestEpisode, latestPlayer));
          if (result.streamType === "embed") {
            return;
          }
          const nextState = updateEpisodePlayerResolution(latestEpisode.id, latestPlayer, {
            resolvedUrl: result.resolvedUrl,
            refererUrl: result.refererUrl,
            streamType: result.streamType,
            subtitlesUrl: result.subtitlesUrl,
            resolutionHash: stablePlayerResolutionHash(latestPlayer),
          });
          setState(nextState);
        } catch (error) {
          const latestEpisode = stateRef.current.shows
            .flatMap((show) => show.episodes)
            .find((entry) => entry.id === episode.id);
          const latestPlayer = latestEpisode?.players.find((entry) =>
            entry.alias === player.alias ||
            (entry.provider === player.provider && entry.embedUrl === player.embedUrl)
          );
          if (!latestEpisode || !latestPlayer) {
            return;
          }
          const message = error instanceof Error ? error.message : String(error);
          const nextState = updateEpisodePlayerFailure(latestEpisode.id, latestPlayer, message, stablePlayerResolutionHash(latestPlayer));
          setState(nextState);
        }
      })();
    }
  }

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
    const refreshPrivateNodeConnection = () => setPrivateNodeConnection(readPrivateNodeConnection());
    window.addEventListener("storage", refreshPrivateNodeConnection);
    window.addEventListener("focus", refreshPrivateNodeConnection);
    return () => {
      window.removeEventListener("storage", refreshPrivateNodeConnection);
      window.removeEventListener("focus", refreshPrivateNodeConnection);
    };
  }, []);

  useEffect(() => {
    let canceled = false;

    const loadProviderModuleCatalog = async () => {
      try {
        const modules = await fetchProviderModules(providerRepositoryUrls);
        const integrations = await fetchIntegrationCatalog(providerRepositoryUrls);
        if (canceled) {
          return;
        }

        setProviderModules(modules);
        setIntegrationCatalog(integrations);
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
  }, [providerRepositoryUrls]);

  const performLibraryWatcherScan = async (modules: ProviderModuleManifest[]) => {
    if (libraryWatcherActiveRef.current) {
      return { skipped: true, checkedFeeds: 0, refreshedTitles: 0, changedTitles: [] as string[], failures: [] as string[] };
    }
    libraryWatcherActiveRef.current = true;
    try {
      const result = await scanProviderFeeds(
        stateRef.current,
        modules,
        stateRef.current.settings.artworkSources,
      );

      if (result.changedTitles.length > 0) {
        const nextState = mergeLibraryStates(stateRef.current, result.state);
        writeLibraryState(nextState);
        stateRef.current = nextState;
        setState(nextState);
      }

      if (result.feedResponses.length > 0) {
        setProviderFeedStates((current) => {
          const next = { ...current };
          for (const feedResponse of result.feedResponses) {
            const viewId = createProviderFeedViewId(feedResponse.moduleId, feedResponse.feedId);
            const page = next[viewId];
            if (!page) continue;
            next[viewId] = {
              ...page,
              feed: {
                ...feedResponse,
                items: mergeProviderFeedItems(feedResponse.items, page.feed?.items ?? []),
              },
              feedError: null,
            };
          }
          return next;
        });
      }

      return {
        skipped: false,
        checkedFeeds: result.checkedFeeds,
        refreshedTitles: result.refreshedTitles,
        changedTitles: result.changedTitles,
        failures: result.failures,
      };
    } finally {
      libraryWatcherActiveRef.current = false;
    }
  };

  const handleCheckNewEpisodes = async (forSlug?: string) => {
    setNewEpisodeCheckState({ checking: true, message: null, error: false });
    try {
      const result = await performLibraryWatcherScan(providerModules);
      if (result.skipped) {
        setNewEpisodeCheckState({ checking: false, message: "A check is already running.", error: false });
        return;
      }
      if (result.failures.length > 0 && result.checkedFeeds === 0) {
        setNewEpisodeCheckState({ checking: false, message: "Check failed — is your server running?", error: true });
        return;
      }
      if (forSlug && result.changedTitles.includes(forSlug)) {
        setNewEpisodeCheckState({ checking: false, message: "New episodes found for this show.", error: false });
        return;
      }
      if (forSlug) {
        setNewEpisodeCheckState({ checking: false, message: "No new episodes found for this show.", error: false });
        return;
      }
      const updated = result.changedTitles.length;
      if (updated > 0) {
        setNewEpisodeCheckState({ checking: false, message: `Updated ${updated} ${updated === 1 ? "title" : "titles"} with new episodes.`, error: false });
      } else if (result.refreshedTitles > 0) {
        setNewEpisodeCheckState({ checking: false, message: "Checked — no new episodes, your library is up to date.", error: false });
      } else {
        setNewEpisodeCheckState({ checking: false, message: "No new episodes found.", error: false });
      }
    } catch {
      setNewEpisodeCheckState({ checking: false, message: "Check failed.", error: true });
    }
  };

  const handleCheckShowNewEpisodes = async (show: ImportedShow) => {
    setNewEpisodeCheckState({ checking: true, message: null, error: false });
    try {
      let slug = show.providerMatches?.find((match) => match.integrationId === "svetserialu")?.providerItemId;
      if (!slug) {
        for (const episode of show.episodes) {
          const url = episode.episodeUrl && /svetserialu/i.test(episode.episodeUrl) ? episode.episodeUrl : episode.players.map((player) => player.sourcePageUrl).find((candidate) => /svetserialu/i.test(candidate));
          const pageMatch = url?.match(/\/serial\/([^/?#]+)/i);
          if (pageMatch?.[1]) {
            slug = decodeURIComponent(pageMatch[1]).trim().toLowerCase();
            break;
          }
        }
      }
      if (!slug) {
        const results = await searchRemotes(show.title);
        const hit = results.find((result) => result.platform === "svetserialu" && result.mediaType === "serial") ?? results.find((result) => result.platform === "svetserialu");
        slug = hit?.slug;
      }
      if (!slug) {
        setNewEpisodeCheckState({ checking: false, message: "Couldn't find this show on svetserialu.", error: true });
        return;
      }
      const existingCodes = new Set(
        show.episodes.map((episode) => episode.episodeCode?.trim().toLowerCase()).filter(Boolean),
      );
      const imported = await importProviderItem("svetserialu", slug, "serial", stateRef.current.settings.artworkSources);
      const newCodes = imported.episodes
        .map((episode) => episode.episodeCode?.trim().toLowerCase())
        .filter((code): code is string => Boolean(code) && !existingCodes.has(code!));
      const newCount = newCodes.length;

      if (newCount > 0) {
        const nextState = mergeLibraryStates(stateRef.current, mergeImportedShowIntoState(stateRef.current, imported, show.slug));
        writeLibraryState(nextState);
        stateRef.current = nextState;
        setState(nextState);
        setNewEpisodeCheckState({ checking: false, message: `Found ${newCount} new ${newCount === 1 ? "episode" : "episodes"} for this show.`, error: false });
      } else {
        setNewEpisodeCheckState({ checking: false, message: "No new episodes found for this show.", error: false });
      }
    } catch (error) {
      setNewEpisodeCheckState({ checking: false, message: `Check failed: ${error instanceof Error ? error.message : String(error)}`, error: true });
    }
  };

  useEffect(() => {
    if (providerModules.length === 0) return;
    let canceled = false;
    let timer: number | null = null;

    const poll = async () => {
      if (canceled) return;
      let retrySoon = false;
      try {
        const result = await performLibraryWatcherScan(providerModules);
        if (canceled) return;
        retrySoon = result.failures.length > 0 && result.checkedFeeds === 0;
      } catch {
        retrySoon = true;
      } finally {
        if (!canceled) {
          const delay = retrySoon
            ? 15_000
            : document.visibilityState === "visible"
              ? 2 * 60_000
              : 5 * 60_000;
          timer = window.setTimeout(() => void poll(), delay);
        }
      }
    };

    const runNow = () => {
      if (canceled || document.visibilityState === "hidden") return;
      if (timer !== null) window.clearTimeout(timer);
      timer = window.setTimeout(() => void poll(), 0);
    };

    runNow();
    window.addEventListener("focus", runNow);
    window.addEventListener("online", runNow);
    document.addEventListener("visibilitychange", runNow);
    return () => {
      canceled = true;
      if (timer !== null) window.clearTimeout(timer);
      window.removeEventListener("focus", runNow);
      window.removeEventListener("online", runNow);
      document.removeEventListener("visibilitychange", runNow);
    };
  }, [providerModules]);

  async function refreshVaultState() {
    const status = await getVaultStatus();
    setVaultStatus(status);
    setVaultDiagnostics(getVaultDiagnostics());
    return status;
  }

  function applyVaultSnapshot(snapshot: VaultSnapshot, preserveUiState: boolean, mergeLocalData = false) {
    const currentState = stateRef.current;
    const importedState = normalizeLibraryStateCandidate(snapshot.libraryState as Partial<LibraryState>);
    const restoredState = mergeLocalData ? mergeLibraryStates(currentState, importedState) : importedState;
    const nextState = {
      ...restoredState,
      query: preserveUiState ? currentState.query : restoredState.query,
      selectedEpisodeId: preserveUiState ? currentState.selectedEpisodeId : restoredState.selectedEpisodeId,
      settings: {
        ...restoredState.settings,
        connectedFolderName: vaultStatus.folderName ?? currentState.settings.connectedFolderName,
      },
    };

    writeLibraryState(nextState);
    stateRef.current = nextState;
    setState(nextState);

    const restoredLanguages = replaceDownloadedLanguageMap(mergeLocalData
      ? { ...(snapshot.downloadedLanguages ?? {}), ...readDownloadedLanguageMap() }
      : snapshot.downloadedLanguages ?? readDownloadedLanguageMap());
    setDownloadedEpisodeLanguageById(new Map(Object.entries(restoredLanguages)));

    const restoredQueue = replaceDownloadQueue(mergeLocalData
      ? { ...(snapshot.downloadQueue ?? {}), ...readDownloadQueue() }
      : snapshot.downloadQueue ?? readDownloadQueue());
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
        applyVaultSnapshot(snapshot, false, true);
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
        // The vault may have been updated by the provider watcher, another tab,
        // or a maintenance command since this render. Always reconcile the
        // latest disk snapshot before writing so a stale browser tab cannot
        // silently remove newly discovered seasons or episodes.
        const currentVaultSnapshot = await readVaultSnapshot();
        const stateToPersist = currentVaultSnapshot?.libraryState
          ? mergeLibraryStates(
              state,
              normalizeLibraryStateCandidate(currentVaultSnapshot.libraryState as Partial<LibraryState>),
            )
          : state;

        if (JSON.stringify(stateToPersist) !== JSON.stringify(state)) {
          writeLibraryState(stateToPersist);
          stateRef.current = stateToPersist;
          setState(stateToPersist);
        }

        const snapshotUpdatedAt = Date.now();
        lastKnownVaultSnapshotAtRef.current = Math.max(lastKnownVaultSnapshotAtRef.current, snapshotUpdatedAt);
        await writeVaultSnapshot({
          version: 1,
          updatedAt: snapshotUpdatedAt,
          libraryState: stateToPersist,
          downloadedLanguages: {
            ...(currentVaultSnapshot?.downloadedLanguages ?? {}),
            ...Object.fromEntries(downloadedLanguageMapRef.current),
          },
          downloadQueue: {
            ...(currentVaultSnapshot?.downloadQueue ?? {}),
            ...downloadQueueRef.current,
          },
        });
        setVaultDiagnostics(getVaultDiagnostics());
      })();
    }, 200);

    return () => window.clearTimeout(timeout);
  }, [downloadQueue, downloadedEpisodeLanguageById, state, vaultSnapshotReady, vaultStatus.connected, vaultStatus.folderName]);

  useEffect(() => {
    if (!vaultSnapshotReady) {
      return;
    }

    let canceled = false;

    const runStandbyResolvePass = async () => {
      if (canceled || standbyResolverActiveRef.current || activeWatchEpisodeIdRef.current) {
        return;
      }

      const candidates = stateRef.current.shows.flatMap((show) =>
        show.episodes.flatMap((episode) =>
          episode.players
            .filter(playerNeedsStandbyResolve)
            .map((player) => ({ episodeId: episode.id, playerAlias: player.alias, provider: player.provider, embedUrl: player.embedUrl })),
        ),
      ).slice(0, 20);

      if (candidates.length === 0) {
        return;
      }

      standbyResolverActiveRef.current = true;

      let cursor = 0;
      const concurrency = 1;

      async function worker() {
        while (!canceled && cursor < candidates.length) {
          const candidate = candidates[cursor];
          cursor += 1;

          const latestEpisode = stateRef.current.shows
            .flatMap((show) => show.episodes)
            .find((entry) => entry.id === candidate.episodeId);
          const latestPlayer = latestEpisode?.players.find((entry) =>
            entry.alias === candidate.playerAlias ||
            (entry.provider === candidate.provider && entry.embedUrl === candidate.embedUrl)
          );
          if (!latestEpisode || !latestPlayer || !playerNeedsStandbyResolve(latestPlayer)) {
            continue;
          }

          const hash = stablePlayerResolutionHash(latestPlayer);

          try {
            const result = await resolveUniversalPlayback(buildSinglePlayerEpisode(latestEpisode, latestPlayer));
            if (canceled || result.streamType === "embed") {
              continue;
            }
            const nextState = updateEpisodePlayerResolution(latestEpisode.id, latestPlayer, {
              resolvedUrl: result.resolvedUrl,
              refererUrl: result.refererUrl,
              streamType: result.streamType,
              subtitlesUrl: result.subtitlesUrl,
              resolutionHash: hash,
            });
            setState(nextState);
          } catch (error) {
            if (canceled) {
              continue;
            }
            const message = error instanceof Error ? error.message : String(error);
            const nextState = updateEpisodePlayerFailure(latestEpisode.id, latestPlayer, message, hash);
            setState(nextState);
          }
        }
      }

      try {
        await Promise.all(Array.from({ length: Math.min(concurrency, candidates.length) }, () => worker()));
      } finally {
        standbyResolverActiveRef.current = false;
      }
    };

    const timeout = window.setTimeout(() => {
      void runStandbyResolvePass();
    }, 4000);
    const interval = window.setInterval(() => {
      void runStandbyResolvePass();
    }, 90000);

    return () => {
      canceled = true;
      window.clearTimeout(timeout);
      window.clearInterval(interval);
      standbyResolverActiveRef.current = false;
    };
  }, [vaultSnapshotReady]);

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
    const urls = state.shows.flatMap((show) => {
      const artwork = getShowArtwork(show);
      return [artwork.backdropUrl, artwork.bannerUrl, artwork.clearLogoUrl];
    }).filter((value): value is string => Boolean(value));
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
    let timer: number | null = null;

    const probe = async () => {
      const status = await probeLocalRuntime();
      if (!canceled) {
        setLocalRuntimeStatus(status);
        timer = window.setTimeout(() => void probe(), status.available ? 60_000 : 30_000);
      }
    };

    const probeNow = () => {
      if (canceled) return;
      if (timer !== null) window.clearTimeout(timer);
      timer = window.setTimeout(() => void probe(), 0);
    };

    void probe();
    window.addEventListener("focus", probeNow);
    window.addEventListener("online", probeNow);
    document.addEventListener("visibilitychange", probeNow);

    return () => {
      canceled = true;
      if (timer !== null) window.clearTimeout(timer);
      window.removeEventListener("focus", probeNow);
      window.removeEventListener("online", probeNow);
      document.removeEventListener("visibilitychange", probeNow);
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
      setRoutePath(window.location.pathname);
      const parsed = parseLibraryPath(window.location.pathname);
      if (parsed.kind === "watch") {
        const episodeId = parsed.episodeId;
        setActiveShowSlug(null);
        setActiveWatchEpisodeId(episodeId);
        setState(selectEpisode(episodeId));
        return;
      }

      setActiveWatchEpisodeId(null);
      setActiveShowSlug(parsed.kind === "show" ? parsed.slug : null);
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

  const selectedEpisode = useMemo(() => {
    if (activeWatchEpisodeId) {
      return state.shows.flatMap((show) => show.episodes).find((episode) => episode.id === activeWatchEpisodeId) ?? null;
    }
    return findSelectedEpisode(state);
  }, [activeWatchEpisodeId, state]);
  const totalOfflineBytes = useMemo(
    () => Object.values(state.offlineDownloads).reduce((sum, entry) => sum + (entry.sizeBytes ?? 0), 0),
    [state.offlineDownloads],
  );
  const totalDownloadedEpisodeCount = useMemo(() => {
    const ids = new Set(Object.keys(state.offlineDownloads));
    for (const id of downloadedEpisodeIds) {
      ids.add(id);
    }
    return ids.size;
  }, [downloadedEpisodeIds, state.offlineDownloads]);
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
        const platform = remoteResultPlatform(item);
        if (platform) {
          acc[platform].push(item);
        }
        return acc;
      },
      {
        vidking: [] as typeof remoteResults,
        svetserialu: [] as typeof remoteResults,
        bombuj: [] as typeof remoteResults,
        cineby: [] as typeof remoteResults,
      },
    );
  }, [remoteResults]);
  const remotePlatformOrder = useMemo(() => {
    const baseOrder: IntegrationId[] = ["vidking", "svetserialu", "bombuj"];
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
      if (item.provider === "vidking") {
        const match = item.importSlug.match(/^(movie|tv)\/(\d+)/i);
        return match ? show.slug === `vidking-${match[1].toLowerCase()}-${match[2]}` : show.slug === item.importSlug;
      }
      if (item.provider === "bombuj") {
        return show.slug === `bombuj-${item.importSlug}`;
      }
      if (item.provider === "cineby") {
        const match = item.importSlug.match(/^(movie|tv)\/(\d+)/i);
        return match ? show.slug === `cineby-${match[1].toLowerCase()}-${match[2]}` : show.slug === item.importSlug;
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
      fresh: true,
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
      if (!cursor) {
        setExploreFeed(null);
        setExploreCursor(null);
      }
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
    const shouldUseLocalPlayer = downloadedEpisodeIds.has(episode.id) || episode.selectedPlayerAlias === "local-file";
    if (!shouldUseLocalPlayer) {
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

  const selectedEpisodeShow = useMemo(() => {
    if (!selectedEpisode) {
      return null;
    }
    return state.shows.find((show) => show.episodes.some((episode) => episode.id === selectedEpisode.id)) ?? null;
  }, [selectedEpisode, state.shows]);

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

  useEffect(() => {
    if (!activeShowWithLocal || activeWatchEpisodeId) {
      return;
    }

    const preferredEpisodes = [
      activeShowWithLocal.episodes.find((episode) => episode.id === state.selectedEpisodeId),
      ...activeShowWithLocal.episodes,
    ].filter((episode): episode is LibraryEpisode => Boolean(episode));
    const uniqueEpisodes = Array.from(new Map(preferredEpisodes.map((episode) => [episode.id, episode])).values());
    const timeout = window.setTimeout(() => {
      prefetchEpisodePlayers(uniqueEpisodes, 2);
    }, 800);

    return () => window.clearTimeout(timeout);
  }, [activeShowWithLocal, activeWatchEpisodeId, state.selectedEpisodeId]);

  async function discoverCompanionSources(show: ImportedShow) {
    const showKey = show.externalIds?.tmdb ? `tmdb:${show.externalIds.tmdb}` : `slug:${show.slug}`;
    const terms = Array.from(new Set([show.title, show.altTitle, show.metadata?.title, show.metadata?.originalTitle].filter((value): value is string => Boolean(value?.trim()))));
    if (terms.length === 0) {
      return;
    }

    const importMatches = async (term: string) => {
      const results = await searchRemotes(term);
      for (const result of results) {
        const platform = remoteResultPlatform(result);
        if (!platform || !remoteResultMatchesShow(show, result)) {
          continue;
        }
        const sourceKey = `${showKey}:${platform}:${result.slug}`;
        if (companionSourceImportsRef.current.has(sourceKey)) {
          continue;
        }
        companionSourceImportsRef.current.add(sourceKey);
        try {
          const importedShow = await importProviderItem(platform, result.slug, result.mediaType, stateRef.current.settings.artworkSources);
          const nextState = upsertImportedShow(importedShow);
          setState(nextState);
          setTasteProfile(recordImportedShowSignal(importedShow));
        } catch (error) {
          console.warn("Companion source import failed:", error instanceof Error ? error.message : String(error));
        }
      }
    };

    for (const term of terms.slice(0, 3)) {
      await importMatches(term);
    }
  }

  async function handleImport(
    platform: IntegrationId,
    overrideSlug?: string,
    mediaType?: "movie" | "serial",
    options: { discoverCompanions?: boolean } = {},
  ) {
    const slug = (overrideSlug ?? importSlug).trim().toLowerCase();
    if (!slug) {
      setImportMessage("Enter a show slug, for example `upload` or `see`.");
      return;
    }

    setImporting(true);
    setImportMessage(null);

    try {
      const show = await importProviderItem(platform, slug, mediaType, state.settings.artworkSources);

      const nextState = upsertImportedShow(show);
      setState(nextState);
      setTasteProfile(recordImportedShowSignal(show));
      setImportSlug("");
      setImportMessage(
        `${show.title}: imported ${show.episodes.length} episode entries across ${show.availableSeasons.length} season(s).`,
      );
      if (options.discoverCompanions !== false) {
        void discoverCompanionSources(show);
      }
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
      const filteredResults = filterImportSearchResults(results, importPlatformFilter);
      const prioritizedResults = prioritizeImportSearchResults(filteredResults);

      setImportSearchResults(prioritizedResults);
      if (filteredResults.length === 0) {
        setImportMessage(
          results.length === 0
            ? "No external titles found."
            : "No matches found for the selected platform.",
        );
      }
    } catch (error) {
      setImportSearchResults([]);
      setImportMessage(error instanceof Error ? error.message : "Search failed.");
    } finally {
      setIsSearchingImport(false);
    }
  }

  async function handleImportSearchPick(result: RemoteSearchResult) {
    const platform = remoteResultPlatform(result);
    if (!platform) {
      setImportMessage("This search result is missing a provider.");
      return;
    }
    setImportSlug(result.slug);
    setImportSearchResults([]);
    await handleImport(platform, result.slug, result.mediaType);
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
        fresh: true,
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

  async function handleChangeProviderRepositories(urls: string[]) {
    writeProviderRepositoryUrls(urls);
    setProviderRepositoryUrls(urls);
    try {
      const modules = await fetchProviderModules(urls);
      setProviderModules(modules);
      writeCachedProviderModules(modules);
      setEnabledProviderFeeds((current) => {
        const next = sanitizeEnabledProviderFeeds(current, modules);
        writeEnabledProviderFeeds(next);
        return next;
      });
    } catch {
      // Keep the current catalog if a repository is temporarily unavailable.
    }
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
    const watchPath = buildLibraryWatchPath(episode.id);
    const applySelection = () => {
      setPlayerAutoPlayToken(Date.now());
      const nextState = selectEpisode(episode.id);
      setState(nextState);
      playerReturnPathRef.current = window.location.pathname === watchPath
        ? buildLibraryShowPath(episode.showSlug)
        : `${window.location.pathname}${window.location.search}${window.location.hash}`;
      pushRoute(watchPath);
      setActiveWatchEpisodeId(episode.id);
      setActiveShowSlug(null);
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
    };
    if (window.location.pathname !== watchPath) {
      runRouteTransition(applySelection);
    } else {
      applySelection();
    }
  }

  function handleOpenShow(slug: string) {
    const nextPath = buildLibraryShowPath(slug);
    const openShow = () => {
      pushRoute(nextPath);
      setActiveWatchEpisodeId(null);
      setActiveShowSlug(slug);
      const show = state.shows.find((entry) => entry.slug === slug);
      if (show) {
        setTasteProfile(recordShowOpenSignal(show));
      }
    };
    if (window.location.pathname !== nextPath) {
      runRouteTransition(openShow);
    } else {
      openShow();
    }
  }

  function handleCloseShow() {
    runRouteTransition(() => {
      pushRoute(buildLibraryPath());
      setActiveShowSlug(null);
    });
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
    runRouteTransition(() => {
      const nextState = selectEpisode(undefined);
      setState(nextState);
      setActiveWatchEpisodeId(null);
      const returnPath = playerReturnPathRef.current || buildLibraryPath();
      pushRoute(returnPath.startsWith(`${buildLibraryPath()}/watch/`) ? buildLibraryPath() : returnPath);
      const parsed = parseLibraryPath(window.location.pathname);
      setActiveShowSlug(parsed.kind === "show" ? parsed.slug : null);
    });
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
    const byLanguage = new Map<string, { language: string; players: typeof remotePlayers }>();
    for (const player of remotePlayers) {
      const key = getCanonicalLanguageKey(player.language);
      const group = byLanguage.get(key) ?? { language: getCanonicalLanguageLabel(player.language), players: [] };
      group.players.push(player);
      byLanguage.set(key, group);
    }

    return Array.from(byLanguage.values()).map(({ language, players }) => {
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

  async function startPrivateNodeDownloadForEpisode(episode: LibraryEpisode, selectedAlias?: PlayerAlias) {
    const connection = readPrivateNodeConnection();
    setPrivateNodeConnection(connection);
    if (!connection.nodeUrl || !connection.token || !connection.profileId) {
      window.alert("Sign in to a private node watcher profile before downloading to the private server.");
      return;
    }

    const episodeForDownload =
      selectedAlias && selectedAlias !== episode.selectedPlayerAlias
        ? { ...episode, selectedPlayerAlias: selectedAlias }
        : episode;

    if (selectedAlias && selectedAlias !== episode.selectedPlayerAlias) {
      const nextState = updateSelectedPlayer(episode.id, selectedAlias);
      setState(nextState);
    }

    const existing = downloadQueue[episode.id];
    if (existing && (existing.state === "queued" || existing.state === "resolving" || existing.state === "downloading")) {
      return;
    }

    try {
      const job = await startFullDownloadOnNode(connection.nodeUrl, episodeForDownload);
      const selectedPlayer = episodeForDownload.players.find((player) => player.alias === episodeForDownload.selectedPlayerAlias) ?? episodeForDownload.players[0];
      const queueItem: PersistentDownloadJob = {
        episodeId: episode.id,
        jobId: `private-node:${connection.nodeUrl}:${job.id}`,
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
        message: `Private node: ${job.message}`,
        outputPath: job.outputPath,
        error: job.error,
        updatedAt: Date.now(),
      };
      setDownloadQueue((prev) => ({ ...prev, [episode.id]: queueItem }));
      await pollPrivateNodeDownload(episodeForDownload, connection, job.id);
    } catch (error) {
      window.alert(error instanceof Error ? error.message : "Failed to start private node download.");
    }
  }

  async function pollPrivateNodeDownload(episode: LibraryEpisode, connection: ReturnType<typeof readPrivateNodeConnection>, jobId: string) {
    for (;;) {
      const job = await getFullDownloadStatusFromNode(connection.nodeUrl, jobId);
      await persistDownloadJobUpdate(episode.id, {
        jobId: `private-node:${connection.nodeUrl}:${job.id}`,
        state: job.state,
        percent: job.percent,
        message: `Private node: ${job.message}`,
        outputPath: job.outputPath,
        error: job.error,
      });

      if (job.state === "completed") {
        if (job.outputPath && connection.token && connection.profileId) {
          const fileName = job.outputPath.split(/[\\/]/).pop() || `${episode.showTitle}.mp4`;
          await registerPrivateNodeDownload({
            nodeUrl: connection.nodeUrl,
            token: connection.token,
            profileId: connection.profileId,
            downloadId: job.id,
            episodeId: episode.id,
            contentId: episode.showSlug,
            fileName,
            filePath: job.outputPath,
            sizeBytes: 0,
          }).catch(() => undefined);
        }
        setDownloadQueue((prev) => removeDownloadQueueItem(prev, episode.id));
        return;
      }

      if (job.state === "failed") {
        return;
      }

      await new Promise((resolve) => window.setTimeout(resolve, 1500));
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

  async function handleSelectDownloadEngine(engine: DownloadEngine, target: "local-vault" | "private-node" = "local-vault") {
    if (!downloadEngineChoice) {
      return;
    }

    const { episode, selectedAlias } = downloadEngineChoice;
    setDownloadEngineChoice(null);

    if (target === "private-node") {
      await startPrivateNodeDownloadForEpisode(episode, selectedAlias);
      return;
    }

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
              backdropUrl: artwork.bannerUrl ?? artwork.backdropUrl ?? show.backdropUrl ?? null,
              bannerUrl: artwork.bannerUrl ?? artwork.backdropUrl ?? show.bannerUrl ?? null,
              clearLogoUrl: artwork.clearLogoUrl ?? show.clearLogoUrl ?? null,
              artwork: {
                ...(show.artwork ?? {}),
                posterUrl: artwork.posterUrl ?? show.artwork?.posterUrl ?? show.posterUrl ?? null,
                backdropUrl: artwork.bannerUrl ?? artwork.backdropUrl ?? show.artwork?.backdropUrl ?? show.backdropUrl ?? null,
                bannerUrl: artwork.bannerUrl ?? artwork.backdropUrl ?? show.artwork?.bannerUrl ?? show.bannerUrl ?? null,
                clearLogoUrl: artwork.clearLogoUrl ?? show.artwork?.clearLogoUrl ?? show.clearLogoUrl ?? null,
                bannerWithLogoUrl: artwork.bannerWithLogoUrl ?? show.artwork?.bannerWithLogoUrl ?? show.homepageBannerUrl ?? null,
              },
            };

            if (
              nextShow.posterUrl !== show.posterUrl ||
              nextShow.backdropUrl !== show.backdropUrl ||
              nextShow.bannerUrl !== show.bannerUrl ||
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
      bannerUrl?: string | null;
      bannerWithLogoUrl?: string | null;
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
              bannerUrl: artwork.bannerUrl ?? show.bannerUrl ?? null,
              homepageBannerUrl: artwork.bannerWithLogoUrl ?? show.homepageBannerUrl ?? null,
              homepageArtworkVersion: artwork.bannerWithLogoUrl ? HOMEPAGE_ARTWORK_VERSION : show.homepageArtworkVersion,
              clearLogoUrl: artwork.clearLogoUrl ?? null,
              artwork: {
                ...(show.artwork ?? {}),
                posterUrl: artwork.posterUrl ?? null,
                backdropUrl: artwork.backdropUrl ?? null,
                bannerUrl: artwork.bannerUrl ?? show.bannerUrl ?? null,
                bannerWithLogoUrl: artwork.bannerWithLogoUrl ?? show.artwork?.bannerWithLogoUrl ?? show.homepageBannerUrl ?? null,
                clearLogoUrl: artwork.clearLogoUrl ?? null,
              },
            }
          : show,
      ),
    };
    writeLibraryState(nextState);
    setState(nextState);
  }

  const handleUpdateShowCast = useCallback((slug: string, actors: ImportedShow["actors"] = []) => {
    const nextState = updateShowCast(slug, actors);
    stateRef.current = nextState;
    setState(nextState);
  }, []);

  async function handleEnsureHomepageTextArtwork(slug: string) {
    const show = state.shows.find((entry) => entry.slug === slug);
    if (!show || show.homepageArtworkVersion === HOMEPAGE_ARTWORK_VERSION) {
      return;
    }

    const artwork = await fetchHomepageTextArtworkForShow(show, state.settings.artworkSources).catch(() => null);

    setState((current) => {
      const currentShow = current.shows.find((entry) => entry.slug === slug);
      if (!currentShow || currentShow.homepageArtworkVersion === HOMEPAGE_ARTWORK_VERSION) {
        return current;
      }

      // The import already has usable artwork in many cases.  Homepage
      // enrichment also returns a poster while it searches for a baked-logo
      // banner, so never let that background request replace the banner with
      // a poster (or clear an existing WLogo banner) just because no new
      // banner was found.
      if (!artwork?.bannerUrl) {
        return current;
      }

      const nextState = {
        ...current,
        shows: current.shows.map((entry) =>
          entry.slug === slug
            ? {
                ...entry,
                homepagePosterUrl: artwork?.posterUrl ?? entry.homepagePosterUrl ?? null,
                homepageBannerUrl: artwork.bannerUrl,
                artwork: {
                  ...(entry.artwork ?? {}),
                  posterUrl: artwork?.posterUrl ?? entry.artwork?.posterUrl ?? entry.posterUrl ?? null,
                  bannerWithLogoUrl: artwork.bannerUrl,
                },
                homepageArtworkVersion: HOMEPAGE_ARTWORK_VERSION,
              }
            : entry,
        ),
      };
      writeLibraryState(nextState);
      return nextState;
    });
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

  function handleResolvePlayer(episodeId: string, player: EpisodePlayer, playback: PlaybackResolveResult) {
    const nextState = updateEpisodePlayerResolution(episodeId, player, {
      resolvedUrl: playback.resolvedUrl,
      refererUrl: playback.refererUrl,
      streamType: playback.streamType,
      subtitlesUrl: playback.subtitlesUrl,
      resolutionHash: stablePlayerResolutionHash(player),
    });
    setState(nextState);
  }

  function handlePlayerResolveFailure(episodeId: string, player: EpisodePlayer, error: string) {
    const nextState = updateEpisodePlayerFailure(episodeId, player, error, stablePlayerResolutionHash(player));
    setState(nextState);
  }

  function handlePlaybackProgress(episodeId: string, progress: { currentTime: number; duration: number }) {
    const nextState = updateEpisodePlaybackProgress(episodeId, progress);
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
  const isPlayerPage = Boolean(activeWatchEpisodeId && selectedEpisodeWithLocal);
  const isImmersivePage = Boolean(isPlayerPage || activeShowSlug);
  const showHeader = !isImmersivePage;
  const currentRoute = parseLibraryPath(routePath);
  const isHomeRoute = currentRoute.kind === "home";

  if (isHomeRoute) {
    return (
      <CinematicHomePage
        state={state}
        featuredShow={featuredShow}
        downloadedCountByShow={downloadedCountByShow}
        tasteProfile={tasteProfile}
        searchRemotes={searchRemotes}
        onOpenLibrary={() => {
          pushRoute(buildLibraryPath());
          setActiveView("home");
          setActiveShowSlug(null);
          setActiveWatchEpisodeId(null);
        }}
        onOpenFavorites={() => {
          setActiveView("favorites");
          pushRoute(buildLibraryPath());
          setActiveShowSlug(null);
          setActiveWatchEpisodeId(null);
        }}
        onOpenExplore={() => {
          setActiveView("explore");
          pushRoute(buildLibraryPath());
          setActiveShowSlug(null);
          setActiveWatchEpisodeId(null);
        }}
        onOpenSettings={() => {
          setActiveView("settings");
          pushRoute(buildLibraryPath());
          setActiveShowSlug(null);
          setActiveWatchEpisodeId(null);
        }}
        onOpenShow={handleOpenShow}
        onPlayShow={(show) => {
          const episode = show.episodes[show.episodes.length - 1];
          if (episode) {
            handleSelectEpisode(episode);
          } else {
            handleOpenShow(show.slug);
          }
        }}
        onImportRemote={async (platform, slug, mediaType) => {
          await handleImport(platform, slug, mediaType);
        }}
        onEnsureHomepageTextArtwork={(slug) => {
          void handleEnsureHomepageTextArtwork(slug);
        }}
      />
    );
  }

  return (
    <div className="flex min-h-screen overflow-x-hidden bg-[#05060a] text-white selection:bg-white/20 selection:text-white lg:h-screen lg:overflow-hidden">
      {!isImmersivePage ? (
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
          onOpenHomepage={() => {
            pushRoute("/");
            setActiveView("home");
            setActiveShowSlug(null);
          }}
        />
      ) : null}

      <div className={clsx(
        "flex min-h-screen min-w-0 flex-1 flex-col",
        isImmersivePage ? "pb-0 pl-0 lg:min-h-0" : "pb-28 pl-0 lg:min-h-0 lg:pb-0 lg:pl-64",
      )}>
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
          {isPlayerPage ? (
            <PlayerModal
              episode={selectedEpisodeWithLocal}
              show={selectedEpisodeShow}
              onClose={handleClosePlayer}
              onSelectPlayer={handleSelectPlayer}
              onSelectEpisode={handleSelectEpisode}
              onResolvePlayer={handleResolvePlayer}
              onResolvePlayerFailure={handlePlayerResolveFailure}
              onPlaybackProgress={handlePlaybackProgress}
              autoPlayToken={playerAutoPlayToken}
            />
          ) : activeShowSlug ? (
            <ShowDetail
              show={activeShowWithLocal}
              relatedShows={state.shows.filter((entry) => entry.slug !== activeShowSlug).slice(0, 8)}
              libraryState={state}
              tasteProfile={tasteProfile}
              onBack={handleCloseShow}
              onOpenRelatedShow={handleOpenShow}
              onSelectEpisode={handleSelectEpisode}
              onRemoveShow={() => handleRemoveShow(activeShowSlug)}
              onToggleFavorite={() => handleToggleFavorite(activeShowSlug)}
              onUpdateArtwork={(artwork) => handleUpdateShowArtwork(activeShowSlug, artwork)}
              onUpdateCast={(actors) => handleUpdateShowCast(activeShowSlug, actors)}
              artworkSources={state.settings.artworkSources}
              fullDownloadJobsByEpisode={fullDownloadJobsByEpisode}
              onStartFullDownload={handleStartFullDownload}
              onCancelFullDownload={handleCancelFullDownload}
              downloadedEpisodeIds={downloadedEpisodeIds}
              onDeleteFullDownload={handleDeleteFullDownload}
              onCheckNewEpisodes={activeShowWithLocal ? () => void handleCheckShowNewEpisodes(activeShowWithLocal) : undefined}
              checkNewEpisodesState={newEpisodeCheckState}
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
              platformFilter={importPlatformFilter}
              onPlatformFilterChange={(value) => {
                setImportPlatformFilter(value);
                setImportSearchResults([]);
                if (importMessage?.toLowerCase().includes("no matches") || importMessage?.toLowerCase().includes("no external")) {
                  setImportMessage(null);
                }
              }}
              onSubmit={handleImportSubmit}
              importing={importing}
              importMessage={importMessage}
              isSearching={isSearchingImport}
              searchResults={importSearchResults
                .map((result) => ({ ...result, platform: remoteResultPlatform(result) }))
                .filter((result): result is RemoteSearchResult & { platform: IntegrationId } => Boolean(result.platform))}
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
              offlineEpisodeCount={totalDownloadedEpisodeCount}
              onClearOffline={handleClearOffline}
              onRefreshArtwork={handleRefreshArtwork}
              artworkRefreshBusy={artworkRefreshBusy}
              artworkRefreshSummary={artworkRefreshSummary}
              onExportLibrary={handleExportLibrary}
              onImportLibrary={handleImportLibrary}
              localRuntimeStatus={localRuntimeStatus}
              onRefreshLocalRuntime={() => {
                resetLocalNodeProbeCache();
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
              integrationCatalog={integrationCatalog}
              providerRepositoryUrls={providerRepositoryUrls}
              onToggleProviderFeed={handleToggleProviderFeed}
              onProviderRepositoriesChange={(urls) => {
                void handleChangeProviderRepositories(urls);
              }}
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
                <div className="hidden lg:block">
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
                </div>
              )}

              <div className="px-4 pb-16 sm:px-6 lg:mt-2 lg:px-10">
                <div className="mb-5 flex items-end justify-between gap-3 border-b border-white/[0.07] pb-4 lg:mb-7 lg:pb-5">
                  <div>
                    <div className="mb-1.5 hidden text-[10px] font-black uppercase tracking-[0.3em] text-white/28 lg:block">Your collection</div>
                    <h2 className="text-xl font-black tracking-[-0.035em] text-white capitalize sm:text-3xl">
                    {state.query ? "Local Vault" : activeView === "favorites" ? "Favorites" : "All Library"}
                    </h2>
                  </div>
                  <div className="flex shrink-0 items-center gap-3">
                    {!state.query && (activeView === "home" || activeView === "favorites") ? (
                      <button
                        type="button"
                        onClick={() => void handleCheckNewEpisodes()}
                        disabled={newEpisodeCheckState.checking}
                        className={clsx(
                          "inline-flex items-center gap-2 rounded-full border px-3.5 py-2 text-xs font-bold uppercase tracking-wide transition",
                          newEpisodeCheckState.checking
                            ? "cursor-not-allowed border-white/10 bg-white/[0.03] text-white/35"
                            : "border-white/15 bg-white/[0.05] text-white/80 hover:border-white/30 hover:bg-white/10 hover:text-white",
                        )}
                        aria-label="Check for new episodes"
                        title="Scan svetserialu for episodes you don't have yet"
                      >
                        <RefreshCw className={clsx("h-3.5 w-3.5", newEpisodeCheckState.checking && "animate-spin")} />
                        {newEpisodeCheckState.checking ? "Checking…" : "Check for new episodes"}
                      </button>
                    ) : null}
                    <div className="text-xs font-semibold text-white/32">{filteredShows.length} {filteredShows.length === 1 ? "title" : "titles"}</div>
                  </div>
                </div>

                {newEpisodeCheckState.message ? (
                  <div className={clsx("-mt-4 mb-5 text-xs font-semibold lg:-mt-5 lg:mb-6", newEpisodeCheckState.error ? "text-red-300" : "text-emerald-300")}>
                    {newEpisodeCheckState.message}
                  </div>
                ) : null}

                <div
                  className="animate-fade-in grid grid-cols-3 gap-2.5 opacity-0 sm:grid-cols-[repeat(auto-fit,minmax(168px,1fr))] sm:gap-5 xl:grid-cols-[repeat(auto-fit,minmax(182px,1fr))]"
                  style={{ animationDelay: "0.2s" }}
                >
                  {filteredShows.map((show: ImportedShow) => (
                    <ShowCard key={show.slug} show={show} onOpen={handleOpenShow} />
                  ))}
                  
                  {filteredShows.length === 0 && !state.query && (
                    <div className="col-span-full flex flex-col items-center justify-center rounded-[1.5rem] border border-dashed border-white/10 bg-white/[0.018] px-6 py-24 text-center">
                      <span className="text-white/20 mb-2">🎬</span>
                      <span className="text-sm font-semibold text-white/42">
                         {activeView === "favorites" ? "You haven't liked any titles yet." : "No shows found."}
                      </span>
                      <span className="mt-2 text-xs text-white/25">Your saved movies and series will appear here.</span>
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
                          const sectionLabel =
                            platformKey === "vidking" ? "VidKing" : platformKey === "svetserialu" ? "Svetserialu" : platformKey === "bombuj" ? "Bombuj" : "Unknown";
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
                                  const platform = remoteResultPlatform(r);
                                  const platformLabel =
                                    platform === "vidking" ? "VidKing" : platform === "svetserialu" ? "Svetserialu." : platform === "bombuj" ? "Bombuj" : "Unknown";
                                  const typeLabel =
                                    r.mediaType === "movie" ? "Movie" : r.mediaType === "serial" ? "Serial" : "Title";
                                  return (
                                    <div
                                      key={`${platform ?? "unknown"}-${r.slug}`}
                                      className="group relative w-40 shrink-0 overflow-hidden rounded-xl border border-white/10 bg-[#14151b] shadow-[0_8px_20px_rgba(0,0,0,0.35)]"
                                    >
                                      <div
                                        className="relative aspect-[2/3] w-full bg-[#0f1016] bg-cover bg-center"
                                        style={balancedBackgroundImage(r.posterUrl, "poster-card")}
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
                                                if (!platform) return;
                                                setImportSlug(r.slug);
                                                handleImport(platform, r.slug, r.mediaType);
                                              }}
                                              disabled={importing || !platform}
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

      {activeShowSlug && !isPlayerPage ? (
        <MobileDock
          active={(activeView === "favorites" || activeView === "explore" ? activeView : "library") as MobileDockItem}
          onHome={() => {
            pushRoute("/");
            setActiveView("home");
            setActiveShowSlug(null);
          }}
          onLibrary={() => {
            setActiveView("home");
            handleCloseShow();
          }}
          onFavorites={() => {
            setActiveView("favorites");
            handleCloseShow();
          }}
          onExplore={() => {
            setActiveView("explore");
            handleCloseShow();
          }}
        />
      ) : null}

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
        privateNodeAvailable={Boolean(privateNodeConnection.nodeUrl && privateNodeConnection.token && privateNodeConnection.profileId)}
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
