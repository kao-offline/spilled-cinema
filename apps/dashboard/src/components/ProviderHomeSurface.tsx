import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Search } from "lucide-react";
import { clsx } from "clsx";
import { fetchProviderFeed, searchProviderModuleItems } from "../lib/provider-modules-client";
import type { ExploreItem, ProviderFeedResponse } from "../lib/types";
import type { HomepageRail, HomepageRailItem } from "../lib/homepage-rails";
import { HomeRail } from "./HomeRail";
import { showToast } from "./ToastHost";
import { balancedBackgroundImage } from "../lib/image-resolution";

type ProviderHomeSurfaceProps = {
  provider: "svetserialu" | "bombuj";
  onImport: (item: ExploreItem) => void;
  onOpenVault: (item: ExploreItem) => void;
};

type AudioFilter = "all" | "subtitles" | "dubbing";
type AnimeFilter = "all" | "anime" | "no-anime";
const REFRESH_INTERVAL_MS = 5 * 60 * 1000;
const PROVIDER_HOME_FILTERS_KEY = "spilled.provider-home-filters.v1";

function readProviderHomeFilters(provider: "svetserialu" | "bombuj") {
  try {
    const raw = localStorage.getItem(PROVIDER_HOME_FILTERS_KEY);
    const saved = raw ? JSON.parse(raw) as Record<string, Partial<{ feedId: string; audioFilter: AudioFilter; animeFilter: AnimeFilter }>> : {};
    const preference = saved[provider];
    return {
      feedId: providerConfig[provider].feeds.some(([id]) => id === preference?.feedId) ? preference?.feedId ?? providerConfig[provider].feeds[0][0] : providerConfig[provider].feeds[0][0],
      audioFilter: preference?.audioFilter === "subtitles" || preference?.audioFilter === "dubbing" ? preference.audioFilter : "all" as AudioFilter,
      animeFilter: preference?.animeFilter === "anime" || preference?.animeFilter === "no-anime" ? preference.animeFilter : "all" as AnimeFilter,
    };
  } catch {
    return { feedId: providerConfig[provider].feeds[0][0], audioFilter: "all" as AudioFilter, animeFilter: "all" as AnimeFilter };
  }
}

function isAnimeItem(item: ExploreItem) {
  return item.title.toLowerCase().includes("anime") || item.genres.some((genre) => genre.toLowerCase().includes("anime"));
}

const providerConfig = {
  svetserialu: {
    title: "Search SvetSerialu",
    feeds: [["new-episodes", "All new episodes"], ["subtitled-episodes", "With subtitles"], ["new-series", "New series"]] as const,
  },
  bombuj: {
    title: "Search Bombuj",
    feeds: [["latest-movies", "Movies"], ["latest-series", "Series"]] as const,
  },
};

