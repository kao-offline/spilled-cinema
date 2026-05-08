"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { AlertTriangle, Captions, Clock3 } from "lucide-react";
import { fetchMediaItem } from "@/lib/library-storage";
import type { MediaItem } from "@/lib/types";
import { formatDuration } from "@/lib/utils";
import { VideoPlayer } from "@/components/video-player";

export function WatchShell({ itemId }: { itemId: string }) {
  const [item, setItem] = useState<MediaItem | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const nextItem = await fetchMediaItem(itemId);
        if (!cancelled) {
          setItem(nextItem);
        }
      } finally {
        if (!cancelled) {
          setLoaded(true);
        }
      }
    }

    void load();

    return () => {
      cancelled = true;
    };
  }, [itemId]);

  if (!loaded) {
    return (
      <div className="glass-panel rounded-[32px] border border-white/10 p-8 text-[var(--muted)]">
        Loading clean player...
      </div>
    );
  }

  if (!item) {
    return (
      <div className="glass-panel rounded-[32px] border border-red-300/20 p-8">
        <div className="flex items-center gap-3 text-red-200">
          <AlertTriangle className="h-5 w-5" />
          <span>This item is not in the library linked to this device token.</span>
        </div>
        <Link href="/" className="mt-4 inline-block text-sm text-orange-200 underline">
          Return to library
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <section className="glass-panel rounded-[36px] border border-white/10 p-7 sm:p-9">
        <div className="grid gap-5 lg:grid-cols-[1.2fr_0.8fr] lg:items-end">
          <div className="space-y-4">
            <div className="text-sm uppercase tracking-[0.24em] text-orange-200/70">
              Clean player view
            </div>
            <h1 className="text-4xl font-semibold sm:text-5xl">{item.title}</h1>
            <p className="max-w-2xl text-lg leading-8 text-[var(--muted)]">
              Rebuilt from {item.sourceHost}. Keyboard shortcuts are enabled for play, seek, mute, fullscreen, and caption toggle.
            </p>
          </div>
          <div className="grid gap-3 text-sm sm:grid-cols-3">
            <div className="rounded-[24px] border border-white/10 bg-black/20 p-4">
              <Clock3 className="mb-3 h-5 w-5 text-orange-200" />
              <div className="font-medium">{formatDuration(item.durationSeconds)}</div>
              <div className="text-[var(--muted)]">Duration</div>
            </div>
            <div className="rounded-[24px] border border-white/10 bg-black/20 p-4">
              <Captions className="mb-3 h-5 w-5 text-orange-200" />
              <div className="font-medium">{item.playback.subtitleTracks.length}</div>
              <div className="text-[var(--muted)]">Subtitle tracks</div>
            </div>
            <div className="rounded-[24px] border border-white/10 bg-black/20 p-4">
              <div className="mb-3 text-xl font-semibold text-orange-200">
                {item.playback.kind === "embed"
                  ? "Embed"
                  : item.playback.kind === "hls"
                    ? "HLS"
                    : "Direct"}
              </div>
              <div className="font-medium">{item.sourceHost}</div>
              <div className="text-[var(--muted)]">Source host</div>
            </div>
          </div>
        </div>
      </section>

      <VideoPlayer item={item} />
    </div>
  );
}
