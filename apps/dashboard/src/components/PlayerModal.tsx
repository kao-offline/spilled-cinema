import { ArrowLeft, ChevronDown, List, LoaderCircle, RotateCw, Settings } from "lucide-react";
import { clsx } from "clsx";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { EpisodePlayer, ImportedShow, LibraryEpisode, PlayerAlias, PlayerSource } from "../lib/types";
import { getCanonicalLanguageKey, getCanonicalLanguageLabel, getLanguagePresentation } from "../lib/language";
import { formatEpisodeTitle } from "../lib/episode-title";
import { buildRuntimeUrl } from "../lib/local-api";
import { resolveUniversalPlayback, type PlaybackResolveFailure, type PlaybackResolveResult } from "../lib/full-download-client";
import { getLibraryVaultFileObjectUrl } from "../lib/library-folder";
import { readCachedPlayerFailure, readCachedPlayerUrl, removeCachedPlayerFailure, removeCachedPlayerUrl, writeCachedPlayerFailure, writeCachedPlayerUrl } from "../lib/player-url-cache";
import { balancedBackgroundImage } from "../lib/image-resolution";
import { prewarmPlaybackUrl } from "../lib/playback-prewarm";
import { UniversalVideoPlayer } from "./UniversalVideoPlayer";
import { resolveTitleItem, searchTitleItems } from "../lib/provider-modules-client";
import { getShowArtwork, getShowMetadata, getTitleDescription, getTitleMetadataParts } from "../lib/media-library";

type PlayerModalProps = {
  episode: LibraryEpisode | null;
  show?: ImportedShow | null;
  onClose: () => void;
  onSelectPlayer: (episodeId: string, alias: PlayerAlias) => void;
  onSelectEpisode?: (episode: LibraryEpisode) => void;
  onResolvePlayer?: (episodeId: string, player: EpisodePlayer, playback: PlaybackResolveResult) => void;
  onResolvePlayerFailure?: (episodeId: string, player: EpisodePlayer, error: string) => void;
  onPlaybackProgress?: (episodeId: string, progress: { currentTime: number; duration: number }) => void;
  autoPlayToken?: number | null;
};

type PlayerResolutionStatus = {
  status: "unresolved" | "resolving" | "resolved" | "failed";
  error?: string;
  playback?: PlaybackResolveResult;
};

const ENABLE_PLAYER_BACKGROUND_DISCOVERY = true;

function episodeShortLabel(episode: LibraryEpisode | null) {
  if (!episode) return "Episode";
  if (episode.episodeCode) return episode.episodeCode.toUpperCase();
  if (episode.episodeNumber != null) return `S${episode.seasonNumber}E${String(episode.episodeNumber).padStart(2, "0")}`;
  return `S${episode.seasonNumber}`;
}

function playbackCacheKey(player: EpisodePlayer) {
  return `${player.provider}|${player.embedUrl}`;
}

function buildPlaybackProxyUrl(player: EpisodePlayer, episodeId: string, resolvedUrl: string) {
  const streamType = inferStreamType(resolvedUrl);
  if (streamType === "unknown" || streamType === "embed") return null;
  const params = new URLSearchParams({
    url: resolvedUrl,
    name: `${episodeId}.${streamType === "mp4" ? "mp4" : "m3u8"}`,
    referer: player.streamRefererUrl ?? player.sourcePageUrl ?? player.embedUrl,
    playback: "1",
  });
  return buildRuntimeUrl(`/api/download-full/browser-file?${params.toString()}`);
}

function parsePlaybackProxyUrl(value: string) {
  try {
    const parsed = new URL(value, window.location.origin);
    if (parsed.pathname !== "/api/download-full/browser-file") {
      return null;
    }
    const streamUrl = parsed.searchParams.get("url");
    if (!streamUrl) {
      return null;
    }
    return {
      streamUrl,
      refererUrl: parsed.searchParams.get("referer") ?? "",
    };
  } catch {
    return null;
  }
}

