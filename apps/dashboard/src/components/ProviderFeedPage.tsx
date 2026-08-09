import { ExternalLink, Layers3, LoaderCircle, Plus, RefreshCw, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { clsx } from "clsx";
import type { ExploreItem, ProviderFeedManifest, ProviderModuleManifest } from "../lib/types";
import { formatEpisodeTitle } from "../lib/episode-title";

type ProviderFeedPageProps = {
  module: ProviderModuleManifest;
  feed: ProviderFeedManifest;
  items: ExploreItem[];
  query: string;
  animeFilterMode: AnimeFilterMode;
  onAnimeFilterModeChange: (mode: AnimeFilterMode) => void;
  loading: boolean;
  error: string | null;
  stale: boolean;
  generatedAt: number | null;
  continueCursor: string | null;
  onRefresh: () => void;
  onLoadMore: () => void;
  onImport: (item: ExploreItem) => void;
  onOpenVault: (item: ExploreItem) => void;
};

type FeedWeekGroup = {
  id: string;
  label: string;
  dateLabel: string;
  items: ExploreItem[];
};

type AnimeFilterMode = "all" | "anime" | "no-anime";

const FEED_CHUNK_SIZE = 8;

function buildEpisodeLabel(item: ExploreItem) {
  if (!item.episode) return "";
  return formatEpisodeTitle({
    showTitle: item.title,
    episodeTitle: item.episode.episodeTitle ?? null,
    episodeCode: item.episode.episodeCode ?? null,
    episodeNumber: item.episode.episodeNumber ?? null,
  });
}

function isAnimeItem(item: ExploreItem) {
  return item.title.toLowerCase().includes("anime") || item.genres.some((genre) => genre.toLowerCase().includes("anime"));
}

function getWeekMarkerLabel(index: number) {
  if (index === 0) {
    return "This Week";
  }
  if (index === 1) {
    return "Last Week";
  }
  return `Week ${index + 1}`;
}

function getWeekDateLabel(referenceTime: number, index: number) {
  const weekDate = new Date(referenceTime - index * 7 * 24 * 60 * 60 * 1000);
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
  }).format(weekDate);
}

function groupItemsByWeek(items: ExploreItem[], generatedAt: number | null) {
  const referenceTime = generatedAt ?? Date.now();
  const groups: FeedWeekGroup[] = [];

  for (let index = 0; index < items.length; index += FEED_CHUNK_SIZE) {
    const weekIndex = Math.floor(index / FEED_CHUNK_SIZE);
    groups.push({
      id: `week-${weekIndex}`,
      label: getWeekMarkerLabel(weekIndex),
      dateLabel: getWeekDateLabel(referenceTime, weekIndex),
      items: items.slice(index, index + FEED_CHUNK_SIZE),
    });
  }

  return groups;
}

function looksLikeFeedBanner(url: string | null | undefined) {
  if (!url) {
    return false;
  }
  return /\/wallpapers?\//i.test(url) || /\/uploads\/wallpapers?\//i.test(url);
}

function getFeedArtwork(item: ExploreItem) {
  const src = item.posterUrl ?? item.backdropUrl ?? null;
  return {
    src,
    isBannerLike: looksLikeFeedBanner(src),
  };
}

