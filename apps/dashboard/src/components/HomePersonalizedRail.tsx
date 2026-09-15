import { Check, CircleAlert, LoaderCircle, Play, RefreshCw } from "lucide-react";
import { clsx } from "clsx";
import { useEffect, useId, useState } from "react";
import { fetchEpisodePreviews, type EpisodePreview } from "../lib/import-client";
import { getPlaybackProgressColor, type RecommendedWatchItem } from "../lib/home-personalization";
import { balanceImageResolution } from "../lib/image-resolution";
import { formatEpisodeTitle } from "../lib/episode-title";
import { getShowArtwork } from "../lib/media-library";

type FreshnessState = {
  checking: boolean;
  message: string | null;
  error: boolean;
};

type HomePersonalizedRailProps = {
  items: RecommendedWatchItem[];
  freshness: FreshnessState;
  onRetry: () => void;
  onPlay: (item: RecommendedWatchItem) => void;
  compact?: boolean;
};

function formatDate(value: number) {
  return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" }).format(new Date(value));
}

function formatAirDate(value: string) {
  const timestamp = Date.parse(`${value}T00:00:00`);
  return Number.isFinite(timestamp) ? formatDate(timestamp) : value;
}

function formatTime(value: number) {
  if (!Number.isFinite(value) || value <= 0) return null;
  const minutes = Math.floor(value / 60);
  const seconds = Math.floor(value % 60);
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

function artworkFor(item: RecommendedWatchItem, preview?: EpisodePreview) {
  const artwork = getShowArtwork(item.show);
  return balanceImageResolution(
    preview?.stillUrl ?? item.episode.posterUrl ?? artwork.bannerWithLogoUrl ?? artwork.bannerUrl ?? artwork.posterUrl ?? null,
    "backdrop-thumb",
  );
}

function episodeCode(item: RecommendedWatchItem) {
  if (item.show.mediaType === "movie" || item.episode.episodeCode === "movie") return "Film";
  const season = Math.max(1, item.episode.seasonNumber || 1);
  return item.episode.episodeNumber ? `S${season} E${item.episode.episodeNumber}` : `Season ${season}`;
}

function EmptyRecommendations({ freshness, onRetry, compact }: { freshness: FreshnessState; onRetry: () => void; compact?: boolean }) {
  return (
    <div className={clsx(
      "mx-4 flex min-h-20 gap-3 rounded-2xl border border-white/[0.08] bg-white/[0.035] px-4 sm:mx-10 lg:mx-16",
      compact ? "flex-col items-stretch py-4" : "items-center justify-between",
    )}>
      <div className="flex min-w-0 items-center gap-3">
        <div className={clsx("flex h-9 w-9 shrink-0 items-center justify-center rounded-full", freshness.error ? "bg-red-400/12 text-red-200" : "bg-white/[0.07] text-white/55")}>
          {freshness.checking ? <LoaderCircle className="h-4 w-4 animate-spin" /> : freshness.error ? <CircleAlert className="h-4 w-4" /> : <Check className="h-4 w-4" />}
        </div>
        <div className="min-w-0">
          <p className="text-sm font-bold text-white/85">{freshness.checking ? "Checking connected sources" : freshness.error ? "Updates could not be checked" : "You’re all caught up"}</p>
          <p className="mt-1 text-xs leading-5 text-white/42">{freshness.message ?? "Watch something and your next episode will appear here."}</p>
        </div>
      </div>
      {!freshness.checking ? (
        <button type="button" onClick={onRetry} className={clsx("inline-flex min-h-11 shrink-0 items-center justify-center gap-2 rounded-full bg-white/9 px-4 text-xs font-bold text-white transition hover:bg-white/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70", compact && "ml-12 self-start")}>
          <RefreshCw className="h-3.5 w-3.5" /> {freshness.error ? "Retry" : "Check again"}
        </button>
      ) : null}
    </div>
  );
}

export function HomePersonalizedRail(props: HomePersonalizedRailProps) {
  const headingId = useId();
  const [previews, setPreviews] = useState<Record<string, EpisodePreview>>({});
  useEffect(() => {
    let canceled = false;
    const groups = Array.from(new Map(props.items.filter((item) => item.show.mediaType !== "movie").map((item) => [`${item.show.slug}:${item.episode.seasonNumber}`, item])).values());
    let cursor = 0;
    const worker = async () => {
      while (!canceled && cursor < groups.length) {
        const item = groups[cursor++];
        try {
          const result = await fetchEpisodePreviews(item.show, item.episode.seasonNumber);
          if (!canceled) setPreviews((current) => ({ ...current, ...Object.fromEntries(result.map((preview) => [`${item.show.slug}:${item.episode.seasonNumber}:${preview.episodeNumber}`, preview])) }));
        } catch { /* Artwork is optional; saved metadata remains usable offline. */ }
      }
    };
    void Promise.all(Array.from({ length: Math.min(2, groups.length) }, worker));
    return () => { canceled = true; };
  }, [props.items]);
  return (
    <section className={clsx("ui-virtual-section", props.compact ? "py-1.5" : "py-2.5")} aria-labelledby={headingId} aria-busy={props.freshness.checking}>
      <div className={clsx("mb-2.5 flex items-end justify-between gap-3", props.compact ? "px-4" : "px-5 sm:px-10 lg:px-16")}>
        <h2 id={headingId} className="text-[17px] font-black tracking-[-0.025em] text-white sm:text-lg">Up Next for You</h2>
        <button
          type="button"
          onClick={props.onRetry}
          disabled={props.freshness.checking}
          className="inline-flex min-h-11 items-center gap-2 rounded-full px-3 text-xs font-bold text-white/55 transition hover:bg-white/8 hover:text-white disabled:cursor-wait disabled:opacity-45 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70"
          aria-label="Check connected sources for new episodes"
        >
          <RefreshCw className={clsx("h-3.5 w-3.5", props.freshness.checking && "animate-spin")} />
          <span className="hidden sm:inline">{props.freshness.checking ? "Checking" : "Refresh"}</span>
        </button>
      </div>

      {props.items.length === 0 ? <EmptyRecommendations freshness={props.freshness} onRetry={props.onRetry} compact={props.compact} /> : (
        <div className={clsx("no-scrollbar flex snap-x snap-mandatory gap-2.5 overflow-x-auto pb-2.5", props.compact ? "px-4" : "px-5 sm:px-10 lg:px-16")}>
          {props.items.map((item) => {
            const preview = previews[`${item.show.slug}:${item.episode.seasonNumber}:${item.episode.episodeNumber}`];
            const image = artworkFor(item, preview);
            const logo = balanceImageResolution(getShowArtwork(item.show).clearLogoUrl ?? null, "logo");
            const progress = item.progressPercent;
            const action = item.resumeAtSeconds > 0
              ? `Continue at ${formatTime(item.resumeAtSeconds)}`
              : item.reason === "recently-finished"
                ? "Next episode"
                : item.reason === "new-series" ? "Start series" : "Continue watching";
            const date = item.reason === "new-series"
              ? preview?.airDate ? formatAirDate(preview.airDate) : formatDate(item.updatedAt)
              : null;
            const episodeTitle = formatEpisodeTitle(item.episode);
            const showEpisodeTitle = episodeTitle.toLowerCase() !== item.show.title.toLowerCase();
            return (
              <button
                key={`${item.show.slug}:${item.episode.id}`}
                type="button"
                onClick={() => props.onPlay(item)}
                className={clsx(
                  "group relative aspect-video w-[72vw] max-w-[282px] shrink-0 snap-start overflow-hidden rounded-[18px] border border-white/[0.09] bg-[#111319] text-left shadow-[0_10px_24px_rgba(0,0,0,.24)] transition sm:w-[258px] lg:w-[266px]",
                  "hover:-translate-y-0.5 hover:border-white/16 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/75 active:scale-[0.985]",
                )}
                aria-label={`${item.resumeAtSeconds > 0 ? "Resume" : "Play"} ${item.show.title}, ${formatEpisodeTitle(item.episode)}${date ? `, ${preview?.airDate ? "released" : "added"} ${date}` : ""}`}
              >
                {image ? <img src={image} alt="" className="absolute inset-0 h-full w-full object-cover transition duration-500 group-hover:scale-[1.025]" loading="lazy" decoding="async" /> : null}
                <div className="absolute inset-0 bg-gradient-to-t from-black/72 via-transparent to-black/12" />

                <div className="absolute left-0 top-0 max-w-[88%] rounded-br-[20px] bg-[#080a0d]/94 px-3 pb-2.5 pt-2.5 pr-5 shadow-[8px_8px_24px_rgba(0,0,0,.24)]">
                  <div className="flex min-w-0 items-baseline gap-1.5">
                    <span className="truncate text-[13px] font-black leading-none text-white">{item.show.title}</span>
                    <span className="shrink-0 text-[10px] font-black uppercase leading-none text-white/45">{episodeCode(item)}</span>
                  </div>
                  {showEpisodeTitle ? <p className="mt-1 truncate text-[10px] font-semibold leading-none text-white/48">{episodeTitle}</p> : null}
                </div>

                <div className={clsx("absolute bottom-2.5 left-2.5 flex items-center gap-1.5 rounded-full border border-white/10 bg-black/72 px-2.5 py-1.5 text-[8px] font-black uppercase tracking-[.1em] text-white/80 shadow-lg", logo ? "max-w-[68%]" : "max-w-[88%]")}>
                  <Play className="h-2.5 w-2.5 shrink-0 fill-current" />
                  <span className="truncate">{action}</span>
                  {date ? <><span className="text-white/25">·</span><span className="truncate text-white/42">{date}</span></> : null}
                </div>

                {logo ? (
                  <div className="absolute bottom-2.5 right-2.5 flex h-8 max-w-[28%] items-center justify-center rounded-lg bg-black/66 px-2">
                    <img src={logo} alt="" className="max-h-5 max-w-full object-contain brightness-0 invert opacity-90" loading="lazy" decoding="async" />
                  </div>
                ) : null}

                {progress > 0 ? <div className="absolute inset-x-0 bottom-0 h-[3px] bg-white/16" role="progressbar" aria-label={`${progress}% watched`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={progress}><div className="h-full" style={{ width: `${progress}%`, backgroundColor: getPlaybackProgressColor(item.episode) }} /></div> : null}
              </button>
            );
          })}
        </div>
      )}

      {props.freshness.message && props.items.length > 0 ? (
        <p className={clsx("mt-1 text-xs font-semibold", props.compact ? "px-4" : "px-5 sm:px-10 lg:px-16", props.freshness.error ? "text-red-200/80" : "text-white/36")} role={props.freshness.error ? "alert" : "status"}>
          {props.freshness.message}
        </p>
      ) : null}
    </section>
  );
}
