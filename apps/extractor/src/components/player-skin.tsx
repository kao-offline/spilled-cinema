"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  Captions,
  Expand,
  Pause,
  Play,
  RotateCcw,
  Settings,
  SkipBack,
  SkipForward,
  Volume2,
  VolumeX,
} from "lucide-react";
import { formatDuration } from "@/lib/utils";

const SPEED_OPTIONS = [0.75, 1, 1.25, 1.5, 2];

type PlayerSkinProps = {
  playing: boolean;
  currentTime: number;
  duration: number;
  volume: number;
  muted: boolean;
  playbackRate: number;
  subtitleEnabled: boolean;
  hasSubtitles: boolean;
  title?: string;
  onTogglePlay: () => void;
  onSeek: (time: number) => void;
  onSeekBy: (seconds: number) => void;
  onVolumeChange: (volume: number) => void;
  onToggleMute: () => void;
  onRateChange: (rate: number) => void;
  onToggleSubtitles: () => void;
  onToggleFullscreen: () => void;
};

export function PlayerSkin({
  playing,
  currentTime,
  duration,
  volume,
  muted,
  playbackRate,
  subtitleEnabled,
  hasSubtitles,
  title,
  onTogglePlay,
  onSeek,
  onSeekBy,
  onVolumeChange,
  onToggleMute,
  onRateChange,
  onToggleSubtitles,
  onToggleFullscreen,
}: PlayerSkinProps) {
  const [showControls, setShowControls] = useState(true);
  const controlsTimerRef = useRef<NodeJS.Timeout | null>(null);

  const resetTimer = useCallback(() => {
    setShowControls(true);
    if (controlsTimerRef.current) clearTimeout(controlsTimerRef.current);
    controlsTimerRef.current = setTimeout(() => {
      if (playing) setShowControls(false);
    }, 3000);
  }, [playing]);

  useEffect(() => {
    resetTimer();
    return () => {
      if (controlsTimerRef.current) clearTimeout(controlsTimerRef.current);
    };
  }, [playing, resetTimer]);

  const progress = duration ? (currentTime / duration) * 100 : 0;

  return (
    <div
      className="absolute inset-0 z-10 flex flex-col justify-end font-sans"
      style={{
        background: "linear-gradient(to top, rgba(0,0,0,0.8), transparent, rgba(0,0,0,0.1))",
        opacity: showControls || !playing ? 1 : 0,
        transition: "opacity 300ms",
        cursor: playing && !showControls ? "none" : "auto",
      }}
      onMouseMove={resetTimer}
      onMouseLeave={() => {
        if (playing && controlsTimerRef.current) {
          setShowControls(false);
        }
      }}
    >
      {/* Center Play/Pause Indicator */}
      {!playing && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-auto">
          <button
            onClick={onTogglePlay}
            className="flex h-24 w-24 items-center justify-center rounded-full bg-white/10 text-white backdrop-blur-xl transition hover:scale-110 hover:bg-white/20"
          >
            <Play className="ml-1 h-12 w-12" fill="currentColor" />
          </button>
        </div>
      )}

      {/* Fullscreen background click zone for play toggle */}
      <div
        className="absolute inset-0"
        onClick={(e) => {
          if (e.target === e.currentTarget) onTogglePlay();
        }}
      />

      {/* Top Bar - Title */}
      <div className="absolute top-0 left-0 right-0 p-8 pt-10 pointer-events-auto">
        <div className="flex items-center justify-between">
          <h2 className="text-xl font-medium tracking-tight text-white/90 drop-shadow-md">
            {title}
          </h2>
          <div className="flex gap-4">
            <button
              onClick={onToggleFullscreen}
              className="rounded-full bg-white/5 p-2 text-white/80 backdrop-blur-md transition hover:bg-white/10"
            >
              <Expand className="h-5 w-5" />
            </button>
          </div>
        </div>
      </div>
            </button>
          </div>
        </div>
      </div>

      {/* Center Play/Pause Indicator (Optional, but Netflix uses it) */}
      {!playing && (
        <div className="absolute inset-0 flex items-center justify-center">
          <button
            onClick={onTogglePlay}
            className="flex h-24 w-24 items-center justify-center rounded-full bg-white/10 text-white backdrop-blur-xl transition hover:scale-110 hover:bg-white/20"
          >
            <Play className="ml-1 h-12 w-12" fill="currentColor" />
          </button>
        </div>
      )}

      {/* Bottom Controls */}
      <div className="player-controls-reveal relative space-y-4 px-8 pb-10 pointer-events-auto">
        {/* Progress Bar */}
        <div 
          className="group/progress relative mb-4 h-1.5 w-full cursor-pointer bg-white/20 transition-all hover:h-2"
          onClick={(e) => {
            const rect = e.currentTarget.getBoundingClientRect();
            const pos = (e.clientX - rect.left) / rect.width;
            onSeek(pos * duration);
          }}
        >
          <div 
            className="absolute top-0 bottom-0 left-0 bg-[#00f2ff] shadow-[0_0_15px_rgba(0,242,255,0.6)]"
            style={{ width: `${progress}%` }}
          />
          <div 
            className="absolute top-1/2 -translate-y-1/2 h-4 w-4 scale-0 rounded-full border-2 border-white bg-[#00f2ff] shadow-xl transition-transform group-hover/progress:scale-100"
            style={{ left: `calc(${progress}% - 8px)` }}
          />
        </div>

        <div className="flex items-center justify-between text-white">
          <div className="flex items-center gap-6">
            <div className="flex items-center gap-4">
              <button onClick={() => onSeekBy(-10)} className="hover:text-[#00f2ff] transition">
                <SkipBack className="h-6 w-6" />
              </button>
              <button onClick={onTogglePlay} className="hover:scale-110 transition">
                {playing ? (
                   <Pause className="h-8 w-8" fill="currentColor" />
                ) : (
                  <Play className="h-8 w-8" fill="currentColor" />
                )}
              </button>
              <button onClick={() => onSeekBy(10)} className="hover:text-[#00f2ff] transition">
                <SkipForward className="h-6 w-6" />
              </button>
            </div>

            <div className="flex items-center gap-3">
              <button onClick={onToggleMute} className="hover:text-[#00f2ff] transition">
                {muted || volume === 0 ? <VolumeX className="h-5 w-5" /> : <Volume2 className="h-5 w-5" />}
              </button>
              <input
                type="range"
                min="0"
                max="1"
                step="0.05"
                value={muted ? 0 : volume}
                onChange={(e) => onVolumeChange(parseFloat(e.target.value))}
                className="w-24 accent-[#00f2ff] transition"
              />
            </div>

            <div className="text-sm font-medium tabular-nums text-white/80">
              {formatDuration(currentTime)} <span className="mx-1 text-white/30">/</span> {formatDuration(duration)}
            </div>
          </div>

          <div className="flex items-center gap-6">
            {hasSubtitles && (
              <button
                onClick={onToggleSubtitles}
                className={`flex items-center gap-2 rounded-full px-4 py-1.5 transition ${
                  subtitleEnabled 
                    ? "bg-[#00f2ff] text-black font-semibold" 
                    : "bg-white/5 border border-white/10 hover:bg-white/10"
                }`}
              >
                <Captions className="h-4 w-4" />
                <span className="text-xs uppercase tracking-widest">CC</span>
              </button>
            )}

            <div className="group relative">
              <button className="flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-4 py-1.5 text-xs font-semibold backdrop-blur-md transition hover:bg-white/10">
                {playbackRate}x
              </button>
              <div className="absolute bottom-full right-0 mb-4 flex flex-col overflow-hidden rounded-xl bg-black/90 p-1 opacity-0 backdrop-blur-xl transition group-hover:opacity-100">
                {SPEED_OPTIONS.map((rate) => (
                  <button
                    key={rate}
                    onClick={() => onRateChange(rate)}
                    className={`px-4 py-2 text-xs transition hover:bg-[#00f2ff] hover:text-black ${
                      playbackRate === rate ? "text-[#00f2ff]" : "text-white"
                    }`}
                  >
                    {rate}x
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
