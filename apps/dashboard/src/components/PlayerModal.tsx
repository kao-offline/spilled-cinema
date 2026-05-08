import { ExternalLink, X, ChevronDown, Star, LoaderCircle } from "lucide-react";
import { clsx } from "clsx";
import { useMemo, useState, useEffect } from "react";
import type { LibraryEpisode, PlayerAlias } from "../lib/types";
import { VideoJsPlayer } from "./VideoJsPlayer";
import { LanguageBadge } from "./LanguageBadge";
import { getLanguagePresentation } from "../lib/language";
import { formatEpisodeTitle } from "../lib/episode-title";
import { buildRuntimeUrl, requestRuntimeJson } from "../lib/local-api";

type PlayerModalProps = {
  episode: LibraryEpisode | null;
  onClose: () => void;
  onSelectPlayer: (episodeId: string, alias: PlayerAlias) => void;
};

export function PlayerModal({ episode, onClose, onSelectPlayer }: PlayerModalProps) {
  const [expandedLangs, setExpandedLangs] = useState<Set<string>>(new Set());
  const [downloadedSubtitleTracks, setDownloadedSubtitleTracks] = useState<
    { src: string; label: string; srclang: string }[]
  >([]);
  const [resolvedRemoteUrl, setResolvedRemoteUrl] = useState<string | null>(null);
  const [resolvingRemoteUrl, setResolvingRemoteUrl] = useState(false);
  const [playerFrameLoaded, setPlayerFrameLoaded] = useState(false);

  const groupedPlayers = useMemo(() => {
    if (!episode) return [];
    const groups = new Map<string, typeof episode.players>();
    for (const player of episode.players) {
      const lang = player.language || "Available Streams";
      const list = groups.get(lang) || [];
      list.push(player);
      groups.set(lang, list);
    }
    return Array.from(groups.entries());
  }, [episode]);

  useEffect(() => {
    if (groupedPlayers.length > 0 && expandedLangs.size === 0) {
      setExpandedLangs(new Set([groupedPlayers[0][0]]));
    }
  }, [groupedPlayers, expandedLangs]);

  function toggleLang(lang: string) {
    setExpandedLangs((prev) => {
      const next = new Set(prev);
      if (next.has(lang)) next.delete(lang);
      else next.add(lang);
      return next;
    });
  }

  const activePlayer = episode
    ? episode.players.find((player) => player.alias === episode.selectedPlayerAlias) ?? episode.players[0]
    : null;
  const isMovieEntry =
    episode?.episodeCode === "movie" ||
    episode?.episodeTitle === "Movie Format";
  const modalHeading = isMovieEntry
    ? episode?.showTitle ?? "Movie"
    : episode
      ? formatEpisodeTitle(episode)
      : "Episode";
  const modalSubheading = isMovieEntry
    ? episode?.showTitle ?? ""
    : `${episode?.showTitle} - Season ${episode?.seasonNumber} - Episode ${episode?.episodeNumber ?? "?"}`;
  const isLocalPlayer = activePlayer?.provider === "local" || activePlayer?.provider === "spillsave";

  useEffect(() => {
    setPlayerFrameLoaded(false);
  }, [activePlayer?.alias]);

  useEffect(() => {
    let canceled = false;

    const loadLocalSubtitles = async () => {
      if (!episode || !isLocalPlayer) {
        setDownloadedSubtitleTracks([]);
        return;
      }

      try {
        const response = await fetch(buildRuntimeUrl(`/api/download-full/subtitles?episodeId=${encodeURIComponent(episode.id)}`));
        if (!response.ok) {
          if (!canceled) setDownloadedSubtitleTracks([]);
          return;
        }
        const payload = (await response.json()) as {
          subtitles?: Array<{ fileName: string; label: string; language?: string }>;
        };

        const tracks = (payload.subtitles ?? []).map((entry, index) => {
          const languageLabel = entry.language ?? entry.label ?? `Subtitle ${index + 1}`;
          const presentation = getLanguagePresentation(languageLabel);
          return {
            src: buildRuntimeUrl(`/api/download-full/subtitle-file?episodeId=${encodeURIComponent(episode.id)}&file=${encodeURIComponent(entry.fileName)}`),
            label: presentation.labelWithFlags,
            srclang: (languageLabel || "en").slice(0, 5).toLowerCase(),
          };
        });

        if (!canceled) {
          setDownloadedSubtitleTracks(tracks);
        }
      } catch {
        if (!canceled) setDownloadedSubtitleTracks([]);
      }
    };

    void loadLocalSubtitles();
    return () => {
      canceled = true;
    };
  }, [episode, isLocalPlayer]);

  useEffect(() => {
    let canceled = false;

    const resolveRemotePlayerUrl = async () => {
      if (!activePlayer || isLocalPlayer) {
        setResolvedRemoteUrl(null);
        setResolvingRemoteUrl(false);
        return;
      }

      const providerSignature = `${activePlayer.provider} ${activePlayer.embedUrl}`.toLowerCase();
      const needsResolution = /(?:^|[^a-z])(2embed|multiembed|moviesclub|primewire)(?:[^a-z]|$)/i.test(providerSignature);

      if (!needsResolution) {
        setResolvedRemoteUrl(activePlayer.embedUrl);
        setResolvingRemoteUrl(false);
        return;
      }

      setResolvedRemoteUrl(null);
      setResolvingRemoteUrl(true);

      try {
        const result = await requestRuntimeJson<{ embedUrl?: string }>("/api/player/resolve", {
          method: "POST",
          body: {
            embedUrl: activePlayer.embedUrl,
            provider: activePlayer.provider,
          },
        });

        if (canceled) {
          return;
        }

        setResolvedRemoteUrl(result.ok && result.data?.embedUrl ? result.data.embedUrl : activePlayer.embedUrl);
      } catch {
        if (!canceled) {
          setResolvedRemoteUrl(activePlayer.embedUrl);
        }
      } finally {
        if (!canceled) {
          setResolvingRemoteUrl(false);
        }
      }
    };

    void resolveRemotePlayerUrl();

    return () => {
      canceled = true;
    };
  }, [activePlayer, isLocalPlayer]);

  const localSubtitleTracks = useMemo(() => {
    if (!episode || !isLocalPlayer) {
      return [];
    }

    if (downloadedSubtitleTracks.length > 0) {
      return downloadedSubtitleTracks;
    }

    const tracks = episode.players
      .filter((player) => player.provider !== "local" && player.provider !== "spillsave" && Boolean(player.subtitlesUrl))
      .map((player, index) => ({
        src: buildRuntimeUrl(`/api/subtitle-proxy?url=${encodeURIComponent(player.subtitlesUrl as string)}`),
        label: getLanguagePresentation(player.language || player.label || `Subtitle ${index + 1}`).labelWithFlags,
        srclang: (player.language || "en").slice(0, 5).toLowerCase(),
      }));

    const unique = new Map<string, { src: string; label: string; srclang: string }>();
    for (const track of tracks) {
      if (!unique.has(track.src)) {
        unique.set(track.src, track);
      }
    }
    return Array.from(unique.values());
  }, [episode, isLocalPlayer, downloadedSubtitleTracks]);

  const remoteProviderSignature = `${activePlayer?.provider ?? ""} ${activePlayer?.embedUrl ?? ""}`.toLowerCase();
  const slowRemoteProvider = /streamtape|steamtag/.test(remoteProviderSignature);
  const remoteIframeSrc = isLocalPlayer ? null : resolvedRemoteUrl;
  const showRemoteLoadingOverlay = !isLocalPlayer && (resolvingRemoteUrl || !playerFrameLoaded);


  if (!episode || !activePlayer) {
    return null;
  }

  return (
    <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/80 px-2 sm:p-6 backdrop-blur-md">
      <div className="glass-nav relative w-full h-full sm:h-auto max-h-[95vh] max-w-[90vw] overflow-hidden sm:rounded-[20px] border border-white/10 flex flex-col">
        <button
          onClick={onClose}
          className="absolute right-4 top-4 z-20 flex h-11 w-11 items-center justify-center rounded-full bg-black/60 text-white/60 transition hover:text-white"
        >
          <X className="h-5 w-5" />
        </button>

        <div className="grid gap-0 h-full lg:grid-cols-[1fr_380px] overflow-hidden">
          <div className="flex-1 bg-black min-h-[40vh] lg:min-h-0">
            {isLocalPlayer ? (
              <VideoJsPlayer
                key={activePlayer.alias}
                src={activePlayer.embedUrl}
                className="h-full w-full border-0 lg:h-[80vh]"
                subtitleTracks={localSubtitleTracks.map((track, index) => ({
                  ...track,
                  default: index === 0,
                }))}
              />
            ) : (
              <div className="relative h-full w-full">
                {remoteIframeSrc ? (
                  <iframe
                    key={`${activePlayer.alias}:${remoteIframeSrc}`}
                    title={isMovieEntry ? (episode.showTitle ?? "Player") : formatEpisodeTitle(episode)}
                    src={remoteIframeSrc}
                    className="h-full w-full border-0 lg:h-[80vh]"
                    allowFullScreen
                    referrerPolicy="no-referrer"
                    onLoad={() => setPlayerFrameLoaded(true)}
                  />
                ) : (
                  <div className="h-full w-full lg:h-[80vh]" />
                )}

                {showRemoteLoadingOverlay ? (
                  <div className="absolute inset-0 flex items-center justify-center bg-black/60 backdrop-blur-sm">
                    <div className="flex max-w-sm flex-col items-center gap-3 rounded-[24px] border border-white/10 bg-black/70 px-6 py-5 text-center text-white">
                      <LoaderCircle className="h-6 w-6 animate-spin text-white/80" />
                      <div className="text-sm font-semibold text-white/90">
                        {resolvingRemoteUrl ? "Preparing player..." : "Loading player..."}
                      </div>
                      <div className="text-xs text-white/55">
                        {slowRemoteProvider
                          ? "Streamtape usually takes a bit longer before the player appears."
                          : "Resolving the provider frame and waiting for playback UI."}
                      </div>
                    </div>
                  </div>
                ) : null}
              </div>
            )}
          </div>

          <div className="space-y-6 p-8">
            <div>
              <div className="text-[10px] font-black uppercase tracking-[0.35em] text-white/30">
                {isMovieEntry ? "Active Movie" : "Active Episode"}
              </div>
              <h2 className="mt-3 text-3xl font-bold tracking-tight text-white">
                {modalHeading}
              </h2>
              <p className="mt-2 text-sm text-white/40">
                {modalSubheading}
              </p>
            </div>

            <div className="space-y-3">
              <div className="text-[10px] font-black uppercase tracking-[0.35em] text-white/30">
                Players
              </div>
              <div className="grid gap-3 overflow-y-auto max-h-[320px] pr-2 custom-scrollbar">
                {groupedPlayers.map(([lang, players]) => {
                  const isOpen = expandedLangs.has(lang);
                  
                  return (
                    <div key={lang} className="overflow-hidden rounded-[24px] border border-white/10 bg-white/5">
                      <button
                        onClick={() => toggleLang(lang)}
                        className="flex w-full items-center justify-between p-5 text-left transition hover:bg-white/5"
                      >
                        <LanguageBadge language={lang} className="bg-black/20 text-white/85" />
                        <ChevronDown className={clsx("h-4 w-4 text-white/40 transition-transform duration-300", isOpen && "rotate-180")} />
                      </button>
                      
                      <div 
                         className={clsx(
                           "grid transition-all duration-300 ease-in-out",
                           isOpen ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0"
                         )}
                      >
                         <div className="overflow-hidden">
                           <div className="flex flex-col gap-2 p-3 pt-0">
                             {players.map((player) => {
                               const active = player.alias === activePlayer.alias;
                               return (
                                 <button
                                   key={player.alias}
                                   onClick={() => onSelectPlayer(episode.id, player.alias)}
                                   className={clsx(
                                     "rounded-[16px] border px-4 py-3 text-left transition",
                                     active
                                       ? "border-white bg-white text-black"
                                       : "border-transparent bg-black/20 text-white/70 hover:bg-black/40 hover:text-white"
                                   )}
                                 >
                                   <div className="text-[10px] font-black uppercase tracking-[0.2em] overflow-hidden text-ellipsis whitespace-nowrap flex items-center gap-2">
                                     {player.provider === "spillsave" ? (
                                       <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-yellow-400/20 text-yellow-300 shadow-[0_0_12px_rgba(250,204,21,0.35)]">
                                         <Star className="h-4 w-4" />
                                       </span>
                                     ) : null}
                                     <span>{player.label}</span>
                                   </div>
                                   <div className="mt-0.5 text-xs opacity-70">
                                     {player.provider.toUpperCase()}
                                   </div>
                                 </button>
                               );
                             })}
                           </div>
                         </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>


            <a
              href={remoteIframeSrc ?? activePlayer.embedUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-5 py-3 text-sm font-bold text-white/70 transition hover:bg-white/10 hover:text-white"
            >
              <ExternalLink className="h-4 w-4" />
              Open current player
            </a>
          </div>
        </div>
      </div>
    </div>
  );
}
