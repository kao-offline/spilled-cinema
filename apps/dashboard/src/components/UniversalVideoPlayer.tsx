import { useEffect, useMemo, useRef, useState, type MouseEvent, type PointerEvent } from "react";
import { Captions, Maximize, Minimize, Pause, Play, RotateCcw, RotateCw, Settings, Volume2, VolumeX } from "lucide-react";
import Hls from "hls.js";
import type { MediaPlayerClass } from "dashjs";
import { clsx } from "clsx";
import { balanceImageResolution } from "../lib/image-resolution";
import { findSmallBufferGapTarget, formatHlsQualityLabel, getBufferedAheadSeconds, selectHlsBufferProfile, shouldPreferNativeHls } from "../lib/hls-buffering";

type SubtitleTrack = {
  src: string;
  label: string;
  srclang: string;
  default?: boolean;
};

type BufferedRange = {
  start: number;
  end: number;
};

type QualityLevel = {
  index: number;
  label: string;
};

function getHlsBufferProfile() {
  const connection = (navigator as Navigator & {
    connection?: { saveData?: boolean; effectiveType?: string };
  }).connection;
  return selectHlsBufferProfile({
    saveData: connection?.saveData,
    effectiveType: connection?.effectiveType,
    compactViewport: window.matchMedia("(max-width: 768px)").matches,
  });
}

type UniversalVideoPlayerProps = {
  src: string;
  poster?: string | null;
  title: string;
  titleLogoUrl?: string | null;
  titleTransitionKey?: string | null;
  subtitle?: string;
  metadataParts?: Array<{ label: string; kind?: "rating" | "year" | "runtime" | "scope" | "genre"; pending?: boolean }>;
  description?: string | null;
  sourceLabel?: string;
  className?: string;
  subtitleTracks?: SubtitleTrack[];
  autoPlayToken?: number | null;
  initialTime?: number | null;
  onProgress?: (progress: { currentTime: number; duration: number }) => void;
  onError?: (message: string) => void;
};