function inferStreamType(value: string): "hls" | "mp4" | "dash" | "embed" | "unknown" {
  if (/\/api\/download-full\/browser-file\?/i.test(value)) {
    try {
      const parsed = new URL(value, window.location.origin);
      const proxiedUrl = parsed.searchParams.get("url") ?? "";
      const name = parsed.searchParams.get("name") ?? "";
      if (/\.mp4(?:$|[?#])|\/get_video\?/i.test(proxiedUrl) || /\.mp4$/i.test(name)) return "mp4";
      if (/\.m3u8(?:$|[?#])|\/hls3\//i.test(proxiedUrl) || /\.m3u8$/i.test(name)) return "hls";
    } catch {
      return "unknown";
    }
  }
  if (/\.m3u8(?:$|[?#])|\/hls3\//i.test(value)) return "hls";
  if (/\.mp4(?:$|[?#])|\/get_video\?|\/api\/download-full\/file\?/i.test(value)) return "mp4";
  if (/\.mpd(?:$|[?#])/i.test(value)) return "dash";
  return "unknown";
}

function isLocalPlayer(player: EpisodePlayer | null) {
  return player?.provider === "local" || player?.provider === "spillsave";
}

function isVolatileRemotePlayer(player: EpisodePlayer | null) {
  if (!player) return false;
  return /vidking|svetserialu|filemoon|vidmoly|streamtape|mixdrop|miixdrop|dood|voe|hqq|sb\d+|bombuj|2embed|xpass|multiembed|moviesclub|primewire|videasy|vidsrc/i.test([
    player.provider,
    player.sourcePageUrl,
    player.embedUrl,
  ].filter(Boolean).join(" "));
}

function hasReusablePersistedStream(player: EpisodePlayer | null) {
  if (!player?.streamUrl?.trim()) return false;
  if (!isVolatileRemotePlayer(player)) return true;
  const signature = `${player.provider} ${player.embedUrl}`.toLowerCase();
  return /streamtape/.test(signature) && Boolean(player.resolvedAt && Date.now() - player.resolvedAt < 10 * 60 * 1000);
}

function streamTypeFromPlayerSource(source: PlayerSource): EpisodePlayer["streamType"] {
  if (source.type === "hls") return "hls";
  if (source.type === "dash") return "dash";
  if (source.type === "direct") return inferStreamType(source.url);
  return "embed";
}

function playerSourceToEpisodePlayer(source: PlayerSource, index: number, episode: LibraryEpisode): EpisodePlayer {
  const streamType = streamTypeFromPlayerSource(source);
  const sourceLanguageKey = getCanonicalLanguageKey(source.language);
  return {
    alias: `resolved-${source.integrationId}-${index + 1}`,
    provider: source.integrationId,
    label: source.label || source.integrationId,
    language: source.language,
    sourcePageUrl: source.url,
    embedUrl: source.url,
    streamUrl: streamType === "hls" || streamType === "mp4" || streamType === "dash" ? source.url : undefined,
    streamType,
    resolutionStatus: streamType === "embed" ? "unresolved" : "resolved",
    resolvedAt: streamType === "embed" ? undefined : Date.now(),
    subtitlesUrl: episode.players.find((player) => getCanonicalLanguageKey(player.language) === sourceLanguageKey && player.subtitlesUrl)?.subtitlesUrl,
  };
}

function extractServerBaseUrl(playbackUrl: string | undefined): string | null {
  if (!playbackUrl) return null;
  try {
    const parsed = new URL(playbackUrl, window.location.origin);
    if (parsed.origin !== window.location.origin && /^https?:$/i.test(parsed.protocol)) {
      return parsed.origin;
    }
  } catch {
    // Not an absolute URL or not a remote server.
  }
  return null;
}

function createSubtitleTrack(player: EpisodePlayer | null, _serverBaseUrl: string | null) {
  if (!player?.subtitlesUrl) return [];
  const presentation = getLanguagePresentation(player.language || player.label || "Subtitles");
  const src = buildRuntimeUrl(`/api/subtitle-proxy?url=${encodeURIComponent(player.subtitlesUrl)}`);
  return [{
    src,
    label: presentation.labelWithFlags,
    srclang: (player.language || "en").slice(0, 5).toLowerCase(),
    default: true,
  }];
}

function episodeWithSelectedPlayer(episode: LibraryEpisode, player: EpisodePlayer, includeFallbacks = false): LibraryEpisode {
  return {
    ...episode,
    players: includeFallbacks
      ? [player, ...episode.players.filter((entry) => entry.alias !== player.alias)]
      : [player],
    selectedPlayerAlias: player.alias,
  };
}

function getPersistedPlaybackResult(episode: LibraryEpisode | null, player: EpisodePlayer | null): PlaybackResolveResult | null {
  if (!episode || !player || isLocalPlayer(player)) {
    return null;
  }
  if (!hasReusablePersistedStream(player)) {
    return null;
  }
  const persistedUrl = player.streamUrl?.trim();
  const playbackUrl = persistedUrl ? buildPlaybackProxyUrl(player, episode.id, persistedUrl) : null;
  if (!persistedUrl || !playbackUrl) {
    return null;
  }
  return {
    playerAlias: player.alias,
    playbackUrl,
    resolvedUrl: persistedUrl,
    refererUrl: player.streamRefererUrl ?? player.sourcePageUrl ?? player.embedUrl,
    streamType: player.streamType ?? inferStreamType(persistedUrl),
    subtitlesUrl: player.subtitlesUrl,
  };
}

export function PlayerModal({
  episode,
  show,
  onClose,
  onSelectPlayer,
  onSelectEpisode,
  onResolvePlayer,
  onResolvePlayerFailure,
  onPlaybackProgress,
  autoPlayToken = null,
}: PlayerModalProps) {
  const [expandedLangs, setExpandedLangs] = useState<Set<string>>(new Set());
  const [downloadedSubtitleTracks, setDownloadedSubtitleTracks] = useState<{ src: string; label: string; srclang: string }[]>([]);
  const [vaultPlaybackUrl, setVaultPlaybackUrl] = useState<string | null>(null);
  const [playerMenuOpen, setPlayerMenuOpen] = useState(false);
  const [playback, setPlayback] = useState<PlaybackResolveResult | null>(null);
  const [playbackError, setPlaybackError] = useState<string | null>(null);
  const [playbackFailures, setPlaybackFailures] = useState<PlaybackResolveFailure[]>([]);
  const [resolvingPlayback, setResolvingPlayback] = useState(false);
  const [playerStatuses, setPlayerStatuses] = useState<Record<string, PlayerResolutionStatus>>({});
  const [expandedPlayers, setExpandedPlayers] = useState<EpisodePlayer[]>([]);
  const [localSelectedAlias, setLocalSelectedAlias] = useState<PlayerAlias | null>(null);
  const [, setSourceDiscoveryState] = useState<"idle" | "searching" | "complete" | "failed">("idle");
  const [selectedSelectorSeason, setSelectedSelectorSeason] = useState<number | null>(null);
  const [episodeSelectorOpen, setEpisodeSelectorOpen] = useState(false);
  const [episodeTransitioning, setEpisodeTransitioning] = useState(false);
  const [focusedEpisodeIndex, setFocusedEpisodeIndex] = useState<number>(0);
  const episodeScrollRef = useRef<HTMLDivElement>(null);
  const [playbackRetryNonce, setPlaybackRetryNonce] = useState(0);
  const playbackErrorRetryRef = useRef<string | null>(null);
  const backgroundResolveKeysRef = useRef<Set<string>>(new Set());
  const lastProgressSaveRef = useRef(0);

  const effectiveEpisode = useMemo(() => {
    if (!episode) return null;
    const players = Array.from(
      new Map([...episode.players, ...expandedPlayers].map((player) => [`${player.provider}:${player.embedUrl}`, player])).values(),
    );
    const selectedPlayerAlias = localSelectedAlias && players.some((player) => player.alias === localSelectedAlias)
      ? localSelectedAlias
      : episode.selectedPlayerAlias;
    return {
      ...episode,
      players,
      selectedPlayerAlias,
    };
  }, [episode, expandedPlayers, localSelectedAlias]);

  const groupedPlayers = useMemo(() => {
    if (!effectiveEpisode) return [];
    const groups = new Map<string, { label: string; players: typeof effectiveEpisode.players }>();
    for (const player of effectiveEpisode.players) {
      const key = getCanonicalLanguageKey(player.language);
      const group = groups.get(key) ?? { label: getCanonicalLanguageLabel(player.language), players: [] };
      group.players.push(player);
      groups.set(key, group);
    }
    return Array.from(groups.entries()).map(([key, group]) => ({ key, ...group }));
  }, [effectiveEpisode]);

  useEffect(() => {
    if (groupedPlayers.length > 0 && expandedLangs.size === 0) {
      setExpandedLangs(new Set([groupedPlayers[0].key]));
    }
  }, [groupedPlayers, expandedLangs]);

  const activePlayer = effectiveEpisode
    ? effectiveEpisode.players.find((player) => player.alias === effectiveEpisode.selectedPlayerAlias) ?? effectiveEpisode.players[0]
    : null;
  const activeIsLocal = isLocalPlayer(activePlayer);
  const isMovieEntry = effectiveEpisode?.episodeCode === "movie" || effectiveEpisode?.episodeTitle === "Movie Format";
  const modalHeading = isMovieEntry
    ? effectiveEpisode?.showTitle ?? "Movie"
    : effectiveEpisode
      ? formatEpisodeTitle(effectiveEpisode)
      : "Episode";
  const modalSubheading = isMovieEntry ? effectiveEpisode?.showTitle ?? "" : `${effectiveEpisode?.showTitle} - Season ${effectiveEpisode?.seasonNumber} - Episode ${effectiveEpisode?.episodeNumber ?? "?"}`;
  const pageTitle = modalHeading;
  const showMetadata = getShowMetadata(show);
  const pageSubtitle = isMovieEntry ? [showMetadata?.years ?? show?.years, activePlayer?.language].filter(Boolean).join(" - ") : modalSubheading;
  const pageDescription = getTitleDescription(show);
  const showArtwork = getShowArtwork(show);
  const pageArtwork = showArtwork.backdropUrl ?? showArtwork.bannerUrl ?? effectiveEpisode?.posterUrl ?? showArtwork.posterUrl ?? null;
  const pageLogo = showArtwork.clearLogoUrl ?? null;
  const pageMetadataParts = getTitleMetadataParts(show, { episode: effectiveEpisode });
  const localPlaybackSrc = vaultPlaybackUrl ?? activePlayer?.streamUrl ?? activePlayer?.embedUrl ?? "";
  const instantPlayback = useMemo(() => getPersistedPlaybackResult(effectiveEpisode, activePlayer), [effectiveEpisode, activePlayer]);
  const visiblePlayback = playback ?? instantPlayback;
  const remotePlaybackSrc = visiblePlayback?.playbackUrl ?? "";
  const selectedResolvedPlayer = playback?.playerAlias
    ? effectiveEpisode?.players.find((player) => player.alias === playback.playerAlias) ?? activePlayer
    : instantPlayback?.playerAlias
      ? effectiveEpisode?.players.find((player) => player.alias === instantPlayback.playerAlias) ?? activePlayer
      : activePlayer;

  function toggleLang(lang: string) {
    setExpandedLangs((prev) => {
      const next = new Set(prev);
      if (next.has(lang)) next.delete(lang);
      else next.add(lang);
      return next;
    });
  }

  function handleChoosePlayer(player: EpisodePlayer) {
    if (!episode) return;
    const shouldRetry = player.alias === activePlayer?.alias
      || playerStatuses[player.alias]?.status === "failed"
      || player.resolutionStatus === "failed";
    if (shouldRetry && !isLocalPlayer(player)) {
      const key = playbackCacheKey(player);
      removeCachedPlayerUrl("playback", key);
      removeCachedPlayerFailure("playback", key);
      playbackErrorRetryRef.current = key;
      setPlayback(null);
      setPlaybackError(null);
      setPlaybackFailures([]);
      setPlayerStatuses((current) => ({
        ...current,
        [player.alias]: { status: "unresolved" },
      }));
      setPlaybackRetryNonce((value) => value + 1);
    }
    if (episode.players.some((entry) => entry.alias === player.alias)) {
      setLocalSelectedAlias(null);
      onSelectPlayer(episode.id, player.alias);
      return;
    }
    setLocalSelectedAlias(player.alias);
  }

  useEffect(() => {
    setExpandedPlayers([]);
    setLocalSelectedAlias(null);
    setSourceDiscoveryState("idle");
    setSelectedSelectorSeason(null);
    setEpisodeSelectorOpen(false);
    setEpisodeTransitioning(false);
    setFocusedEpisodeIndex(0);
    setPlaybackRetryNonce(0);
    playbackErrorRetryRef.current = null;
    backgroundResolveKeysRef.current = new Set();
    lastProgressSaveRef.current = 0;
  }, [episode?.id]);

  useEffect(() => {
    if (!ENABLE_PLAYER_BACKGROUND_DISCOVERY) return;
    if (!episode || !show) return;
    let canceled = false;
    const run = async () => {
      setSourceDiscoveryState("searching");
      try {
        const mediaType = show.mediaType === "movie" || episode.episodeCode === "movie" ? "movie" : "series";
        const search = await searchTitleItems({
          query: show.title || episode.showTitle,
          mediaType,
        });
        const best = search.results[0];
        if (!best) {
          if (!canceled) setSourceDiscoveryState("complete");
          return;
        }
        const resolved = await resolveTitleItem(best);
        const discoveredPlayers = resolved.players.map((source, index) => playerSourceToEpisodePlayer(source, index, episode));
        if (!canceled) {
          setExpandedPlayers(discoveredPlayers);
          setSourceDiscoveryState("complete");
        }
      } catch {
        if (!canceled) setSourceDiscoveryState("failed");
      }
    };
    void run();
    return () => {
      canceled = true;
    };
  }, [episode?.id, episode?.episodeCode, episode?.showTitle, show?.mediaType, show?.title]);

  useEffect(() => {
    let revokedUrl: string | null = null;
    let canceled = false;

    const loadVaultPlaybackUrl = async () => {
      setVaultPlaybackUrl(null);
      if (!activePlayer || activePlayer.provider !== "spillsave") return;

      let fileName: string | null = null;
      try {
        fileName = new URL(activePlayer.embedUrl, window.location.origin).searchParams.get("file");
      } catch {
        fileName = null;
      }
      if (!fileName) return;

      const objectUrl = await getLibraryVaultFileObjectUrl(fileName);
      if (canceled) {
        if (objectUrl) URL.revokeObjectURL(objectUrl);
        return;
      }
      if (objectUrl) {
        revokedUrl = objectUrl;
        setVaultPlaybackUrl(objectUrl);
      }
    };

    void loadVaultPlaybackUrl();
    return () => {
      canceled = true;
      if (revokedUrl) URL.revokeObjectURL(revokedUrl);
    };
  }, [activePlayer]);

  useEffect(() => {
    let canceled = false;
    const loadLocalSubtitles = async () => {
      if (!episode || !activeIsLocal) {
        setDownloadedSubtitleTracks([]);
        return;
      }
      try {
        const response = await fetch(buildRuntimeUrl(`/api/download-full/subtitles?episodeId=${encodeURIComponent(episode.id)}`));
        if (!response.ok) {
          if (!canceled) setDownloadedSubtitleTracks([]);
          return;
        }
        const payload = await response.json() as { subtitles?: Array<{ fileName: string; label: string; language?: string }> };
        const tracks = (payload.subtitles ?? []).map((entry, index) => {
          const languageLabel = entry.language ?? entry.label ?? `Subtitle ${index + 1}`;
          const presentation = getLanguagePresentation(languageLabel);
          return {
            src: buildRuntimeUrl(`/api/download-full/subtitle-file?episodeId=${encodeURIComponent(episode.id)}&file=${encodeURIComponent(entry.fileName)}`),
            label: presentation.labelWithFlags,
            srclang: (languageLabel || "en").slice(0, 5).toLowerCase(),
          };
        });
        if (!canceled) setDownloadedSubtitleTracks(tracks);
      } catch {
        if (!canceled) setDownloadedSubtitleTracks([]);
      }
    };

    void loadLocalSubtitles();
    return () => {
      canceled = true;
    };
  }, [episode, activeIsLocal]);

  async function resolveSinglePlayer(targetEpisode: LibraryEpisode, player: EpisodePlayer, background = false) {
    if (isLocalPlayer(player)) return null;

    const playerCacheKey = playbackCacheKey(player);
    const forceFreshResolution = !background && playbackErrorRetryRef.current === playerCacheKey;
    const cachedUrl = forceFreshResolution ? null : readCachedPlayerUrl("playback", playerCacheKey);
    const cachedStreamType = cachedUrl ? inferStreamType(cachedUrl) : "unknown";
    if (cachedUrl && !isVolatileRemotePlayer(player) && cachedStreamType !== "unknown" && cachedStreamType !== "embed") {
      const cachedProxy = parsePlaybackProxyUrl(cachedUrl);
      const cachedRawUrl = cachedProxy?.streamUrl ?? player.streamUrl ?? cachedUrl;
      const cachedRefererUrl = cachedProxy?.refererUrl || player.streamRefererUrl || player.sourcePageUrl || player.embedUrl;
      const playbackUrl = cachedProxy
        ? buildPlaybackProxyUrl({ ...player, streamRefererUrl: cachedRefererUrl }, targetEpisode.id, cachedRawUrl) ?? cachedUrl
        : cachedUrl;
      const result = {
        playerAlias: player.alias,
        playbackUrl,
        resolvedUrl: cachedRawUrl,
        refererUrl: cachedRefererUrl,
        streamType: player.streamType ?? inferStreamType(cachedRawUrl) ?? cachedStreamType,
        subtitlesUrl: player.subtitlesUrl,
      } satisfies PlaybackResolveResult;
      void prewarmPlaybackUrl(result.playbackUrl);
      removeCachedPlayerFailure("playback", playbackCacheKey(player));
      setPlayerStatuses((prev) => ({ ...prev, [player.alias]: { status: "resolved", playback: result } }));
      if (player.streamUrl) {
        onResolvePlayer?.(targetEpisode.id, player, result);
      }
      if (!background) setPlayback(result);
      return result;
    }

    const persistedUrl = !forceFreshResolution && hasReusablePersistedStream(player) ? player.streamUrl?.trim() : "";
    const persistedPlaybackUrl = persistedUrl ? buildPlaybackProxyUrl(player, targetEpisode.id, persistedUrl) : null;
    if (persistedUrl && persistedPlaybackUrl) {
      const result = {
        playerAlias: player.alias,
        playbackUrl: persistedPlaybackUrl,
        resolvedUrl: persistedUrl,
        refererUrl: player.streamRefererUrl ?? player.sourcePageUrl ?? player.embedUrl,
        streamType: player.streamType ?? inferStreamType(persistedUrl),
        subtitlesUrl: player.subtitlesUrl,
      } satisfies PlaybackResolveResult;
      void prewarmPlaybackUrl(result.playbackUrl);
      writeCachedPlayerUrl("playback", playbackCacheKey(player), result.playbackUrl);
      removeCachedPlayerFailure("playback", playbackCacheKey(player));
      setPlayerStatuses((prev) => ({ ...prev, [player.alias]: { status: "resolved", playback: result } }));
      onResolvePlayer?.(targetEpisode.id, player, result);
      if (!background) setPlayback(result);
      return result;
    }

    const cachedFailure = readCachedPlayerFailure("playback", playbackCacheKey(player));
    if (cachedFailure) {
      setPlayerStatuses((prev) => ({ ...prev, [player.alias]: { status: "failed", error: cachedFailure } }));
      onResolvePlayerFailure?.(targetEpisode.id, player, cachedFailure);
    }

    setPlayerStatuses((prev) => ({ ...prev, [player.alias]: { status: "resolving" } }));
    const result = await resolveUniversalPlayback(episodeWithSelectedPlayer(targetEpisode, player, !background));
    void prewarmPlaybackUrl(result.playbackUrl);
    const resolvedPlayer = targetEpisode.players.find((entry) => entry.alias === result.playerAlias) ?? player;
    removeCachedPlayerFailure("playback", playbackCacheKey(resolvedPlayer));
    if (result.streamType !== "embed") {
      writeCachedPlayerUrl("playback", playbackCacheKey(resolvedPlayer), result.playbackUrl);
      onResolvePlayer?.(targetEpisode.id, resolvedPlayer, result);
    }
    setPlayerStatuses((prev) => ({ ...prev, [result.playerAlias]: { status: "resolved", playback: result } }));
    if (!background) {
      setPlayback(result);
    }
    return result;
  }

  async function resolvePlaybackForEpisode(targetEpisode: LibraryEpisode, background = false) {
    const selected = targetEpisode.players.find((player) => player.alias === targetEpisode.selectedPlayerAlias) ?? targetEpisode.players[0];
    if (!selected || isLocalPlayer(selected)) return null;

    try {
      return await resolveSinglePlayer(targetEpisode, selected, background);
    } catch (selectedError) {
      const selectedMessage = selectedError instanceof Error ? selectedError.message : String(selectedError);
      writeCachedPlayerFailure("playback", playbackCacheKey(selected), selectedMessage);
      setPlayerStatuses((prev) => ({ ...prev, [selected.alias]: { status: "failed", error: selectedMessage } }));
      onResolvePlayerFailure?.(targetEpisode.id, selected, selectedMessage);
      throw selectedError;
    }
  }

  useEffect(() => {
    let canceled = false;
    setPlayback(null);
    setPlaybackError(null);
    setPlaybackFailures([]);

    const run = async () => {
      if (!effectiveEpisode || !activePlayer || activeIsLocal) {
        setResolvingPlayback(false);
        return;
      }

      setResolvingPlayback(true);
      try {
        const result = await resolvePlaybackForEpisode(effectiveEpisode);
        if (canceled) return;
        if (result) {
          setPlayback(result);
          setPlaybackError(null);
          setPlaybackFailures([]);
        }
      } catch (error) {
        if (canceled) return;
        const failures = error && typeof error === "object" && "failures" in error ? (error as { failures?: PlaybackResolveFailure[] }).failures ?? [] : [];
        const message = error instanceof Error ? error.message : "Universal playback is unavailable for this episode.";
        setPlaybackError(message);
        setPlaybackFailures(failures);
        if (activePlayer) {
          writeCachedPlayerFailure("playback", playbackCacheKey(activePlayer), message);
          setPlayerStatuses((prev) => ({ ...prev, [activePlayer.alias]: { status: "failed", error: message } }));
        }
      } finally {
        if (!canceled) setResolvingPlayback(false);
      }
    };

    void run();
    return () => {
      canceled = true;
    };
  }, [effectiveEpisode?.id, activePlayer?.alias, activeIsLocal, playbackRetryNonce]);

  useEffect(() => {
    if (!effectiveEpisode) return;
    if (!playback && !playbackError) return;
    const targetEpisode = effectiveEpisode;
    let canceled = false;
    const remotePlayers = targetEpisode.players.filter((player) => !isLocalPlayer(player));
    const pendingPlayers = remotePlayers.filter((player) => {
      const key = `${targetEpisode.id}:${player.alias}:${player.embedUrl}`;
      return !backgroundResolveKeysRef.current.has(key);
    });
    if (pendingPlayers.length === 0) return;

    for (const player of pendingPlayers) {
      backgroundResolveKeysRef.current.add(`${targetEpisode.id}:${player.alias}:${player.embedUrl}`);
    }

    const run = async () => {
      await new Promise((resolveDelay) => window.setTimeout(resolveDelay, 45000));
      if (canceled) return;
      const concurrency = 1;
      let cursor = 0;
      async function worker() {
        while (!canceled && cursor < pendingPlayers.length) {
          const player = pendingPlayers[cursor];
          cursor += 1;
          try {
            await resolveSinglePlayer(targetEpisode, player, true);
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            writeCachedPlayerFailure("playback", playbackCacheKey(player), message);
            setPlayerStatuses((prev) => ({ ...prev, [player.alias]: { status: "failed", error: message } }));
            onResolvePlayerFailure?.(targetEpisode.id, player, message);
          }
        }
      }

      await Promise.all(Array.from({ length: Math.min(concurrency, pendingPlayers.length) }, () => worker()));
    };

    void run();
    return () => {
      canceled = true;
    };
  }, [effectiveEpisode?.id, effectiveEpisode?.players, onResolvePlayerFailure, playback, playbackError]);

  const localSubtitleTracks = useMemo(() => {
    if (!episode || !activeIsLocal) return [];
    if (downloadedSubtitleTracks.length > 0) {
      return downloadedSubtitleTracks.map((track, index) => ({ ...track, default: index === 0 }));
    }
    return createSubtitleTrack(activePlayer, null);
  }, [activeIsLocal, activePlayer, downloadedSubtitleTracks, episode]);
  const remoteSubtitleTracks = useMemo(
    () => createSubtitleTrack(
      visiblePlayback?.subtitlesUrl && selectedResolvedPlayer
        ? { ...selectedResolvedPlayer, subtitlesUrl: visiblePlayback.subtitlesUrl }
        : selectedResolvedPlayer ?? activePlayer,
      extractServerBaseUrl(visiblePlayback?.playbackUrl),
    ),
    [activePlayer, selectedResolvedPlayer, visiblePlayback],
  );
  const handlePlayerProgress = useCallback((progress: { currentTime: number; duration: number }) => {
    if (!effectiveEpisode) return;
    if (!Number.isFinite(progress.currentTime) || progress.currentTime < 3) return;
    playbackErrorRetryRef.current = null;
    if (!onPlaybackProgress) return;
    const now = Date.now();
    if (now - lastProgressSaveRef.current < 5000) return;
    lastProgressSaveRef.current = now;
    onPlaybackProgress(effectiveEpisode.id, progress);
  }, [effectiveEpisode?.id, onPlaybackProgress]);
  const handlePlaybackError = useCallback((message: string) => {
    setPlaybackError(message);
    if (!activePlayer || activeIsLocal) return;
    const key = playbackCacheKey(activePlayer);
    removeCachedPlayerUrl("playback", key);
    if (playbackErrorRetryRef.current === key) return;
    playbackErrorRetryRef.current = key;
    setPlayback(null);
    setPlaybackRetryNonce((value) => value + 1);
  }, [activeIsLocal, activePlayer, playback]);

  useEffect(() => {
    if (!playbackError || !effectiveEpisode || activeIsLocal) return;
    const active = effectiveEpisode.players.find((p) => p.alias === effectiveEpisode.selectedPlayerAlias) ?? effectiveEpisode.players[0];
    if (!active) return;
    const activeHasSubtitles = /titulky|subtitles|subbed/i.test(active.language ?? "") || Boolean(active.subtitlesUrl);
    if (!activeHasSubtitles) return;

    const nonSubtitlePlayers = effectiveEpisode.players.filter((p) =>
      p.alias !== active.alias &&
      !/titulky|subtitles|subbed/i.test(p.language ?? "") &&
      !p.subtitlesUrl &&
      p.resolutionStatus !== "failed" &&
      !playbackFailures.some((f) => f.playerAlias === p.alias),
    );
    if (nonSubtitlePlayers.length === 0) return;

    const fallback = nonSubtitlePlayers[0];
    const fallbackKey = playbackCacheKey(fallback);
    removeCachedPlayerUrl("playback", fallbackKey);
    removeCachedPlayerFailure("playback", fallbackKey);
    playbackErrorRetryRef.current = fallbackKey;
    setPlayback(null);
    setPlaybackError(null);
    setPlaybackFailures([]);
    setLocalSelectedAlias(fallback.alias);
    setPlaybackRetryNonce((value) => value + 1);
  }, [playbackError, effectiveEpisode, activeIsLocal, playbackFailures]);

  if (!episode || !effectiveEpisode || !activePlayer) return null;

  const sourceLabel = activeIsLocal
    ? activePlayer.provider === "spillsave" ? "Vault file" : "Local file"
    : selectedResolvedPlayer ? `${selectedResolvedPlayer.label}` : "Player";
  const showEpisodes = show?.episodes ?? [episode];
  const selectorEpisodes = [...showEpisodes]
    .sort((first, second) => (first.seasonNumber - second.seasonNumber) || ((first.episodeNumber ?? 0) - (second.episodeNumber ?? 0)));
  const selectorSeasons = Array.from(
    selectorEpisodes.reduce((map, entry) => {
      const list = map.get(entry.seasonNumber) ?? [];
      list.push(entry);
      map.set(entry.seasonNumber, list);
      return map;
    }, new Map<number, LibraryEpisode[]>()).entries(),
  ).sort((first, second) => first[0] - second[0]);
  const activeSelectorSeason = selectedSelectorSeason ?? effectiveEpisode.seasonNumber ?? selectorSeasons[0]?.[0] ?? null;
  const activeSelectorEpisodes = selectorSeasons.find(([season]) => season === activeSelectorSeason)?.[1] ?? selectorEpisodes;

  const playerTransitionKey = show?.slug ?? effectiveEpisode.showSlug ?? null;
  return (
    <section
      className="animate-player-open relative h-[100svh] min-h-[100svh] overflow-hidden bg-black text-white max-lg:fixed max-lg:inset-0 max-lg:z-[120] lg:min-h-[100dvh]"
      style={playerTransitionKey ? { viewTransitionName: `spilled-hero-${playerTransitionKey}` } : undefined}
    >
      {pageArtwork ? (
        <div className="absolute inset-0">
          <div className="absolute inset-0 scale-[1.01] bg-cover bg-center opacity-55" style={balancedBackgroundImage(pageArtwork, "backdrop-hero")} />
          <div className="absolute inset-0 bg-gradient-to-r from-black/82 via-black/20 to-black/62" />
          <div className="absolute inset-x-0 bottom-0 h-[48%] bg-gradient-to-t from-black via-black/70 to-transparent" />
          <div className="absolute inset-0 shadow-[inset_0_0_90px_rgba(0,0,0,0.96)]" />
        </div>
      ) : null}

      <div className="absolute inset-0">
        {activeIsLocal ? (
          <UniversalVideoPlayer
            key={`${activePlayer.alias}:${localPlaybackSrc}`}
            src={localPlaybackSrc}
            poster={pageArtwork ?? undefined}
            title={pageTitle}
            titleLogoUrl={pageLogo}
            titleTransitionKey={playerTransitionKey}
            subtitle={pageSubtitle}
            metadataParts={pageMetadataParts}
            description={pageDescription}
            sourceLabel={sourceLabel}
            className="min-h-[100svh] lg:min-h-[100dvh]"
            subtitleTracks={localSubtitleTracks}
            autoPlayToken={autoPlayToken}
            initialTime={effectiveEpisode.playbackPositionSeconds ?? null}
            onProgress={handlePlayerProgress}
          />
        ) : remotePlaybackSrc ? (
          <UniversalVideoPlayer
            key={`${playback?.playerAlias}:${remotePlaybackSrc}`}
            src={remotePlaybackSrc}
            poster={pageArtwork ?? undefined}
            title={pageTitle}
            titleLogoUrl={pageLogo}
            titleTransitionKey={playerTransitionKey}
            subtitle={pageSubtitle}
            metadataParts={pageMetadataParts}
            description={pageDescription}
            sourceLabel={sourceLabel}
            className="min-h-[100svh] lg:min-h-[100dvh]"
            subtitleTracks={remoteSubtitleTracks}
            autoPlayToken={autoPlayToken}
            initialTime={effectiveEpisode.playbackPositionSeconds ?? null}
            onProgress={handlePlayerProgress}
            onError={handlePlaybackError}
          />
        ) : (
          <div className="relative flex min-h-[100svh] items-end px-5 pb-[max(6rem,env(safe-area-inset-bottom))] pt-24 sm:px-10 lg:min-h-[100dvh] lg:px-12 lg:py-24">
            <div className="max-w-2xl">
              <div className="mb-5 inline-flex h-14 w-14 items-center justify-center rounded-full border border-white/12 bg-white/8 shadow-2xl backdrop-blur-md">
                {resolvingPlayback ? <LoaderCircle className="h-6 w-6 animate-spin text-white/85" /> : <RotateCw className="h-6 w-6 text-white/85" />}
              </div>
              <div className="text-4xl font-black uppercase text-white drop-shadow-[0_4px_24px_rgba(0,0,0,0.9)] sm:text-6xl">{pageTitle}</div>
              {pageSubtitle ? <div className="mt-3 text-sm font-semibold text-white/72">{pageSubtitle}</div> : null}
              <div className="mt-4 max-w-xl text-sm leading-6 text-white/68">
                {playbackError ?? "Resolving this source into the Spilled universal player."}
              </div>
              {playbackError ? (
                <button type="button" onClick={() => { if (effectiveEpisode) void resolvePlaybackForEpisode(effectiveEpisode); }} className="mt-5 inline-flex items-center gap-2 rounded-full border border-white/10 bg-white px-5 py-3 text-sm font-bold text-black transition hover:bg-orange-200">
                  <RotateCw className="h-4 w-4" />
                  Retry playback
                </button>
              ) : null}
            </div>
          </div>
        )}
      </div>

      <div className="pointer-events-none absolute inset-x-0 top-0 z-40 flex items-start justify-between px-4 pt-[max(1.25rem,env(safe-area-inset-top))] sm:px-7 lg:px-10 lg:pt-5">
        <div className="pointer-events-auto flex items-center gap-2.5">
          <button onClick={onClose} className="spilled-glass-icon h-10 w-10" aria-label="Back to episode detail">
            <ArrowLeft className="h-4 w-4" />
          </button>
        </div>

        <div className="pointer-events-auto flex flex-col items-end gap-2">
          <div className="relative">
            <button type="button" onClick={() => { setPlayerMenuOpen(false); setEpisodeSelectorOpen((v) => !v); }} className="spilled-glass-icon flex items-center gap-2 px-3 py-2" aria-label="Season">
              <span className="text-xs font-semibold text-white/80">Season {activeSelectorSeason ?? 1}</span>
              <ChevronDown className={clsx("h-3.5 w-3.5 text-white/60 transition-transform duration-200", episodeSelectorOpen && "rotate-180")} />
            </button>
            {episodeSelectorOpen && selectorSeasons.length > 1 ? (
              <div className="glass-panel absolute right-0 top-12 w-32 overflow-hidden rounded-xl border border-white/10 py-1">
                {selectorSeasons.map(([seasonNumber]) => (
                  <button key={seasonNumber} type="button" onClick={() => setSelectedSelectorSeason(seasonNumber)} className={clsx("flex w-full items-center px-3 py-2 text-sm transition hover:bg-white/10", activeSelectorSeason === seasonNumber ? "text-white font-semibold" : "text-white/60")}>
                    Season {seasonNumber}
                  </button>
                ))}
              </div>
            ) : null}
          </div>
          <div className="flex gap-2">
            <button type="button" onClick={() => { setEpisodeSelectorOpen(false); setPlayerMenuOpen((v) => !v); }} className="spilled-glass-icon h-10 w-10" aria-label="Sources">
              <Settings className="h-4 w-4" />
            </button>
            <button type="button" onClick={() => { setPlayerMenuOpen(false); setEpisodeSelectorOpen((v) => !v); }} className="spilled-glass-icon h-10 w-10" aria-label="Episodes">
              <List className="h-4 w-4" />
            </button>
          </div>
        </div>
      </div>

      {episodeSelectorOpen ? (
        <div className="absolute inset-y-0 right-0 z-30 flex justify-end transition-all duration-500" style={{ paddingTop: "max(5rem, env(safe-area-inset-top))", transform: episodeTransitioning ? "translateX(100%)" : "translateX(0)" }}>
          <div className="pointer-events-auto h-full w-[min(90vw,28rem)] bg-gradient-to-l from-black/95 via-black/90 to-transparent">
            <div
              ref={episodeScrollRef}
              className="h-full overflow-y-auto"
              style={{ scrollSnapType: "y mandatory", scrollBehavior: "smooth", scrollbarWidth: "none" }}
              onScroll={(e) => {
                const container = e.currentTarget;
                const scrollTop = container.scrollTop;
                const cardHeight = 160;
                const centeredIndex = Math.round(scrollTop / cardHeight);
                setFocusedEpisodeIndex(Math.max(0, Math.min(centeredIndex, activeSelectorEpisodes.length - 1)));
              }}
            >
              <div className="flex flex-col items-center gap-0 pt-[35vh] pb-[35vh]">
                {activeSelectorEpisodes.map((entry, index) => {
                  const isFocused = index === focusedEpisodeIndex;
                  const isCurrentPlaying = entry.id === effectiveEpisode.id;
                  const episodeArtwork = entry.posterUrl ?? show?.posterUrl ?? null;
                  const distance = Math.abs(index - focusedEpisodeIndex);
                  const scale = isFocused ? 1 : Math.max(0.55, 1 - distance * 0.12);
                  const opacity = isFocused ? 1 : Math.max(0.3, 1 - distance * 0.25);
                  return (
                    <div
                      key={entry.id}
                      className="w-full px-4"
                      style={{ scrollSnapAlign: "center", height: "160px" }}
                    >
                      <button
                        type="button"
                        onClick={() => {
                          if (isFocused) {
                            setEpisodeTransitioning(true);
                            setTimeout(() => {
                              setEpisodeSelectorOpen(false);
                              onSelectEpisode?.(entry);
                              setTimeout(() => setEpisodeTransitioning(false), 100);
                            }, 400);
                          } else {
                            const container = episodeScrollRef.current;
                            if (container) {
                              container.scrollTo({ top: index * 160, behavior: "smooth" });
                            }
                          }
                        }}
                        className="w-full h-full"
                        style={{ transform: `scale(${scale})`, transformOrigin: "center center", opacity }}
                      >
                        <div className={clsx("relative w-full h-full overflow-hidden rounded-2xl border-2 transition-all duration-300", isFocused ? (isCurrentPlaying ? "border-orange-500/80 shadow-2xl shadow-orange-500/20" : "border-white/30 shadow-xl shadow-white/10") : "border-white/5")}>
                          {episodeArtwork ? (
                            <img src={episodeArtwork} alt="" className="absolute inset-0 h-full w-full object-cover" loading="lazy" />
                          ) : (
                            <div className="absolute inset-0 flex items-center justify-center bg-white/5 text-white/20">No image</div>
                          )}
                          <div className="absolute inset-0 bg-gradient-to-t from-black/95 via-black/40 to-transparent" />
                          <div className="absolute bottom-0 left-0 right-0 p-3">
                            <div className="text-base font-bold text-white">{episodeShortLabel(entry)}. {formatEpisodeTitle(entry)}</div>
                            <div className="mt-0.5 flex items-center gap-2 text-xs text-white/60">
                              {entry.durationSeconds ? <span>{Math.round(entry.durationSeconds / 60)} min</span> : null}
                            </div>
                            {isFocused ? (
                              <p className="mt-1.5 line-clamp-2 text-xs leading-4 text-white/50">{entry.episodeTitle ?? `Episode ${entry.episodeNumber}`}</p>
                            ) : null}
                          </div>
                          {isCurrentPlaying && !isFocused ? (
                            <div className="absolute top-2 right-2 flex h-5 w-5 items-center justify-center rounded-full bg-orange-500">
                              <div className="h-1.5 w-1.5 rounded-full bg-white" />
                            </div>
                          ) : null}
                        </div>
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {episodeTransitioning ? (
        <div className="absolute inset-0 z-50 bg-black animate-fade-in" style={{ animationDuration: "400ms" }} />
      ) : null}

      {playerMenuOpen ? (
        <div className="absolute inset-y-0 right-0 z-30 flex justify-end" style={{ paddingTop: "max(5rem, env(safe-area-inset-top))" }}>
          <div className="pointer-events-auto h-full w-[min(85vw,22rem)] overflow-y-auto bg-gradient-to-l from-black/95 via-black/90 to-transparent" style={{ scrollbarWidth: "none" }}>
            <div className="p-4 pt-8 pb-24">
              <div className="glass-panel overflow-hidden rounded-2xl border border-white/10">
                <div className="border-b border-white/10 px-4 py-3">
                  <div className="text-xs font-bold text-white/50">{isMovieEntry ? "Movie" : "Active Source"}</div>
                  <div className="mt-1 truncate text-sm font-bold text-white">{modalHeading}</div>
                </div>
                <div className="p-2">
                  {groupedPlayers.map((group) => {
                    const isOpen = expandedLangs.has(group.key);
                    return (
                      <div key={group.key} className="mb-1">
                        <button type="button" onClick={() => toggleLang(group.key)} className="flex w-full items-center justify-between rounded-lg px-3 py-2 text-left transition hover:bg-white/10">
                          <span className="text-sm font-semibold text-white/80">{group.label}</span>
                          <ChevronDown className={clsx("h-4 w-4 text-white/40 transition-transform duration-200", isOpen && "rotate-180")} />
                        </button>
                        {isOpen ? (
                          <div className="mt-1 space-y-1 pl-2">
                            {group.players.map((player) => {
                              const active = player.alias === activePlayer.alias;
                              const status = playerStatuses[player.alias]?.status ?? player.resolutionStatus ?? "unresolved";
                              return (
                                <button key={player.alias} type="button" onClick={() => handleChoosePlayer(player)} className={clsx("glass-settings-item w-full text-left", active && "bg-white/15")}>
                                  <div className="min-w-0 flex-1">
                                    <div className="truncate text-sm font-medium text-white/80">{player.label}</div>
                                    <div className="text-xs text-white/40">{player.provider}</div>
                                  </div>
                                  {status === "resolving" ? <LoaderCircle className="h-4 w-4 animate-spin text-white/40" /> : status === "resolved" ? <div className="h-2 w-2 rounded-full bg-emerald-400" /> : status === "failed" ? <div className="h-2 w-2 rounded-full bg-red-400" /> : null}
                                </button>
                              );
                            })}
                          </div>
                        ) : null}
                      </div>
                    );
                  })}
                </div>
                {playbackFailures.length > 0 ? (
                  <div className="border-t border-white/10 px-4 py-3">
                    {playbackFailures.map((failure) => (
                      <div key={`${failure.playerAlias}:${failure.reason}`} className="text-xs text-red-300/80"><strong>{failure.provider}</strong>: {failure.reason}</div>
                    ))}
                  </div>
                ) : null}
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}
