"use client";

import Hls from "hls.js";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  readPlayerPreferences,
  updateMediaProgress,
  writePlayerPreferences,
} from "@/lib/library-storage";
import type { MediaItem, PlayerPreferences } from "@/lib/types";
import { PlayerSkin } from "./player-skin";

function EmbedPlayer({ item }: { item: MediaItem }) {
  const containerRef = useRef<HTMLDivElement>(null);

  const toggleFullscreen = () => {
    if (containerRef.current) {
      if (document.fullscreenElement) {
        document.exitFullscreen();
      } else {
        containerRef.current.requestFullscreen();
      }
    }
  };

  return (
    <div className="space-y-8">
      <div 
        ref={containerRef}
        className="player-container relative max-w-7xl mx-auto overflow-hidden rounded-[32px] border border-white/5 bg-black shadow-2xl"
      >
        <iframe
          src={item.playback.primaryUrl}
          title={item.title}
          className="aspect-video w-full bg-black"
          allow="autoplay; fullscreen; picture-in-picture"
          allowFullScreen
          referrerPolicy="no-referrer"
        />
        
        {/* Skin overlay for embeds - limited functionality */}
        <PlayerSkin
          playing={true} 
          currentTime={0}
          duration={0}
          volume={1}
          muted={false}
          playbackRate={1}
          subtitleEnabled={false}
          hasSubtitles={false}
          title={item.title}
          onTogglePlay={() => {}} 
          onSeek={() => {}}
          onSeekBy={() => {}}
          onVolumeChange={() => {}}
          onToggleMute={() => {}}
          onRateChange={() => {}}
          onToggleSubtitles={() => {}}
          onToggleFullscreen={toggleFullscreen}
        />
      </div>

      <div className="mx-auto max-w-3xl rounded-[32px] border border-white/5 bg-white/5 p-8 text-center backdrop-blur-xl">
        <h3 className="text-xl font-semibold text-white/90 mb-2 font-display">Embedded Provider Mode</h3>
        <p className="text-sm text-white/50 leading-relaxed">
          This source is opened as an external provider player. Native seek, progress sync, 
          and internal subtitle tracks are managed by the provider directly.
        </p>
      </div>
    </div>
  );
}