function ProviderFeedItemCard({
  item,
  providerLabel,
  onClick,
}: {
  item: ExploreItem;
  providerLabel: string;
  onClick: (item: ExploreItem) => void;
}) {
  const artwork = getFeedArtwork(item);
  const episodeLabel = buildEpisodeLabel(item);

  return (
    <button
      type="button"
      onClick={() => onClick(item)}
      className="group relative overflow-hidden rounded-[24px] border border-white/8 bg-[#11141b] text-left shadow-[0_20px_52px_rgba(0,0,0,0.24)] transition-all duration-500 hover:-translate-y-1 hover:border-white/18"
    >
      <div className="relative aspect-[2/3] overflow-hidden">
        {artwork.src ? (
          <>
            <img
              src={artwork.src}
              alt=""
              aria-hidden="true"
              className="absolute inset-0 h-full w-full scale-110 object-cover object-center opacity-26 blur-2xl transition-transform duration-700 group-hover:scale-[1.14]"
            />
            <div className="absolute inset-[10px] overflow-hidden rounded-[18px] border border-white/8 bg-black/24">
              <img
                src={artwork.src}
                alt={item.title}
                className={clsx(
                  "absolute inset-0 h-full w-full transition-transform duration-700 group-hover:scale-[1.03]",
                  artwork.isBannerLike ? "object-contain object-center p-1.5" : "object-cover object-center",
                )}
              />
            </div>
          </>
        ) : (
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_top,#334054,#11141b)]" />
        )}
        <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(8,10,14,0.05),rgba(8,10,14,0.18)_34%,rgba(8,10,14,0.76)_82%,rgba(8,10,14,0.96)_100%)]" />
        <div className="absolute left-3 top-3 rounded-full border border-white/12 bg-black/36 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-white/68 backdrop-blur">
          {providerLabel}
        </div>
        {item.inVault ? (
          <div className="absolute right-3 top-3 rounded-full border border-emerald-400/18 bg-emerald-400/12 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-emerald-200 backdrop-blur">
            In Vault
          </div>
        ) : null}
        <div className="absolute inset-x-4 bottom-4">
          <div className="text-[1rem] font-semibold leading-[1.06] tracking-[-0.03em] text-white">
            {item.title}
          </div>
          <div className="mt-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-white/62">
            {episodeLabel || item.yearLabel || "Episode update"}
          </div>
          {item.description ? (
            <p className="mt-2 line-clamp-2 max-w-2xl text-sm leading-5 text-white/52">{item.description}</p>
          ) : null}
        </div>
      </div>
    </button>
  );
}

function ProviderFeedItemModal({
  item,
  providerLabel,
  onClose,
  onImport,
  onOpenVault,
}: {
  item: ExploreItem | null;
  providerLabel: string;
  onClose: () => void;
  onImport: (item: ExploreItem) => void;
  onOpenVault: (item: ExploreItem) => void;
}) {
  if (!item || typeof document === "undefined") {
    return null;
  }

  const artwork = getFeedArtwork(item);
  const metadata = [
    item.episode ? formatEpisodeTitle({
      showTitle: item.title,
      episodeTitle: item.episode.episodeTitle ?? null,
      episodeCode: item.episode.episodeCode ?? null,
      episodeNumber: item.episode.episodeNumber ?? null,
    }) : null,
    item.yearLabel,
    providerLabel,
  ]
    .map((value) => String(value || "").trim())
    .filter(Boolean);

  return createPortal(
    <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/72 px-4 py-8 backdrop-blur-md" onClick={onClose}>
      <div
        className="relative w-full max-w-4xl overflow-hidden rounded-[30px] border border-white/10 bg-[#0f1219] shadow-[0_30px_90px_rgba(0,0,0,0.42)]"
        onClick={(event) => event.stopPropagation()}
      >
        <button
          type="button"
          onClick={onClose}
          className="absolute right-4 top-4 z-10 inline-flex h-10 w-10 items-center justify-center rounded-full border border-white/10 bg-black/36 text-white/72 transition-colors hover:text-white"
          aria-label="Close details"
        >
          <X className="h-4 w-4" />
        </button>
        <div className="grid min-h-[24rem] lg:grid-cols-[minmax(0,1.1fr)_minmax(22rem,0.9fr)]">
          <div className="relative min-h-[16rem]">
            {artwork.src ? (
              <>
                <img
                  src={artwork.src}
                  alt=""
                  aria-hidden="true"
                  className="absolute inset-0 h-full w-full scale-110 object-cover object-center opacity-30 blur-2xl"
                />
                <img
                  src={artwork.src}
                  alt={item.title}
                  className={clsx(
                    "absolute inset-0 h-full w-full",
                    artwork.isBannerLike ? "object-contain object-center p-4" : "object-cover object-center",
                  )}
                />
              </>
            ) : (
              <div className="absolute inset-0 bg-[radial-gradient(circle_at_top,#283041,#0f1219)]" />
            )}
            <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(8,10,14,0.08),rgba(8,10,14,0.34)_40%,rgba(8,10,14,0.88)_100%)]" />
          </div>
          <div className="relative p-6 lg:p-8">
            <div className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-white/60">
              {providerLabel}
            </div>
            <h2 className="mt-5 text-3xl font-semibold tracking-[-0.04em] text-white">{item.title}</h2>
            {metadata.length > 0 ? (
              <div className="mt-3 flex flex-wrap gap-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-white/42">
                {metadata.map((entry) => (
                  <span key={entry}>{entry}</span>
                ))}
              </div>
            ) : null}
            <p className="mt-5 text-sm leading-6 text-white/62">
              {item.description?.trim() || "This provider item does not include a longer description yet."}
            </p>

            <div className="mt-6 flex flex-wrap gap-2">
              {item.audioBuckets.map((bucket) => (
                <span key={bucket} className="rounded-full border border-white/8 bg-white/[0.04] px-3 py-1 text-[10px] font-medium uppercase tracking-[0.16em] text-white/56">
                  {bucket.replace(/_/g, " ")}
                </span>
              ))}
            </div>

            <div className="mt-8 grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto]">
              {item.inVault ? (
                <button
                  type="button"
                  onClick={() => {
                    onOpenVault(item);
                    onClose();
                  }}
                  className="inline-flex items-center justify-center gap-2 rounded-full border border-white/10 bg-white/[0.05] px-5 py-3 text-[11px] font-semibold uppercase tracking-[0.18em] text-white/82 transition-colors hover:bg-white/[0.08]"
                >
                  <Layers3 className="h-4 w-4" />
                  Open In Library
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => {
                    onImport(item);
                    onClose();
                  }}
                  className="inline-flex items-center justify-center gap-2 rounded-full bg-white px-5 py-3 text-[11px] font-semibold uppercase tracking-[0.18em] text-black transition-colors hover:bg-white/90"
                >
                  <Plus className="h-4 w-4" />
                  Import To Library
                </button>
              )}

              <a
                href={item.detailUrl}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center justify-center gap-2 rounded-full border border-white/10 bg-white/[0.05] px-5 py-3 text-[11px] font-semibold uppercase tracking-[0.18em] text-white/72 transition-colors hover:bg-white/[0.08] hover:text-white"
              >
                <ExternalLink className="h-4 w-4" />
                Open Source
              </a>
            </div>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}

