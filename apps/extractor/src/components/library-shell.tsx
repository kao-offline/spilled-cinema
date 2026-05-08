"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import {
  Clock,
  Download,
  Film,
  LayoutGrid,
  LoaderCircle,
  Play,
  Search,
  Sparkles,
  Zap,
} from "lucide-react";
import {
  bootstrapLibraryToken,
  fetchMediaItems,
  importSvetSerialuShow,
} from "@/lib/library-storage";
import type { MediaItem } from "@/lib/types";
import { formatDuration, humanizeHost } from "@/lib/utils";

function PosterCard({ item }: { item: MediaItem }) {
  return (
    <Link
      href={`/watch/${item.id}`}
      className="premium-card group relative block aspect-[3/4.2] w-[220px] overflow-hidden rounded-[20px] border border-white/10 bg-white/5 shadow-2xl"
    >
      <div className="absolute inset-0 z-10 bg-gradient-to-t from-black via-black/30 to-transparent opacity-80 transition-opacity group-hover:opacity-60" />

      {item.posterUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={item.posterUrl}
          alt={item.title}
          className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-110"
        />
      ) : (
        <div className="flex h-full w-full items-center justify-center bg-[radial-gradient(circle_at_top,_rgba(0,242,255,0.15),_transparent_45%),linear-gradient(180deg,_#1a1f35,_#07080d)]">
          <Film className="h-12 w-12 text-[#00f2ff]/30" strokeWidth={1} />
        </div>
      )}

      <div className="absolute inset-x-0 bottom-0 z-20 space-y-2 p-5 transition-transform duration-300">
        <div className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.25em] text-[#00f2ff]">
          <Zap className="h-3 w-3 fill-current" />
          {humanizeHost(item.sourceHost)}
        </div>
        <div className="line-clamp-2 text-base font-bold leading-tight text-white/95">
          {item.title}
        </div>
        <div className="flex items-center gap-3 text-xs text-white/50">
          <span className="flex items-center gap-1.5 font-medium tabular-nums">
            <Clock className="h-3 w-3" />
            {formatDuration(item.durationSeconds)}
          </span>
          {item.resumePositionSeconds > 0 ? (
            <span className="rounded-full bg-white/10 px-2.5 py-0.5 text-[9px] font-bold uppercase tracking-wider text-white">
              Resume
            </span>
          ) : null}
        </div>
      </div>
    </Link>
  );
}

function ImportShowForm(props: {
  showSlug: string;
  setShowSlug: (value: string) => void;
  importing: boolean;
  importMessage: string | null;
  onSubmit: (event: React.FormEvent<HTMLFormElement>) => Promise<void>;
  compact?: boolean;
}) {
  const { showSlug, setShowSlug, importing, importMessage, onSubmit, compact = false } = props;

  return (
    <form onSubmit={onSubmit} className={compact ? "space-y-3" : "space-y-4 pt-6"}>
      <label className="block text-xs font-bold uppercase tracking-[0.25em] text-white/40">
        Import full SvetSerialu show
      </label>
      <div className={`flex gap-3 ${compact ? "flex-col sm:flex-row" : "flex-col sm:flex-row"}`}>
        <input
          value={showSlug}
          onChange={(event) => setShowSlug(event.target.value)}
          placeholder="upload"
          className="flex-1 rounded-full border border-white/10 bg-white/5 px-6 py-4 text-sm text-white backdrop-blur-xl focus:border-[#00f2ff]/40 focus:ring-0"
        />
        <button
          type="submit"
          disabled={importing}
          className="inline-flex items-center justify-center gap-2.5 rounded-full border border-white/10 bg-white/10 px-8 py-4 text-sm font-bold text-white transition hover:bg-white/15 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {importing ? (
            <LoaderCircle className="h-4 w-4 animate-spin" />
          ) : (
            <Download className="h-4 w-4" />
          )}
          Load Show
        </button>
      </div>
      <p className="text-sm text-white/50">
        Enter the slug from `svetserialu.to/serial/&lt;slug&gt;`. All seasons and episodes are fetched and cached into the local store.
      </p>
      {importMessage ? <p className="text-sm text-[#00f2ff]">{importMessage}</p> : null}
    </form>
  );
}