export function VideoPlayer({ item }: { item: MediaItem }) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const hlsRef = useRef<Hls | null>(null);
  const [ready, setReady] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(item.resumePositionSeconds || 0);
  const [duration, setDuration] = useState(item.durationSeconds ?? 0);
  const [prefs, setPrefs] = useState<PlayerPreferences>(() => readPlayerPreferences());
  const [subtitleTrackIndex, setSubtitleTrackIndex] = useState(-1);

  const subtitleTracks = item.playback.subtitleTracks;
  const subtitleEnabled = prefs.subtitleMode === "showing";

  function persistPrefs(next: PlayerPreferences) {
    writePlayerPreferences(next);
  }

  const togglePlay = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;

    if (video.paused) {
      const playPromise = video.play();
      if (playPromise !== undefined) {
        playPromise
          .catch((error) => {
            // Silently ignore AbortError - it means pause() was called while play() was pending
            if (!(error instanceof DOMException && error.name === "AbortError")) {
              console.error("Play error:", error);
            }
          });
      }
    } else {
      video.pause();
    }
  }, []);

  const seekTo = useCallback((time: number) => {
    const video = videoRef.current;
    if (!video) return;
    video.currentTime = time;
  }, []);

  const seekBy = useCallback((seconds: number) => {
    const video = videoRef.current;
    if (!video) return;
    video.currentTime = Math.max(0, Math.min(video.currentTime + seconds, video.duration || 0));
  }, []);

  const setVolume = useCallback((value: number) => {
    const video = videoRef.current;
    if (!video) return;

    video.volume = value;
    const nextPrefs = {
      ...prefs,
      volume: value,
      muted: value === 0 ? true : false,
    } satisfies PlayerPreferences;
    video.muted = nextPrefs.muted;
    persistPrefs(nextPrefs);
    setPrefs(nextPrefs);
  }, [prefs]);

  const toggleMute = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;
    video.muted = !video.muted;
    const nextPrefs = { ...prefs, muted: video.muted };
    persistPrefs(nextPrefs);
    setPrefs(nextPrefs);
  }, [prefs]);

  const changePlaybackRate = useCallback((value: number) => {
    const video = videoRef.current;
    if (!video) return;
    video.playbackRate = value;
    const nextPrefs = { ...prefs, playbackRate: value } satisfies PlayerPreferences;
    persistPrefs(nextPrefs);
    setPrefs(nextPrefs);
  }, [prefs]);

  const toggleSubtitles = useCallback(() => {
    const nextMode = subtitleEnabled ? "hidden" : "showing";
    const nextPrefs = { ...prefs, subtitleMode: nextMode } satisfies PlayerPreferences;
    persistPrefs(nextPrefs);
    setPrefs(nextPrefs);
  }, [prefs, subtitleEnabled]);

  const toggleFullscreen = useCallback(() => {
    if (!containerRef.current) return;
    if (document.fullscreenElement) {
      document.exitFullscreen();
    } else {
      containerRef.current.requestFullscreen();
    }
  }, []);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    if (item.playback.kind === "hls" && item.playback.primaryUrl.endsWith(".m3u8")) {
      if (video.canPlayType("application/vnd.apple.mpegurl")) {
        video.src = item.playback.primaryUrl;
      } else if (Hls.isSupported()) {
        const hls = new Hls();
        hls.loadSource(item.playback.primaryUrl);
        hls.attachMedia(video);
        hlsRef.current = hls;
      } else {
        video.src = item.playback.primaryUrl;
      }
    } else {
      video.src = item.playback.primaryUrl;
    }

    const handleLoadedMetadata = () => {
      if (item.resumePositionSeconds > 0 && item.resumePositionSeconds < video.duration - 4) {
        video.currentTime = item.resumePositionSeconds;
      }
      setDuration(video.duration || 0);
      setReady(true);
    };

    const handleTimeUpdate = () => setCurrentTime(video.currentTime);
    const handlePlay = () => setPlaying(true);
    const handlePause = () => setPlaying(false);

    video.addEventListener("loadedmetadata", handleLoadedMetadata);
    video.addEventListener("timeupdate", handleTimeUpdate);
    video.addEventListener("play", handlePlay);
    video.addEventListener("pause", handlePause);

    const progressInterval = window.setInterval(() => {
      if (!video.paused) {
        void updateMediaProgress(item.id, video.currentTime);
      }
    }, 5000);

    return () => {
      window.clearInterval(progressInterval);
      void updateMediaProgress(item.id, video.currentTime);
      video.removeEventListener("loadedmetadata", handleLoadedMetadata);
      video.removeEventListener("timeupdate", handleTimeUpdate);
      video.removeEventListener("play", handlePlay);
      video.removeEventListener("pause", handlePause);
      hlsRef.current?.destroy();
      hlsRef.current = null;
    };
  }, [item]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    video.volume = prefs.volume;
    video.muted = prefs.muted;
    video.playbackRate = prefs.playbackRate;
  }, [prefs]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.target instanceof HTMLInputElement || event.target instanceof HTMLSelectElement) return;

      switch (event.key.toLowerCase()) {
        case " ": event.preventDefault(); void togglePlay(); break;
        case "arrowleft": event.preventDefault(); seekBy(-10); break;
        case "arrowright": event.preventDefault(); seekBy(10); break;
        case "arrowup": event.preventDefault(); setVolume(Math.min(videoRef.current?.volume || 0 + 0.05, 1)); break;
        case "arrowdown": event.preventDefault(); setVolume(Math.max(videoRef.current?.volume || 0 - 0.05, 0)); break;
        case "m": toggleMute(); break;
        case "f": toggleFullscreen(); break;
        case "c": toggleSubtitles(); break;
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [togglePlay, seekBy, setVolume, toggleMute, toggleFullscreen, toggleSubtitles]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    Array.from(video.textTracks).forEach((track, index) => {
      const isPreferred = subtitleTrackIndex === -1 ? Boolean(track.language || index === 0) : index === subtitleTrackIndex;
      track.mode = subtitleEnabled && isPreferred ? "showing" : "hidden";
    });
  }, [subtitleEnabled, subtitleTrackIndex, ready]);

  if (item.playback.kind === "embed") {
    return <EmbedPlayer item={item} />;
  }

  return (
    <div className="space-y-8">
      <div 
        ref={containerRef}
        className="relative max-w-7xl mx-auto overflow-hidden rounded-[32px] border border-white/5 bg-black shadow-2xl"
        style={{ aspectRatio: "16 / 9" }}
      >
        <video
          ref={videoRef}
          className="absolute inset-0 w-full h-full bg-black"
          playsInline
          preload="metadata"
          crossOrigin="anonymous"
          style={{ pointerEvents: "none" }}
        >
          {subtitleTracks.map((track) => (
            <track
              key={track.url}
              src={track.url}
              label={track.label}
              srcLang={track.srclang}
              kind={track.kind || "subtitles"}
              default={track.default}
            />
          ))}
        </video>

        <PlayerSkin
          playing={playing}
          currentTime={currentTime}
          duration={duration}
          volume={prefs.volume}
          muted={prefs.muted}
          playbackRate={prefs.playbackRate}
          subtitleEnabled={subtitleEnabled}
          hasSubtitles={subtitleTracks.length > 0}
          title={item.title}
          onTogglePlay={togglePlay}
          onSeek={seekTo}
          onSeekBy={seekBy}
          onVolumeChange={setVolume}
          onToggleMute={toggleMute}
          onRateChange={changePlaybackRate}
          onToggleSubtitles={toggleSubtitles}
          onToggleFullscreen={toggleFullscreen}
        />
      </div>
    </div>
  );
}