function getSourceType(src: string) {
  if (/\/api\/download-full\/browser-file\?/i.test(src)) {
    try {
      const parsed = new URL(src, window.location.origin);
      const proxiedUrl = parsed.searchParams.get("url") ?? "";
      const name = parsed.searchParams.get("name") ?? "";
      if (/\.mp4(?:$|[?#])|\/get_video\?/i.test(proxiedUrl) || /\.mp4$/i.test(name)) return "video/mp4";
      if (/\.m3u8(?:$|[?#])|\/hls3\//i.test(proxiedUrl) || /\.m3u8$/i.test(name)) return "application/x-mpegURL";
      if (/\.mpd(?:$|[?#])/i.test(proxiedUrl) || /\.mpd$/i.test(name)) return "application/dash+xml";
    } catch {
      return undefined;
    }
  }
  if (/\.m3u8(?:$|[?#])|\/hls3\//i.test(src)) return "application/x-mpegURL";
  if (/\.mpd(?:$|[?#])/i.test(src)) return "application/dash+xml";
  if (/\.mp4(?:$|[?#])|\/get_video\?|\/api\/download-full\/file\?/i.test(src)) return "video/mp4";
  return undefined;
}

function formatClock(value: number) {
  if (!Number.isFinite(value) || value <= 0) return "0:00";
  const total = Math.floor(value);
  const seconds = total % 60;
  const minutes = Math.floor(total / 60) % 60;
  const hours = Math.floor(total / 3600);
  const paddedSeconds = seconds.toString().padStart(2, "0");
  const paddedMinutes = hours > 0 ? minutes.toString().padStart(2, "0") : minutes.toString();
  return hours > 0 ? `${hours}:${paddedMinutes}:${paddedSeconds}` : `${paddedMinutes}:${paddedSeconds}`;
}

function formatRuntimeLabel(value: number) {
  if (!Number.isFinite(value) || value <= 0) return null;
  const totalMinutes = Math.max(1, Math.round(value / 60));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours <= 0) return `${totalMinutes}min`;
  return `${hours}h${minutes > 0 ? ` ${minutes}min` : ""}`;
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function getBufferedRanges(video: HTMLVideoElement, duration: number): BufferedRange[] {
  if (!Number.isFinite(duration) || duration <= 0) return [];
  const ranges: BufferedRange[] = [];
  for (let index = 0; index < video.buffered.length; index += 1) {
    const start = clamp(video.buffered.start(index), 0, duration);
    const end = clamp(video.buffered.end(index), 0, duration);
    if (end > start) ranges.push({ start, end });
  }
  return ranges;
}

export function UniversalVideoPlayer({
  src,
  poster,
  title,
  titleLogoUrl,
  titleTransitionKey,
  metadataParts = [],
  description,
  sourceLabel = "Universal player",
  className,
  subtitleTracks = [],
  autoPlayToken = null,
  initialTime = null,
  onProgress,
  onError,
}: UniversalVideoPlayerProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const videoHostRef = useRef<HTMLDivElement | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const seekBarRef = useRef<HTMLDivElement | null>(null);
  const initialTimeRef = useRef(initialTime);
  const onErrorRef = useRef(onError);
  const onProgressRef = useRef(onProgress);
  const hlsRef = useRef<Hls | null>(null);
  const dashRef = useRef<MediaPlayerClass | null>(null);
  const lastAutoPlayTokenRef = useRef<number | null>(null);
  const lastUiSyncRef = useRef(0);
  const playbackErrorSentRef = useRef(false);
  const playbackStartedRef = useRef(false);
  const [paused, setPaused] = useState(true);
  const [waiting, setWaiting] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [bufferedRanges, setBufferedRanges] = useState<BufferedRange[]>([]);
  const [volume, setVolume] = useState(1);
  const [muted, setMuted] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const [controlsVisible, setControlsVisible] = useState(true);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [playbackRate, setPlaybackRate] = useState(1);
  const [qualityLevels, setQualityLevels] = useState<QualityLevel[]>([]);
  const [qualityLevel, setQualityLevel] = useState(-1);
  const [captionsEnabled, setCaptionsEnabled] = useState(subtitleTracks.some((track) => track.default));
  const [autoplayBlocked, setAutoplayBlocked] = useState(false);
  const sourceType = useMemo(() => getSourceType(src), [src]);
  const subtitleTrackSignature = useMemo(
    () => subtitleTracks
      .map((track) => [track.src, track.label, track.srclang, track.default ? "1" : "0"].join("\u001f"))
      .join("\u001e"),
    [subtitleTracks],
  );
  const renderedMetadataParts = useMemo(
    () => metadataParts.map((part) => {
      const runtimeLabel = part.kind === "runtime" && part.pending ? formatRuntimeLabel(duration) : null;
      return {
        ...part,
        label: runtimeLabel ?? part.label,
        pending: part.kind === "runtime" && part.pending ? !runtimeLabel : part.pending,
      };
    }),
    [duration, metadataParts],
  );

  useEffect(() => {
    initialTimeRef.current = initialTime;
  }, [initialTime]);

  useEffect(() => {
    onErrorRef.current = onError;
  }, [onError]);

  useEffect(() => {
    onProgressRef.current = onProgress;
  }, [onProgress]);

  useEffect(() => {
    const host = videoHostRef.current;
    if (!host) return undefined;

    host.replaceChildren();
    playbackErrorSentRef.current = false;
    playbackStartedRef.current = false;
    setAutoplayBlocked(false);
    setWaiting(true);
    const videoElement = document.createElement("video");
    videoElement.className = "h-full w-full object-contain";
    videoElement.playsInline = true;
    videoElement.setAttribute("playsinline", "");
    videoElement.setAttribute("webkit-playsinline", "");
    videoElement.preload = "auto";
    videoElement.playbackRate = playbackRate;
    if (poster) videoElement.poster = poster;

    for (const track of subtitleTracks) {
      const trackElement = document.createElement("track");
      trackElement.kind = "subtitles";
      trackElement.src = track.src;
      trackElement.label = track.label;
      trackElement.srclang = track.srclang;
      trackElement.default = Boolean(track.default);
      videoElement.appendChild(trackElement);
    }

    host.appendChild(videoElement);
    videoRef.current = videoElement;

    setBufferedRanges([]);
    setQualityLevels([]);
    setQualityLevel(-1);
    setSettingsOpen(false);
    let disposed = false;
    let fatalNetworkRecoveries = 0;
    let fatalMediaRecoveries = 0;
    const compactViewport = window.matchMedia("(max-width: 768px)").matches;
    let adaptiveQualityUnlocked = !compactViewport;
    let adaptiveUnlockAheadSeconds = 15;
    const nativeHlsSupported = Boolean(
      videoElement.canPlayType("application/vnd.apple.mpegurl")
      || videoElement.canPlayType("application/x-mpegURL"),
    );
    const useNativeHls = sourceType === "application/x-mpegURL" && shouldPreferNativeHls({
      canPlayNativeHls: nativeHlsSupported,
      userAgent: navigator.userAgent,
      platform: navigator.platform,
      maxTouchPoints: navigator.maxTouchPoints,
    });

    if (sourceType === "application/x-mpegURL" && Hls.isSupported() && !useNativeHls) {
      const bufferProfile = getHlsBufferProfile();
      adaptiveUnlockAheadSeconds = Math.min(30, Math.max(12, Math.round(bufferProfile.aheadSeconds / 3)));
      const hls = new Hls({
        enableWorker: true,
        lowLatencyMode: false,
        startLevel: compactViewport ? 0 : -1,
        startFragPrefetch: true,
        testBandwidth: true,
        abrEwmaDefaultEstimate: compactViewport
          ? bufferProfile.bandwidthEstimate
          : Math.max(bufferProfile.bandwidthEstimate, 6_000_000),
        abrBandWidthFactor: compactViewport ? 0.72 : 0.9,
        abrBandWidthUpFactor: compactViewport ? 0.55 : 0.75,
        abrMaxWithRealBitrate: true,
        maxStarvationDelay: 4,
        maxLoadingDelay: 4,
        capLevelToPlayerSize: compactViewport,
        maxBufferLength: bufferProfile.aheadSeconds,
        maxMaxBufferLength: bufferProfile.maximumAheadSeconds,
        maxBufferSize: bufferProfile.maximumBytes,
        backBufferLength: 30,
        maxBufferHole: 0.8,
        highBufferWatchdogPeriod: 2,
        nudgeOffset: 0.1,
        nudgeMaxRetry: 5,
      });
      hlsRef.current = hls;
      hls.loadSource(src);
      hls.attachMedia(videoElement);
      hls.on(Hls.Events.MANIFEST_PARSED, () => {
        setQualityLevels(hls.levels.map((level, index) => ({
          index,
          label: formatHlsQualityLabel(level, index),
        })));
        if (compactViewport) {
          hls.currentLevel = 0;
          setQualityLevel(0);
        } else {
          hls.currentLevel = -1;
          setQualityLevel(-1);
        }
      });
      hls.on(Hls.Events.LEVEL_SWITCHED, (_event, data) => {
        setQualityLevel(data.level);
      });
      hls.on(Hls.Events.ERROR, (_event, data) => {
        const responseCode = typeof data.response?.code === "number" ? data.response.code : 0;
        const networkBlocked = responseCode >= 400;
        const details = String(data.details ?? "");
        const startupLoadFailed = /manifest|level/i.test(details) && data.type === Hls.ErrorTypes.NETWORK_ERROR;
        const beforePlayback = !playbackStartedRef.current && (videoElement.currentTime || 0) < 3;
        if (data.fatal && data.type === Hls.ErrorTypes.NETWORK_ERROR && fatalNetworkRecoveries < 2) {
          fatalNetworkRecoveries += 1;
          hls.startLoad(videoElement.currentTime || -1);
          return;
        }
        if (data.fatal && data.type === Hls.ErrorTypes.MEDIA_ERROR && fatalMediaRecoveries < 2) {
          fatalMediaRecoveries += 1;
          hls.recoverMediaError();
          return;
        }
        if (beforePlayback && (data.fatal || networkBlocked || startupLoadFailed) && !playbackErrorSentRef.current) {
          setWaiting(false);
          playbackErrorSentRef.current = true;
          onErrorRef.current?.(`HLS playback failed${responseCode ? ` (${responseCode})` : ""}: ${data.details || data.type}`);
        }
      });
    } else if (sourceType === "application/dash+xml") {
      void import("dashjs").then((dashjs) => {
        if (disposed) return;
        const dash = dashjs.MediaPlayer().create();
        dashRef.current = dash;
        dash.updateSettings({
          streaming: {
            abr: { autoSwitchBitrate: { audio: true, video: true } },
            buffer: { bufferTimeDefault: 20, bufferTimeAtTopQuality: 30 },
          },
        });
        dash.initialize(videoElement, src, false);
      }).catch(() => {
        if (!disposed && !playbackErrorSentRef.current) {
          playbackErrorSentRef.current = true;
          onErrorRef.current?.("DASH playback engine could not be loaded.");
        }
      });
    } else {
      videoElement.src = src;
    }

    const sync = (force = false) => {
      const now = performance.now();
      if (!force && now - lastUiSyncRef.current < 500) {
        return;
      }
      lastUiSyncRef.current = now;
      setPaused(videoElement.paused);
      setCurrentTime(videoElement.currentTime || 0);
      setDuration(videoElement.duration || 0);
      const nextBufferedRanges = getBufferedRanges(videoElement, videoElement.duration || 0);
      setBufferedRanges(nextBufferedRanges);
      const hls = hlsRef.current;
      if (!adaptiveQualityUnlocked && hls && getBufferedAheadSeconds(videoElement.currentTime || 0, nextBufferedRanges) >= adaptiveUnlockAheadSeconds) {
        adaptiveQualityUnlocked = true;
        hls.currentLevel = -1;
        setQualityLevel(-1);
      }
      setVolume(videoElement.volume || 1);
      setMuted(videoElement.muted);
      setPlaybackRate(videoElement.playbackRate || 1);
      onProgressRef.current?.({
        currentTime: videoElement.currentTime || 0,
        duration: videoElement.duration || 0,
      });
    };
    const skipSmallBufferGap = () => {
      const position = videoElement.currentTime || 0;
      const ranges: BufferedRange[] = [];
      for (let index = 0; index < videoElement.buffered.length; index += 1) {
        ranges.push({ start: videoElement.buffered.start(index), end: videoElement.buffered.end(index) });
      }
      const target = findSmallBufferGapTarget(position, ranges);
      if (target == null) return false;
      videoElement.currentTime = target;
      return true;
    };
    const markWaiting = () => {
      if (!skipSmallBufferGap()) setWaiting(true);
    };
    const prioritizeSeekTarget = () => {
      setWaiting(true);
      hlsRef.current?.startLoad(videoElement.currentTime || 0);
    };
    const markReady = () => {
      setWaiting(false);
    };
    const markPlaying = () => {
      playbackStartedRef.current = true;
      setAutoplayBlocked(false);
      markReady();
    };
    const markError = () => {
      setWaiting(false);
      if (playbackStartedRef.current || (videoElement.currentTime || 0) >= 3) return;
      if (playbackErrorSentRef.current) return;
      playbackErrorSentRef.current = true;
      onErrorRef.current?.("The resolved stream could not be played.");
    };
    const restoreInitialTime = () => {
      const resumeTime = initialTimeRef.current;
      if (!resumeTime || resumeTime <= 3 || !Number.isFinite(videoElement.duration)) return;
      const targetTime = Math.min(resumeTime, Math.max(0, videoElement.duration - 5));
      if (targetTime > 3) seekTo(targetTime);
    };

    const syncNow = () => sync(true);
    const syncThrottled = () => sync(false);
    const syncProgress = () => {
      skipSmallBufferGap();
      sync(false);
    };
    videoElement.addEventListener("play", syncNow);
    videoElement.addEventListener("pause", syncNow);
    videoElement.addEventListener("timeupdate", syncThrottled);
    videoElement.addEventListener("durationchange", syncNow);
    videoElement.addEventListener("progress", syncProgress);
    videoElement.addEventListener("loadedmetadata", syncNow);
    videoElement.addEventListener("loadedmetadata", restoreInitialTime, { once: true });
    videoElement.addEventListener("volumechange", syncNow);
    videoElement.addEventListener("ratechange", syncNow);
    videoElement.addEventListener("waiting", markWaiting);
    videoElement.addEventListener("seeking", prioritizeSeekTarget);
    videoElement.addEventListener("playing", markPlaying);
    videoElement.addEventListener("canplay", markReady);
    videoElement.addEventListener("error", markError);
    sync(true);

    return () => {
      disposed = true;
      videoElement.pause();
      hlsRef.current?.destroy();
      hlsRef.current = null;
      dashRef.current?.destroy();
      dashRef.current = null;
      videoElement.removeAttribute("src");
      videoElement.load();
      videoRef.current = null;
      host.replaceChildren();
    };
  }, [poster, sourceType, src, subtitleTrackSignature]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    for (const track of Array.from(video.textTracks)) {
      track.mode = captionsEnabled ? "showing" : "disabled";
    }
  }, [captionsEnabled, subtitleTrackSignature]);

  useEffect(() => {
    if (subtitleTracks.length === 0) return;
    if (subtitleTracks.some((track) => track.default)) {
      setCaptionsEnabled(true);
    }
  }, [subtitleTrackSignature, subtitleTracks]);

  useEffect(() => {
    if (!autoPlayToken || autoPlayToken === lastAutoPlayTokenRef.current) return undefined;
    const video = videoRef.current;
    if (!video) return undefined;

    let canceled = false;
    lastAutoPlayTokenRef.current = autoPlayToken;
    const play = () => {
      if (canceled) return;
      void video.play()
        .then(() => setAutoplayBlocked(false))
        .catch((error: unknown) => {
          if (canceled) return;
          if (error instanceof DOMException && (error.name === "NotAllowedError" || error.name === "AbortError")) {
            setWaiting(false);
            setAutoplayBlocked(true);
          }
        });
    };

    play();
    video.addEventListener("canplay", play, { once: true });
    return () => {
      canceled = true;
      video.removeEventListener("canplay", play);
    };
  }, [autoPlayToken, src]);

  useEffect(() => {
    const handleFullscreenChange = () => setFullscreen(document.fullscreenElement === containerRef.current);
    document.addEventListener("fullscreenchange", handleFullscreenChange);
    return () => document.removeEventListener("fullscreenchange", handleFullscreenChange);
  }, []);

  function togglePlay() {
    const video = videoRef.current;
    if (!video) return;
    if (video.paused) {
      hlsRef.current?.startLoad(video.currentTime || -1);
      void video.play()
        .then(() => setAutoplayBlocked(false))
        .catch(() => {
          setWaiting(false);
          setAutoplayBlocked(true);
        });
    }
    else video.pause();
  }

  function seekBy(delta: number) {
    const video = videoRef.current;
    if (!video) return;
    seekTo((video.currentTime || 0) + delta);
  }

  function seekTo(value: number) {
    const video = videoRef.current;
    if (!video) return;
    const nextTime = clamp(value, 0, video.duration || duration || 0);
    if (typeof video.fastSeek === "function") {
      video.fastSeek(nextTime);
    } else {
      video.currentTime = nextTime;
    }
    setCurrentTime(nextTime);
    setControlsVisible(true);
  }

  function seekFromPointer(event: PointerEvent<HTMLDivElement>) {
    const bar = seekBarRef.current;
    const video = videoRef.current;
    const playableDuration = video?.duration || duration;
    if (!bar || !Number.isFinite(playableDuration) || playableDuration <= 0) return;
    const rect = bar.getBoundingClientRect();
    const ratio = clamp((event.clientX - rect.left) / rect.width, 0, 1);
    seekTo(ratio * playableDuration);
  }

  function handleSeekPointerDown(event: PointerEvent<HTMLDivElement>) {
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    seekFromPointer(event);
  }

  function handleSeekPointerMove(event: PointerEvent<HTMLDivElement>) {
    if (event.buttons !== 1) return;
    seekFromPointer(event);
  }

  function toggleMute() {
    const video = videoRef.current;
    if (!video) return;
    video.muted = !video.muted;
    setMuted(video.muted);
  }

  function setPlayerVolume(value: number) {
    const video = videoRef.current;
    if (!video) return;
    video.volume = value;
    video.muted = value === 0;
    setVolume(value);
    setMuted(video.muted);
  }

  function setPlayerRate(value: number) {
    const video = videoRef.current;
    if (!video) return;
    video.playbackRate = value;
    setPlaybackRate(value);
  }

  function setHlsQuality(value: number) {
    const hls = hlsRef.current;
    if (!hls) return;
    hls.currentLevel = value;
    setQualityLevel(value);
  }

  async function toggleFullscreen() {
    const element = containerRef.current;
    if (!element) return;
    if (document.fullscreenElement) await document.exitFullscreen().catch(() => undefined);
    else await element.requestFullscreen().catch(() => undefined);
  }

  function handleSurfaceClick(event: MouseEvent<HTMLDivElement>) {
    const target = event.target as HTMLElement | null;
    if (target?.closest("button,input,select,textarea,a,[data-player-control]")) return;
    togglePlay();
  }

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.tagName === "INPUT" || target?.tagName === "TEXTAREA") return;
      if (event.code === "Space") {
        event.preventDefault();
        togglePlay();
      } else if (event.key === "Escape") {
        setSettingsOpen(false);
      } else if (event.key === "ArrowLeft") {
        seekBy(-10);
      } else if (event.key === "ArrowRight") {
        seekBy(10);
      } else if (event.key.toLowerCase() === "f") {
        void toggleFullscreen();
      } else if (event.key.toLowerCase() === "m") {
        toggleMute();
      } else if (event.key.toLowerCase() === "c") {
        setCaptionsEnabled((value) => !value);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  });

  const playableDuration = Number.isFinite(duration) && duration > 0 ? duration : 0;
  const watchedPercent = playableDuration > 0 ? clamp((currentTime / playableDuration) * 100, 0, 100) : 0;
  const speedOptions = [0.75, 1, 1.25, 1.5, 2];

  return (
    <div
      ref={containerRef}
      className={clsx("group relative h-full w-full overflow-hidden bg-black text-white", className)}
      onClick={handleSurfaceClick}
      onMouseMove={() => setControlsVisible(true)}
      onMouseLeave={() => {
        if (!paused) setControlsVisible(false);
      }}
    >
      <div ref={videoHostRef} className="absolute inset-0" />

      <div className={clsx(
        "pointer-events-none absolute inset-0 z-10 flex items-end justify-start bg-[linear-gradient(90deg,rgba(0,0,0,0.58),rgba(0,0,0,0.10)_42%,rgba(0,0,0,0.18)),linear-gradient(0deg,rgba(0,0,0,0.66),rgba(0,0,0,0.10)_44%,rgba(0,0,0,0.05))] px-5 pb-36 pt-24 text-left transition-[opacity,transform,filter] duration-300 ease-out sm:px-9 sm:pb-40 lg:px-12",
        paused ? "translate-y-0 opacity-100 blur-0" : "translate-y-3 opacity-0 blur-sm",
      )}>
          <div className="max-w-[35rem]">
            {titleLogoUrl ? (
              <img
                src={balanceImageResolution(titleLogoUrl, "logo") ?? titleLogoUrl}
                alt={title}
                className="mb-3 max-h-24 w-auto max-w-[min(28rem,78vw)] object-contain drop-shadow-[0_8px_28px_rgba(0,0,0,0.72)]"
                draggable={false}
                style={titleTransitionKey ? { viewTransitionName: `spilled-title-${titleTransitionKey}` } : undefined}
              />
            ) : (
              <div className="text-4xl font-black uppercase text-white drop-shadow-[0_4px_24px_rgba(0,0,0,0.82)] sm:text-6xl" style={titleTransitionKey ? { viewTransitionName: `spilled-title-${titleTransitionKey}` } : undefined}>
                {title}
              </div>
            )}
            {renderedMetadataParts.length > 0 ? (
              <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm font-extrabold text-white drop-shadow-[0_2px_12px_rgba(0,0,0,0.78)]" style={titleTransitionKey ? { viewTransitionName: `spilled-meta-${titleTransitionKey}` } : undefined}>
                {renderedMetadataParts.map((part, index) => (
                  <span key={`${part.kind ?? "meta"}:${part.label}:${index}`} className={clsx("inline-flex items-center gap-2", part.pending && "text-white/58")}>
                    {index > 0 ? <span className="text-white/45">{"\u2022"}</span> : null}
                    {part.kind === "rating" ? <img src="/rating-icon.png" alt="" className="h-4 w-4 shrink-0" draggable={false} /> : null}
                    {part.label}
                  </span>
                ))}
              </div>
            ) : null}
            {renderedMetadataParts.length === 0 && !titleLogoUrl ? (
              <div className="mt-3 text-sm font-bold text-white/82">{title}</div>
            ) : null}
            {description ? <div className="mt-3 line-clamp-2 max-w-xl text-sm leading-5 text-white/82">{description}</div> : null}
          </div>
        </div>

      {waiting ? (
        <div className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center">
          <div className="h-10 w-10 animate-spin rounded-full border-2 border-white/20 border-t-white" />
        </div>
      ) : null}

      {paused && !waiting ? (
        <button
          type="button"
          data-player-control
          onClick={(event) => {
            event.stopPropagation();
            togglePlay();
          }}
          className="absolute left-1/2 top-1/2 z-20 flex h-16 w-16 touch-manipulation -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border border-white/20 bg-black/54 text-white shadow-[0_18px_50px_rgba(0,0,0,.48)] backdrop-blur-md transition active:scale-95 lg:hidden"
          aria-label={autoplayBlocked ? "Tap to start playback" : "Play"}
        >
          <Play className="ml-1 h-7 w-7 fill-white" strokeWidth={0} />
        </button>
      ) : null}

      <div
        data-player-control
        className={clsx(
          "absolute inset-x-0 bottom-0 z-30 px-3 pb-[max(1rem,env(safe-area-inset-bottom))] pt-8 transition-opacity duration-200 sm:px-7",
          "bg-[linear-gradient(0deg,rgba(0,0,0,0.34),rgba(0,0,0,0.16)_56%,rgba(0,0,0,0))]",
          controlsVisible || paused ? "opacity-100" : "pointer-events-none opacity-0",
        )}
      >
        <div className="mb-2 flex min-w-0 items-center gap-3 text-[11px] font-semibold text-white/70 sm:mb-3 sm:text-xs">
          <span className="truncate">{autoplayBlocked ? "Tap play to start" : sourceLabel}</span>
          <span className="ml-auto tabular-nums text-white/78">{formatClock(currentTime)} / {formatClock(duration)}</span>
        </div>

        <div
          ref={seekBarRef}
          role="slider"
          tabIndex={0}
          aria-label="Seek"
          aria-valuemin={0}
          aria-valuemax={Math.max(0, Math.round(playableDuration))}
          aria-valuenow={Math.max(0, Math.round(currentTime))}
          onPointerDown={handleSeekPointerDown}
          onPointerMove={handleSeekPointerMove}
          onKeyDown={(event) => {
            if (event.key === "ArrowLeft") seekBy(-10);
            if (event.key === "ArrowRight") seekBy(10);
          }}
          className="group/seek relative h-5 cursor-pointer touch-none"
        >
          <div className="absolute left-0 right-0 top-1/2 h-[3px] -translate-y-1/2 rounded-full bg-white/28" />
          {playableDuration > 0 ? bufferedRanges.map((range, index) => (
            <div
              key={`${range.start}:${range.end}:${index}`}
              className="absolute top-1/2 h-[3px] -translate-y-1/2 rounded-full bg-white/55"
              style={{
                left: `${(range.start / playableDuration) * 100}%`,
                width: `${Math.max(0, ((range.end - range.start) / playableDuration) * 100)}%`,
              }}
            />
          )) : null}
          <div className="absolute left-0 top-1/2 h-[3px] -translate-y-1/2 rounded-full bg-white" style={{ width: `${watchedPercent}%` }} />
          <div className="absolute top-1/2 h-4 w-4 -translate-x-1/2 -translate-y-1/2 rounded-full bg-white shadow-[0_0_16px_rgba(255,255,255,0.42)] transition-transform group-hover/seek:scale-110" style={{ left: `${watchedPercent}%` }} />
        </div>

        <div className="relative mt-2 flex items-center gap-1 sm:mt-4 sm:gap-3">
          <button type="button" onClick={togglePlay} className="flex h-11 w-11 items-center justify-center rounded-full text-white transition hover:bg-white/10" aria-label={paused ? "Play" : "Pause"}>
            {paused ? <Play className="h-6 w-6 fill-white" strokeWidth={0} /> : <Pause className="h-6 w-6 fill-white" strokeWidth={0} />}
          </button>
          <button type="button" onClick={() => seekBy(-10)} className="flex h-10 w-10 items-center justify-center rounded-full text-white/86 transition hover:bg-white/10 hover:text-white" aria-label="Back 10 seconds">
            <RotateCcw className="h-5 w-5" />
          </button>
          <button type="button" onClick={() => seekBy(10)} className="flex h-10 w-10 items-center justify-center rounded-full text-white/86 transition hover:bg-white/10 hover:text-white" aria-label="Forward 10 seconds">
            <RotateCw className="h-5 w-5" />
          </button>
          <button type="button" onClick={toggleMute} className="hidden h-10 w-10 items-center justify-center rounded-full text-white/86 transition hover:bg-white/10 hover:text-white sm:flex" aria-label={muted ? "Unmute" : "Mute"}>
            {muted || volume === 0 ? <VolumeX className="h-5 w-5" /> : <Volume2 className="h-5 w-5" />}
          </button>
          <input type="range" min={0} max={1} step={0.05} value={muted ? 0 : volume} onChange={(event) => setPlayerVolume(Number(event.target.value))} className="hidden h-1 w-24 accent-white sm:block" aria-label="Volume" />
          <div className="ml-auto flex items-center gap-0 sm:gap-2">
            <button type="button" onClick={() => setCaptionsEnabled((value) => !value)} disabled={subtitleTracks.length === 0} className={clsx("flex h-10 w-10 items-center justify-center rounded-full transition hover:bg-white/10", captionsEnabled ? "text-white" : "text-white/55", subtitleTracks.length === 0 && "cursor-not-allowed opacity-35")} aria-label="Captions">
              <Captions className="h-5 w-5" />
            </button>
            <button type="button" onClick={() => setSettingsOpen((value) => !value)} className={clsx("flex h-10 w-10 items-center justify-center rounded-full transition hover:bg-white/10 hover:text-white", settingsOpen ? "bg-white/12 text-white" : "text-white/86")} aria-label="Settings" aria-expanded={settingsOpen}>
              <Settings className="h-5 w-5" />
            </button>
            <button type="button" onClick={() => void toggleFullscreen()} className="flex h-10 w-10 items-center justify-center rounded-full text-white/86 transition hover:bg-white/10 hover:text-white" aria-label={fullscreen ? "Exit fullscreen" : "Fullscreen"}>
              {fullscreen ? <Minimize className="h-5 w-5" /> : <Maximize className="h-5 w-5" />}
            </button>
          </div>

          {settingsOpen ? (
            <div className="absolute bottom-12 right-0 w-[min(18rem,calc(100vw-1.5rem))] rounded-lg border border-white/12 bg-neutral-950/94 p-3 text-sm text-white shadow-[0_18px_60px_rgba(0,0,0,0.42)] backdrop-blur-xl">
              <div className="mb-3 flex items-center justify-between">
                <span className="text-xs font-bold uppercase tracking-[0.18em] text-white/52">Playback</span>
                <span className="text-xs font-semibold text-white/58">{formatClock(currentTime)}</span>
              </div>

              <div className="space-y-3">
                <div>
                  <div className="mb-2 text-xs font-semibold text-white/58">Speed</div>
                  <div className="grid grid-cols-5 gap-1">
                    {speedOptions.map((speed) => (
                      <button
                        key={speed}
                        type="button"
                        onClick={() => setPlayerRate(speed)}
                        className={clsx(
                          "rounded-md px-2 py-1.5 text-xs font-bold transition",
                          playbackRate === speed ? "bg-white text-black" : "bg-white/8 text-white/72 hover:bg-white/14 hover:text-white",
                        )}
                      >
                        {speed === 1 ? "1x" : `${speed}x`}
                      </button>
                    ))}
                  </div>
                </div>

                <div>
                  <div className="mb-2 text-xs font-semibold text-white/58">Quality</div>
                  <div className="grid grid-cols-2 gap-1">
                    <button
                      type="button"
                      onClick={() => setHlsQuality(-1)}
                      disabled={!hlsRef.current}
                      className={clsx(
                        "rounded-md px-2 py-1.5 text-xs font-bold transition",
                        qualityLevel === -1 ? "bg-white text-black" : "bg-white/8 text-white/72 hover:bg-white/14 hover:text-white",
                        !hlsRef.current && "cursor-not-allowed opacity-40",
                      )}
                    >
                      Auto
                    </button>
                    {qualityLevels.map((level) => (
                      <button
                        key={level.index}
                        type="button"
                        onClick={() => setHlsQuality(level.index)}
                        className={clsx(
                          "rounded-md px-2 py-1.5 text-xs font-bold transition",
                          qualityLevel === level.index ? "bg-white text-black" : "bg-white/8 text-white/72 hover:bg-white/14 hover:text-white",
                        )}
                      >
                        {level.label}
                      </button>
                    ))}
                  </div>
                </div>

                <button
                  type="button"
                  onClick={() => setCaptionsEnabled((value) => !value)}
                  disabled={subtitleTracks.length === 0}
                  className={clsx(
                    "flex w-full items-center justify-between rounded-md px-3 py-2 text-left text-xs font-bold transition",
                    captionsEnabled ? "bg-white text-black" : "bg-white/8 text-white/72 hover:bg-white/14 hover:text-white",
                    subtitleTracks.length === 0 && "cursor-not-allowed opacity-40",
                  )}
                >
                  <span>Subtitles</span>
                  <span>{subtitleTracks.length === 0 ? "Unavailable" : captionsEnabled ? "On" : "Off"}</span>
                </button>
              </div>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
