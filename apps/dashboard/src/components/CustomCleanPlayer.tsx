import { useEffect, useMemo, useRef, useState } from "react";
import { Captions, Cloud, Maximize, Minimize, Pause, Play, RotateCcw, RotateCw, Settings, Volume2, VolumeX } from "lucide-react";
import Hls from "hls.js";
import { clsx } from "clsx";

type SubtitleTrack = {
  src: string;
  label: string;
  srclang: string;
  default?: boolean;
};

type CustomCleanPlayerProps = {
  src: string;
  poster?: string | null;
  title: string;
  subtitle?: string;
  description?: string | null;
  sourceLabel?: string;
  className?: string;
  subtitleTracks?: SubtitleTrack[];
};

function getSourceType(src: string) {
  if (/\/api\/download-full\/browser-file\?/i.test(src)) {
    try {
      const parsed = new URL(src, window.location.origin);
      const proxiedUrl = parsed.searchParams.get("url") ?? "";
      const name = parsed.searchParams.get("name") ?? "";
      if (/\.mp4(?:$|[?#])|\/get_video\?/i.test(proxiedUrl) || /\.mp4$/i.test(name)) {
        return "video/mp4";
      }
      if (/\.m3u8(?:$|[?#])|\/hls3\//i.test(proxiedUrl) || /\.m3u8$/i.test(name)) {
        return "application/x-mpegURL";
      }
    } catch {
      return undefined;
    }
  }
  if (/\.m3u8(?:$|[?#])|\/hls3\//i.test(src)) {
    return "application/x-mpegURL";
  }
  if (/\.mp4(?:$|[?#])|\/get_video\?/i.test(src)) {
    return "video/mp4";
  }
  if (/\/api\/download-full\/file\?/i.test(src)) {
    return "video/mp4";
  }
  return undefined;
}

function formatClock(value: number) {
  if (!Number.isFinite(value) || value <= 0) {
    return "0:00";
  }

  const total = Math.floor(value);
  const seconds = total % 60;
  const minutes = Math.floor(total / 60) % 60;
  const hours = Math.floor(total / 3600);
  const paddedSeconds = seconds.toString().padStart(2, "0");
  const paddedMinutes = hours > 0 ? minutes.toString().padStart(2, "0") : minutes.toString();
  return hours > 0 ? `${hours}:${paddedMinutes}:${paddedSeconds}` : `${paddedMinutes}:${paddedSeconds}`;
}

export function CustomCleanPlayer({
  src,
  poster,
  title,
  subtitle,
  description,
  sourceLabel = "Clean player",
  className,
  subtitleTracks = [],
}: CustomCleanPlayerProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const videoHostRef = useRef<HTMLDivElement | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const hlsRef = useRef<Hls | null>(null);
  const [paused, setPaused] = useState(true);
  const [waiting, setWaiting] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(1);
  const [muted, setMuted] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const [controlsVisible, setControlsVisible] = useState(true);
  const sourceType = useMemo(() => getSourceType(src), [src]);

  useEffect(() => {
    const host = videoHostRef.current;
    if (!host) {
      return undefined;
    }

    host.replaceChildren();
    const videoElement = document.createElement("video");
    videoElement.className = "h-full w-full object-contain";
    videoElement.playsInline = true;
    videoElement.preload = "auto";
    if (poster) {
      videoElement.poster = poster;
    }

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

    if (sourceType === "application/x-mpegURL" && Hls.isSupported()) {
      const hls = new Hls({
        enableWorker: true,
        lowLatencyMode: false,
      });
      hlsRef.current = hls;
      hls.loadSource(src);
      hls.attachMedia(videoElement);
    } else {
      videoElement.src = src;
    }

    const sync = () => {
      setPaused(videoElement.paused);
      setCurrentTime(videoElement.currentTime || 0);
      setDuration(videoElement.duration || 0);
      setVolume(videoElement.volume || 1);
      setMuted(videoElement.muted);
    };
    const markWaiting = () => setWaiting(true);
    const markReady = () => setWaiting(false);

    videoElement.addEventListener("play", sync);
    videoElement.addEventListener("pause", sync);
    videoElement.addEventListener("timeupdate", sync);
    videoElement.addEventListener("durationchange", sync);
    videoElement.addEventListener("volumechange", sync);
    videoElement.addEventListener("waiting", markWaiting);
    videoElement.addEventListener("playing", markReady);
    videoElement.addEventListener("canplay", markReady);
    sync();

    return () => {
      videoElement.pause();
      videoElement.removeAttribute("src");
      videoElement.load();
      hlsRef.current?.destroy();
      hlsRef.current = null;
      videoRef.current = null;
      host.replaceChildren();
    };
  }, [poster, sourceType, src, subtitleTracks]);

  useEffect(() => {
    const handleFullscreenChange = () => setFullscreen(document.fullscreenElement === containerRef.current);
    document.addEventListener("fullscreenchange", handleFullscreenChange);
    return () => document.removeEventListener("fullscreenchange", handleFullscreenChange);
  }, []);

  function togglePlay() {
    const video = videoRef.current;
    if (!video) {
      return;
    }
    if (video.paused) {
      void video.play();
    } else {
      video.pause();
    }
  }

  function seekBy(delta: number) {
    const video = videoRef.current;
    if (!video) {
      return;
    }
    const nextTime = Math.max(0, Math.min(video.duration || 0, (video.currentTime || 0) + delta));
    video.currentTime = nextTime;
  }

  function seekTo(value: number) {
    const video = videoRef.current;
    if (!video) {
      return;
    }
    video.currentTime = value;
  }

  function toggleMute() {
    const video = videoRef.current;
    if (!video) {
      return;
    }
    video.muted = !video.muted;
    setMuted(video.muted);
  }

  function setPlayerVolume(value: number) {
    const video = videoRef.current;
    if (!video) {
      return;
    }
    video.volume = value;
    video.muted = value === 0;
    setVolume(value);
    setMuted(video.muted);
  }

  async function toggleFullscreen() {
    const element = containerRef.current;
    if (!element) {
      return;
    }
    if (document.fullscreenElement) {
      await document.exitFullscreen().catch(() => undefined);
    } else {
      await element.requestFullscreen().catch(() => undefined);
    }
  }

  return (
    <div
      ref={containerRef}
      className={clsx("group relative h-full w-full overflow-hidden bg-black text-white", className)}
      onMouseMove={() => setControlsVisible(true)}
      onMouseLeave={() => {
        if (!paused) setControlsVisible(false);
      }}
    >
      <div ref={videoHostRef} className="absolute inset-0" />

      {paused ? (
        <button
          type="button"
          onClick={togglePlay}
          className="absolute inset-0 z-10 flex items-end justify-start bg-gradient-to-t from-black via-black/35 to-black/10 px-7 py-24 text-left sm:px-10 lg:px-12"
          aria-label="Play"
        >
          <span className="max-w-2xl">
            <span className="mb-4 inline-flex h-14 w-14 items-center justify-center rounded-full bg-white text-black shadow-2xl">
              <Play className="h-6 w-6 fill-black" strokeWidth={0} />
            </span>
            <span className="block text-4xl font-black uppercase tracking-tight text-white drop-shadow-[0_4px_24px_rgba(0,0,0,0.9)] sm:text-6xl">
              {title}
            </span>
            {subtitle ? <span className="mt-3 block text-sm font-semibold text-white/72">{subtitle}</span> : null}
            {description ? <span className="mt-4 line-clamp-2 block max-w-xl text-sm leading-6 text-white/68">{description}</span> : null}
          </span>
        </button>
      ) : null}

      {waiting ? (
        <div className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center">
          <div className="h-10 w-10 animate-spin rounded-full border-2 border-white/20 border-t-white" />
        </div>
      ) : null}

      <div
        className={clsx(
          "absolute inset-x-0 bottom-0 z-30 bg-gradient-to-t from-black via-black/70 to-transparent px-4 pb-4 pt-14 transition-opacity duration-200 sm:px-7",
          controlsVisible || paused ? "opacity-100" : "opacity-0",
        )}
      >
        <div className="mb-3 flex items-center gap-3 text-xs font-semibold text-white/70">
          <Cloud className="h-4 w-4 text-white/72" />
          <span>{sourceLabel}</span>
          <span className="ml-auto tabular-nums text-white/78">
            {formatClock(currentTime)} / {formatClock(duration)}
          </span>
        </div>

        <input
          type="range"
          min={0}
          max={duration || 0}
          step={0.1}
          value={Math.min(currentTime, duration || currentTime)}
          onChange={(event) => seekTo(Number(event.target.value))}
          className="h-1 w-full accent-white"
          aria-label="Seek"
        />

        <div className="mt-4 flex items-center gap-3">
          <button type="button" onClick={togglePlay} className="flex h-11 w-11 items-center justify-center rounded-full text-white transition hover:bg-white/10" aria-label={paused ? "Play" : "Pause"}>
            {paused ? <Play className="h-6 w-6 fill-white" strokeWidth={0} /> : <Pause className="h-6 w-6 fill-white" strokeWidth={0} />}
          </button>
          <button type="button" onClick={() => seekBy(-10)} className="flex h-10 w-10 items-center justify-center rounded-full text-white/86 transition hover:bg-white/10 hover:text-white" aria-label="Back 10 seconds">
            <RotateCcw className="h-5 w-5" />
          </button>
          <button type="button" onClick={() => seekBy(10)} className="flex h-10 w-10 items-center justify-center rounded-full text-white/86 transition hover:bg-white/10 hover:text-white" aria-label="Forward 10 seconds">
            <RotateCw className="h-5 w-5" />
          </button>
          <button type="button" onClick={toggleMute} className="flex h-10 w-10 items-center justify-center rounded-full text-white/86 transition hover:bg-white/10 hover:text-white" aria-label={muted ? "Unmute" : "Mute"}>
            {muted || volume === 0 ? <VolumeX className="h-5 w-5" /> : <Volume2 className="h-5 w-5" />}
          </button>
          <input
            type="range"
            min={0}
            max={1}
            step={0.05}
            value={muted ? 0 : volume}
            onChange={(event) => setPlayerVolume(Number(event.target.value))}
            className="hidden h-1 w-24 accent-white sm:block"
            aria-label="Volume"
          />
          <div className="ml-auto flex items-center gap-2">
            <button type="button" className="flex h-10 w-10 items-center justify-center rounded-full text-white/86 transition hover:bg-white/10 hover:text-white" aria-label="Captions">
              <Captions className="h-5 w-5" />
            </button>
            <button type="button" className="flex h-10 w-10 items-center justify-center rounded-full text-white/86 transition hover:bg-white/10 hover:text-white" aria-label="Settings">
              <Settings className="h-5 w-5" />
            </button>
            <button type="button" onClick={() => void toggleFullscreen()} className="flex h-10 w-10 items-center justify-center rounded-full text-white/86 transition hover:bg-white/10 hover:text-white" aria-label={fullscreen ? "Exit fullscreen" : "Fullscreen"}>
              {fullscreen ? <Minimize className="h-5 w-5" /> : <Maximize className="h-5 w-5" />}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