function EmptyState(props: {
  showSlug: string;
  setShowSlug: (value: string) => void;
  importing: boolean;
  importMessage: string | null;
  onSubmit: (event: React.FormEvent<HTMLFormElement>) => Promise<void>;
}) {
  return (
    <section className="glass-panel relative overflow-hidden rounded-[48px] border-none p-12 shadow-[0_0_80px_rgba(0,242,255,0.1)] sm:p-20">
      <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-[#00f2ff]/50 to-transparent" />
      <div className="relative z-10 max-w-3xl space-y-8">
        <div className="inline-flex items-center gap-2.5 rounded-full border border-[#00f2ff]/20 bg-[#00f2ff]/5 px-5 py-2.5 text-[11px] font-bold uppercase tracking-[0.25em] text-[#00f2ff]">
          <Sparkles className="h-4 w-4" />
          Next-Gen Cinema Library
        </div>
        <h1 className="max-w-3xl text-gradient text-6xl font-bold leading-[1.05] sm:text-7xl">
          Elevate your streaming experience.
        </h1>
        <p className="max-w-2xl text-xl leading-relaxed text-muted">
          SpilledCinema isolates the media you love from cluttered pages and rebuilds it in a premium, distraction-free internal player.
        </p>
        <div className="flex flex-wrap gap-4 pt-4">
          <Link
            href="/import"
            className="btn-primary inline-flex items-center gap-2.5 rounded-full px-8 py-4 text-sm font-bold tracking-wide"
          >
            <Zap className="h-4 w-4 fill-current" />
            Start a capture
          </Link>
          <Link
            href="/bookmarklet"
            className="inline-flex items-center gap-2.5 rounded-full border border-white/10 bg-white/5 px-8 py-4 text-sm font-bold text-white/80 transition hover:bg-white/10 hover:text-white"
          >
            <LayoutGrid className="h-4 w-4" />
            Install bookmarklet
          </Link>
        </div>
        <ImportShowForm {...props} />
      </div>

      <div className="absolute right-[-10%] top-1/2 h-[400px] w-[400px] -translate-y-1/2 rounded-full bg-[#00f2ff]/10 blur-[120px]" />
    </section>
  );
}

export function LibraryShell() {
  const [items, setItems] = useState<MediaItem[]>([]);
  const [query, setQuery] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [showSlug, setShowSlug] = useState("");
  const [importing, setImporting] = useState(false);
  const [importMessage, setImportMessage] = useState<string | null>(null);

  useEffect(() => {
    async function init() {
      try {
        await bootstrapLibraryToken();
        setItems(await fetchMediaItems());
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : "Failed to load library.");
      }
    }

    void init();
  }, []);

  async function handleImport(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const slug = showSlug.trim().toLowerCase();

    if (!slug) {
      setImportMessage("Enter a show slug, for example `upload` or `see`.");
      return;
    }

    setImporting(true);
    setImportMessage(null);

    try {
      const payload = await importSvetSerialuShow(slug);
      setItems(await fetchMediaItems());
      setImportMessage(
        `${payload.show?.title ?? slug}: imported ${payload.show?.importedCount ?? 0} new items and updated ${payload.show?.updatedCount ?? 0}.`,
      );
      setShowSlug("");
    } catch (cause) {
      setImportMessage(cause instanceof Error ? cause.message : "Failed to import show.");
    } finally {
      setImporting(false);
    }
  }

  const filtered = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return items;
    return items.filter((item) => {
      const haystack = `${item.title} ${item.sourceHost} ${item.tags.join(" ")}`.toLowerCase();
      return haystack.includes(normalized);
    });
  }, [items, query]);

  const continueWatching = items.filter((item) => item.resumePositionSeconds > 15);
  const recentlyAdded = items.slice(0, 10);
  const featured = items[0];

  if (error) {
    return (
      <section className="glass-panel rounded-[32px] border-red-500/20 p-12 text-red-100">
        {error}
      </section>
    );
  }

  if (items.length === 0) {
    return (
      <EmptyState
        showSlug={showSlug}
        setShowSlug={setShowSlug}
        importing={importing}
        importMessage={importMessage}
        onSubmit={handleImport}
      />
    );
  }

  return (
    <div className="space-y-16 pb-20">
      <section className="relative -mx-6 h-[70vh] min-h-[500px] overflow-hidden sm:-mx-12 lg:-mx-20">
        <div className="hero-gradient absolute inset-0 z-10" />
        {featured.posterUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={featured.posterUrl}
            alt={featured.title}
            className="h-full w-full object-cover object-top"
          />
        ) : (
          <div className="h-full w-full bg-[#1a1f35]" />
        )}

        <div className="absolute inset-0 z-20 flex flex-col justify-end p-8 pb-16 sm:p-12 sm:pb-20 lg:p-20">
          <div className="max-w-4xl space-y-6">
            <div className="flex items-center gap-3">
              <span className="rounded-full bg-[#00f2ff] px-3 py-1 text-[10px] font-black uppercase tracking-widest text-black">
                Featured
              </span>
              <span className="text-sm font-bold tracking-[0.2em] text-white/60">
                FROM {featured.sourceHost.toUpperCase()}
              </span>
            </div>
            <h1 className="text-gradient text-5xl font-black tracking-tight sm:text-7xl lg:text-8xl">
              {featured.title}
            </h1>
            <p className="max-w-2xl text-xl leading-relaxed text-muted">
              Re-engineered player rebuild with resume support and high-fidelity internal playback.
            </p>
            <div className="flex items-center gap-4 pt-4">
              <Link
                href={`/watch/${featured.id}`}
                className="btn-primary flex items-center gap-3 rounded-full px-10 py-5 text-base font-bold shadow-2xl transition hover:scale-105"
              >
                <Play className="h-5 w-5 fill-current" />
                Play Now
              </Link>
              <div className="group relative">
                <input
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="Search captures..."
                  className="w-48 rounded-full border border-white/10 bg-white/5 px-6 py-4 text-sm backdrop-blur-xl transition-all focus:w-80 focus:border-[#00f2ff]/40 focus:ring-0"
                />
                <Search className="absolute right-5 top-1/2 h-4 w-4 -translate-y-1/2 text-white/30" />
              </div>
            </div>
            <ImportShowForm
              showSlug={showSlug}
              setShowSlug={setShowSlug}
              importing={importing}
              importMessage={importMessage}
              onSubmit={handleImport}
              compact
            />
          </div>
        </div>
      </section>

      <div className="space-y-16">
        {continueWatching.length > 0 ? (
          <section className="space-y-6">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <Clock className="h-6 w-6 text-[#00f2ff]" />
                <h2 className="text-3xl font-black tracking-tight text-white">Continue Watching</h2>
              </div>
              <div className="mx-8 h-px flex-1 bg-gradient-to-r from-white/10 to-transparent" />
            </div>
            <div className="netflix-row no-scrollbar px-2">
              {continueWatching.map((item) => (
                <PosterCard key={item.id} item={item} />
              ))}
            </div>
          </section>
        ) : null}

        <section className="space-y-6">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Sparkles className="h-6 w-6 text-[#00f2ff]" />
              <h2 className="text-3xl font-black tracking-tight text-white">Recently Added</h2>
            </div>
            <div className="mx-8 h-px flex-1 bg-gradient-to-r from-white/10 to-transparent" />
          </div>
          <div className="netflix-row no-scrollbar px-2">
            {recentlyAdded.map((item) => (
              <PosterCard key={item.id} item={item} />
            ))}
          </div>
        </section>

        {query.trim() ? (
          <section className="space-y-6">
            <div className="flex items-center gap-3">
              <Search className="h-6 w-6 text-[#00f2ff]" />
              <h2 className="text-3xl font-black tracking-tight text-white">Search Results</h2>
            </div>
            <div className="grid grid-cols-2 gap-6 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
              {filtered.map((item) => (
                <PosterCard key={item.id} item={item} />
              ))}
            </div>
          </section>
        ) : null}
      </div>
    </div>
  );
}