export function ProviderHomeSurface({ provider, onImport, onOpenVault }: ProviderHomeSurfaceProps) {
  const config = providerConfig[provider];
  const initialFilters = readProviderHomeFilters(provider);
  const [feedId, setFeedId] = useState<string>(initialFilters.feedId);
  const [response, setResponse] = useState<ProviderFeedResponse | null>(null);
  const [query, setQuery] = useState("");
  const [searchItems, setSearchItems] = useState<ExploreItem[]>([]);
  const [audioFilter, setAudioFilter] = useState<AudioFilter>(initialFilters.audioFilter);
  const [animeFilter, setAnimeFilter] = useState<AnimeFilter>(initialFilters.animeFilter);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (error) showToast(error);
  }, [error]);
  const loadMoreRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const saved = readProviderHomeFilters(provider);
    setFeedId(saved.feedId);
    setResponse(null);
    setQuery("");
    setAudioFilter(saved.audioFilter);
    setAnimeFilter(saved.animeFilter);
  }, [provider]);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(PROVIDER_HOME_FILTERS_KEY);
      const saved = raw ? JSON.parse(raw) as Record<string, unknown> : {};
      saved[provider] = { feedId, audioFilter, animeFilter };
      localStorage.setItem(PROVIDER_HOME_FILTERS_KEY, JSON.stringify(saved));
    } catch {
      // Preferences are best-effort; the feed remains usable if storage is unavailable.
    }
  }, [animeFilter, audioFilter, feedId, provider]);

  const loadFeed = useCallback(async (fresh = false) => {
    setLoading(true);
    setError(null);
    try {
      setResponse(await fetchProviderFeed({ moduleId: provider, feedId, limit: 32, fresh }));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "The provider feed could not be loaded.");
    } finally {
      setLoading(false);
    }
  }, [feedId, provider]);

  useEffect(() => {
    void loadFeed(false);
    const refresh = () => void loadFeed(true);
    const timer = window.setInterval(refresh, REFRESH_INTERVAL_MS);
    const onVisibility = () => { if (document.visibilityState === "visible") refresh(); };
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [loadFeed]);

  const loadMore = useCallback(async () => {
    if (loading || query.trim() || !response?.continueCursor) return;
    setLoading(true);
    try {
      const next = await fetchProviderFeed({ moduleId: provider, feedId, cursor: response.continueCursor, limit: 32 });
      setResponse((current) => current ? {
        ...next,
        items: [...current.items, ...next.items.filter((item) => !current.items.some((existing) => existing.id === item.id))],
      } : next);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "More titles could not be loaded.");
    } finally {
      setLoading(false);
    }
  }, [feedId, loading, provider, query, response?.continueCursor]);

  useEffect(() => {
    const target = loadMoreRef.current;
    if (!target || !response?.continueCursor || query.trim()) return;
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) void loadMore();
    }, { rootMargin: "600px 0px" });
    observer.observe(target);
    return () => observer.disconnect();
  }, [loadMore, query, response?.continueCursor]);

  useEffect(() => {
    const normalized = query.trim();
    if (normalized.length < 2) {
      setSearchItems([]);
      return;
    }
    let canceled = false;
    const timer = window.setTimeout(() => {
      setLoading(true);
      void searchProviderModuleItems({ moduleId: provider, query: normalized })
        .then((items) => { if (!canceled) setSearchItems(items); })
        .catch((reason) => { if (!canceled) setError(reason instanceof Error ? reason.message : "Search failed."); })
        .finally(() => { if (!canceled) setLoading(false); });
    }, 220);
    return () => { canceled = true; window.clearTimeout(timer); };
  }, [provider, query]);

  const displayedItems = useMemo(() => {
    const items = query.trim().length >= 2 ? searchItems : response?.items ?? [];
    const audioItems = audioFilter === "all" ? items : items.filter((item) => item.audioBuckets.includes(audioFilter));
    if (animeFilter === "all") return audioItems;
    return audioItems.filter((item) => animeFilter === "anime" ? isAnimeItem(item) : !isAnimeItem(item));
  }, [animeFilter, audioFilter, query, response?.items, searchItems]);

  const itemByRailId = useMemo(() => new Map(displayedItems.map((item) => [`provider:${item.id}`, item])), [displayedItems]);
  const rails = useMemo<HomepageRail[]>(() => {
    const toRailItem = (item: ExploreItem): HomepageRailItem => ({
      kind: "remote",
      id: `provider:${item.id}`,
      title: item.title,
      subtitle: [item.mediaType === "movie" ? "Movie" : item.episode?.episodeCode ?? "Series", item.yearLabel ?? item.year].filter(Boolean).join("  |  "),
      posterUrl: item.posterUrl ?? null,
      backdropUrl: item.backdropUrl ?? null,
      bannerUrl: (item as ExploreItem & { bannerUrl?: string | null }).bannerUrl ?? null,
      provider: item.provider,
      importSlug: item.importSlug,
      mediaType: item.mediaType,
    });
    const movies = displayedItems.filter((item) => item.mediaType === "movie");
    const series = displayedItems.filter((item) => item.mediaType === "serial");
    const nextRails: HomepageRail[] = [];
    if (movies.length) nextRails.push({ id: "provider-movies", title: query.trim() ? "Movie results" : "Latest movies", kind: "poster", items: movies.map(toRailItem) });
    if (series.length) nextRails.push({ id: "provider-series", title: query.trim() ? "Series results" : feedId === "new-series" ? "New series" : "Latest episodes", kind: "poster", items: series.map(toRailItem) });
    return nextRails;
  }, [displayedItems, feedId, query]);

  const heroArtwork = displayedItems[0]?.backdropUrl ?? displayedItems[0]?.posterUrl ?? null;

  return (
    <div className="min-h-screen bg-[#05060a] text-white">
      <section className="relative flex min-h-[82vh] items-center justify-center overflow-hidden bg-[#0b0d12] px-6 pb-16 pt-28">
        {heroArtwork ? <div className="absolute inset-0 scale-105 bg-cover bg-center opacity-30 blur-[2px]" style={balancedBackgroundImage(heroArtwork, "backdrop-hero")} /> : null}
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_70%_25%,rgba(135,103,67,.26),transparent_35%),linear-gradient(90deg,rgba(5,6,10,.94),rgba(5,6,10,.45),rgba(5,6,10,.82))]" />
        <div className="absolute inset-0 bg-gradient-to-b from-[#05060a]/25 via-transparent to-[#05060a]" />
        <div className="relative w-full max-w-4xl text-center">
          <h1 className="text-3xl font-black tracking-[-.045em] text-white sm:text-5xl">{config.title}</h1>
          <label className="mx-auto mt-7 flex h-16 max-w-3xl items-center gap-4 rounded-2xl border border-white/18 bg-black/45 px-5 shadow-[0_24px_80px_rgba(0,0,0,.48)] backdrop-blur-xl focus-within:border-white/45 sm:h-20 sm:px-7">
            <Search className="h-5 w-5 shrink-0 text-white/45" />
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search titles…" className="min-w-0 flex-1 bg-transparent text-lg font-semibold tracking-tight text-white outline-none placeholder:text-white/30 sm:text-2xl" />
          </label>
          <div className="mt-4 flex flex-wrap justify-center gap-2">
            <div className="inline-flex flex-wrap rounded-full border border-white/10 bg-black/35 p-1 backdrop-blur-xl">
              {config.feeds.map(([id, label]) => <button key={id} onClick={() => { setFeedId(id); setResponse(null); }} className={clsx("rounded-full px-4 py-2 text-[10px] font-bold uppercase tracking-[.14em] transition", feedId === id ? "bg-white text-black" : "text-white/48 hover:text-white")}>{label}</button>)}
            </div>
            {provider === "bombuj" ? <div className="inline-flex rounded-full border border-white/10 bg-black/35 p-1 backdrop-blur-xl">{(["all", "subtitles", "dubbing"] as const).map((id) => <button key={id} onClick={() => setAudioFilter(id)} className={clsx("rounded-full px-3 py-2 text-[10px] font-bold uppercase tracking-[.14em] transition", audioFilter === id ? "bg-white text-black" : "text-white/45 hover:text-white")}>{id}</button>)}</div> : null}
            {provider === "svetserialu" ? <div className="inline-flex rounded-full border border-white/10 bg-black/35 p-1 backdrop-blur-xl">{(["all", "anime", "no-anime"] as const).map((id) => <button key={id} onClick={() => setAnimeFilter(id)} className={clsx("rounded-full px-3 py-2 text-[10px] font-bold uppercase tracking-[.14em] transition", animeFilter === id ? "bg-white text-black" : "text-white/45 hover:text-white")}>{id === "no-anime" ? "No anime" : id}</button>)}</div> : null}
          </div>
        </div>
      </section>

      <main className="relative z-10 -mt-8 pb-24">
        {loading && rails.length === 0 ? <div className="px-5 py-14 text-sm font-semibold text-white/38 sm:px-10 lg:px-16">Loading…</div> : null}
        {!loading && rails.length === 0 ? <div className="px-5 py-14 text-sm font-semibold text-white/38 sm:px-10 lg:px-16">No titles found.</div> : null}
        {rails.map((rail) => <HomeRail key={rail.id} rail={rail} layout="grid" onOpenLocal={() => {}} onImportRemote={(railItem) => { const item = itemByRailId.get(railItem.id); if (item) item.inVault ? onOpenVault(item) : onImport(item); }} />)}
        <div ref={loadMoreRef} className="flex h-24 items-center justify-center text-xs font-bold uppercase tracking-[.2em] text-white/25">
          {loading && rails.length > 0 ? "Loading more…" : response?.continueCursor ? "Scroll for more" : ""}
        </div>
      </main>
    </div>
  );
}