export function ProviderFeedPage({
  module,
  items,
  query,
  animeFilterMode,
  onAnimeFilterModeChange,
  loading,
  error,
  generatedAt,
  continueCursor,
  onRefresh,
  onLoadMore,
  onImport,
  onOpenVault,
}: ProviderFeedPageProps) {
  const [selectedItem, setSelectedItem] = useState<ExploreItem | null>(null);
  const [visibleCount, setVisibleCount] = useState(FEED_CHUNK_SIZE);
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  const providerLabel = module.displayName;
  const filteredItems = useMemo(() => {
    if (animeFilterMode === "all") {
      return items;
    }
    return items.filter((item) => (animeFilterMode === "anime" ? isAnimeItem(item) : !isAnimeItem(item)));
  }, [animeFilterMode, items]);
  const visibleItems = useMemo(() => filteredItems.slice(0, visibleCount), [filteredItems, visibleCount]);
  const weekGroups = useMemo(() => groupItemsByWeek(visibleItems, generatedAt), [generatedAt, visibleItems]);
  const hasVisibleMore = visibleCount < filteredItems.length;
  const hasRemoteMore = Boolean(continueCursor);
  const showSentinel = hasVisibleMore || (!query.trim() && hasRemoteMore);

  useEffect(() => {
    setVisibleCount(FEED_CHUNK_SIZE);
  }, [animeFilterMode, items, query]);

  useEffect(() => {
    const target = sentinelRef.current;
    if (!target || !showSentinel) {
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) {
            continue;
          }
          if (hasVisibleMore) {
            setVisibleCount((current) => Math.min(current + FEED_CHUNK_SIZE, filteredItems.length));
            continue;
          }
          if (hasRemoteMore && !loading && !query.trim()) {
            onLoadMore();
          }
        }
      },
      {
        rootMargin: "320px 0px 320px 0px",
      },
    );

    observer.observe(target);
    return () => observer.disconnect();
  }, [filteredItems.length, hasVisibleMore, hasRemoteMore, loading, onLoadMore, query, showSentinel]);

  return (
    <div className="relative z-10 animate-fade-in px-4 py-6 pb-20 lg:px-6">
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="absolute left-[12%] top-8 h-56 w-56 rounded-full bg-[#d7a55a]/10 blur-3xl" />
        <div className="absolute right-[10%] top-28 h-64 w-64 rounded-full bg-[#7ca4ff]/10 blur-3xl" />
      </div>

      <div className="relative flex flex-wrap items-center gap-3 pr-32">
        <div className="inline-flex rounded-full border border-white/8 bg-white/[0.04] p-1">
          {([
            { id: "all", label: "All" },
            { id: "anime", label: "Anime" },
            { id: "no-anime", label: "No Anime" },
          ] as const).map((option) => (
            <button
              key={option.id}
              type="button"
      onClick={() => onAnimeFilterModeChange(option.id)}
              className={clsx(
                "rounded-full px-3 py-2 text-[11px] font-semibold uppercase tracking-[0.18em] transition-colors",
                animeFilterMode === option.id ? "bg-white text-black" : "text-white/52 hover:text-white",
              )}
            >
              {option.label}
            </button>
          ))}
        </div>

        <button
          type="button"
          onClick={onRefresh}
          className="absolute right-0 top-0 inline-flex items-center gap-2 rounded-full border border-white/12 bg-white/[0.06] px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-white/[0.12]"
        >
          <RefreshCw className={clsx("h-4 w-4", loading && "animate-spin")} />
          Refresh
        </button>
      </div>

      {error ? (
        <div className="relative mt-6 rounded-[24px] border border-rose-400/14 bg-rose-400/8 px-5 py-4 text-sm text-rose-100">
          {error}
        </div>
      ) : null}

      {loading && items.length === 0 ? (
        <div className="relative mt-8 flex min-h-[18rem] items-center justify-center rounded-[28px] border border-white/8 bg-white/[0.03] text-white/54">
          <div className="inline-flex items-center gap-3 text-sm">
            <LoaderCircle className="h-4 w-4 animate-spin" />
            Loading provider feed...
          </div>
        </div>
      ) : null}

      {!loading && filteredItems.length === 0 ? (
        <div className="relative mt-8 rounded-[28px] border border-white/8 bg-white/[0.03] px-6 py-10 text-center">
          <div className="text-lg font-semibold text-white">Nothing surfaced yet</div>
          <p className="mt-2 text-sm text-white/46">
            {query.trim()
              ? `No ${providerLabel} matches were found for "${query.trim()}".`
              : "The feed is available, but this provider did not return items right now."}
          </p>
        </div>
      ) : null}

      {weekGroups.length > 0 ? (
        <div className="relative mt-6">
          <div className="space-y-10">
            {weekGroups.map((group) => (
              <section key={group.id}>
                <div className="mb-5 flex flex-col gap-2">
                  <div className="relative">
                    <div className="text-[10px] font-black uppercase tracking-[0.28em] text-[#d7a55a]">{group.label}</div>
                    <div className="mt-1 text-xl font-semibold tracking-[-0.035em] text-white">{group.dateLabel}</div>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5">
                  {group.items.map((item) => (
                    <ProviderFeedItemCard
                      key={item.id}
                      item={item}
                      providerLabel={providerLabel}
                      onClick={setSelectedItem}
                    />
                  ))}
                </div>
              </section>
            ))}
          </div>
        </div>
      ) : null}

      {showSentinel ? (
        <div ref={sentinelRef} className="relative mt-10 flex justify-center py-6">
          <div className="inline-flex items-center gap-3 rounded-full border border-white/8 bg-white/[0.04] px-4 py-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-white/42">
            <LoaderCircle className={clsx("h-3.5 w-3.5", loading ? "animate-spin" : "")} />
            {loading ? "Loading next wave" : "Scroll for more"}
          </div>
        </div>
      ) : null}

      <ProviderFeedItemModal
        item={selectedItem}
        providerLabel={providerLabel}
        onClose={() => setSelectedItem(null)}
        onImport={onImport}
        onOpenVault={onOpenVault}
      />
    </div>
  );
}
