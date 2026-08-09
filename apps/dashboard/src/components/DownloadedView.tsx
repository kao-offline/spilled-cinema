import { CheckCircle2, Film, HardDrive, Play, Search, Trash2, WifiOff } from "lucide-react";
import { useMemo, useState } from "react";
import type { ImportedShow, LibraryEpisode } from "../lib/types";
import { balancedBackgroundImage } from "../lib/image-resolution";
import { getShowArtwork } from "../lib/media-library";

type DownloadedViewProps = {
  shows: ImportedShow[];
  downloadedEpisodeIds: Set<string>;
  downloadedEpisodeSizes: Record<string, number>;
  onOpenShow: (slug: string) => void;
  onPlayEpisode: (episode: LibraryEpisode) => void;
  onDeleteEpisode: (episode: LibraryEpisode) => void;
};

function formatBytes(value: number) {
  if (!value) return "Local vault";
  if (value < 1024 * 1024) return `${Math.max(1, Math.round(value / 1024))} KB`;
  return `${(value / (1024 * 1024)).toFixed(value > 1024 * 1024 * 10 ? 0 : 1)} MB`;
}

function episodeLabel(episode: LibraryEpisode, isMovie: boolean) {
  if (isMovie) return "Movie";
  return episode.episodeCode || `S${String(episode.seasonNumber).padStart(2, "0")} · E${String(episode.episodeNumber ?? 0).padStart(2, "0")}`;
}

export function DownloadedView({
  shows,
  downloadedEpisodeIds,
  downloadedEpisodeSizes,
  onOpenShow,
  onPlayEpisode,
  onDeleteEpisode,
}: DownloadedViewProps) {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<"all" | "movies" | "series">("all");
  const savedEpisodes = useMemo(
    () => shows.flatMap((show) => show.episodes.filter((episode) => downloadedEpisodeIds.has(episode.id)).map((episode) => ({ show, episode }))),
    [downloadedEpisodeIds, shows],
  );
  const filtered = savedEpisodes.filter(({ show, episode }) => {
    const isMovie = show.mediaType === "movie" || show.episodes.length === 1;
    const matchesType = filter === "all" || (filter === "movies" ? isMovie : !isMovie);
    const haystack = `${show.title} ${episode.episodeTitle ?? ""} ${episode.episodeCode ?? ""}`.toLowerCase();
    return matchesType && haystack.includes(query.toLowerCase().trim());
  });
  const totalBytes = savedEpisodes.reduce((sum, item) => sum + (downloadedEpisodeSizes[item.episode.id] ?? 0), 0);
  const movieCount = savedEpisodes.filter(({ show }) => show.mediaType === "movie" || show.episodes.length === 1).length;
  const seriesCount = savedEpisodes.length - movieCount;

  return (
    <section className="animate-fade-in min-h-full px-4 pb-28 pt-5 sm:px-7 lg:px-10 lg:pb-16 lg:pt-8">
      <div className="relative overflow-hidden rounded-[2rem] border border-white/10 bg-[#151821] p-5 shadow-[0_30px_90px_rgba(0,0,0,.3)] sm:p-8">
        <div className="pointer-events-none absolute -right-20 -top-28 h-72 w-72 rounded-full bg-orange-400/20 blur-3xl" />
        <div className="pointer-events-none absolute -bottom-36 left-1/3 h-64 w-64 rounded-full bg-cyan-300/10 blur-3xl" />
        <div className="relative flex flex-col gap-7 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <div className="mb-3 flex items-center gap-2 text-[10px] font-black uppercase tracking-[.28em] text-orange-200/75">
              <WifiOff className="h-3.5 w-3.5" /> Ready without internet
            </div>
            <h1 className="max-w-xl text-4xl font-black tracking-[-.055em] text-white sm:text-6xl">Your offline shelf.</h1>
            <p className="mt-3 max-w-lg text-sm leading-6 text-white/48 sm:text-base">Everything here is stored in your local vault and playable on this phone or desktop.</p>
          </div>
          <div className="grid grid-cols-3 gap-2 sm:gap-3">
            {[
              [String(savedEpisodes.length), "saved"],
              [String(seriesCount), "episodes"],
              [String(movieCount), "movies"],
            ].map(([value, label]) => <div key={label} className="min-w-[76px] rounded-2xl border border-white/10 bg-black/20 px-3 py-3 sm:min-w-[94px]"><div className="text-2xl font-black text-white">{value}</div><div className="mt-1 text-[9px] font-black uppercase tracking-[.18em] text-white/35">{label}</div></div>)}
          </div>
        </div>
        <div className="relative mt-6 flex flex-wrap items-center gap-2 text-xs text-white/45"><HardDrive className="h-4 w-4 text-orange-200/70" /> {formatBytes(totalBytes)} in the vault <span className="text-white/15">·</span> {shows.length} {shows.length === 1 ? "title" : "titles"}</div>
      </div>

      <div className="sticky top-0 z-10 -mx-4 mt-6 flex flex-col gap-3 border-y border-white/[.07] bg-[#0c0d12]/90 px-4 py-3 backdrop-blur-xl sm:static sm:mx-0 sm:flex-row sm:items-center sm:border-0 sm:bg-transparent sm:px-0">
        <label className="flex min-w-0 flex-1 items-center gap-3 rounded-2xl border border-white/10 bg-white/[.045] px-4 py-3 text-white/35 focus-within:border-white/25"><Search className="h-4 w-4 shrink-0" /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search your downloads" className="min-w-0 flex-1 bg-transparent text-sm text-white outline-none placeholder:text-white/30" /></label>
        <div className="flex gap-1 rounded-2xl border border-white/10 bg-white/[.035] p-1">{(["all", "series", "movies"] as const).map((value) => <button key={value} onClick={() => setFilter(value)} className={`rounded-xl px-3 py-2 text-[10px] font-black uppercase tracking-[.15em] transition ${filter === value ? "bg-white text-black" : "text-white/40 hover:text-white"}`}>{value}</button>)}</div>
      </div>

      {filtered.length === 0 ? (
        <div className="mt-8 flex min-h-60 flex-col items-center justify-center rounded-[1.5rem] border border-dashed border-white/10 bg-white/[.018] px-6 text-center"><Film className="h-8 w-8 text-white/20" /><div className="mt-4 text-sm font-semibold text-white/55">{savedEpisodes.length ? "Nothing matches that search." : "Your shelf is waiting."}</div><div className="mt-2 text-xs text-white/30">{savedEpisodes.length ? "Try another title or filter." : "Download a movie or episode and it will appear here."}</div></div>
      ) : (
        <div className="mt-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">{filtered.map(({ show, episode }) => {
          const artwork = getShowArtwork(show);
          const isMovie = show.mediaType === "movie" || show.episodes.length === 1;
          return <article key={episode.id} className="group flex min-w-0 gap-3 rounded-[1.35rem] border border-white/[.08] bg-white/[.035] p-2.5 transition hover:border-white/20 hover:bg-white/[.06]">
            <button onClick={() => onPlayEpisode(episode)} className="relative h-28 w-[4.7rem] shrink-0 overflow-hidden rounded-xl bg-black/30 text-left sm:h-32 sm:w-[5.3rem]">{artwork.posterUrl ? <div className="absolute inset-0 bg-cover bg-center" style={balancedBackgroundImage(artwork.posterUrl, "poster-card")} /> : null}<div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent" /><Play className="absolute bottom-2 left-2 h-4 w-4 fill-white text-white opacity-80 transition group-hover:scale-110" /></button>
            <div className="min-w-0 flex-1 py-1"><button onClick={() => onOpenShow(show.slug)} className="line-clamp-1 text-left text-sm font-black text-white hover:underline">{show.title}</button><div className="mt-1 truncate text-xs text-white/45">{episodeLabel(episode, isMovie)}{episode.episodeTitle ? ` · ${episode.episodeTitle}` : ""}</div><div className="mt-3 flex items-center gap-2 text-[10px] font-bold uppercase tracking-[.13em] text-white/30"><CheckCircle2 className="h-3.5 w-3.5 text-emerald-300/80" /> {formatBytes(downloadedEpisodeSizes[episode.id] ?? 0)}</div></div>
            <button onClick={() => onDeleteEpisode(episode)} className="self-start rounded-lg p-2 text-white/25 transition hover:bg-red-400/10 hover:text-red-200" aria-label={`Remove ${show.title}`}><Trash2 className="h-4 w-4" /></button>
          </article>;
        })}</div>
      )}
    </section>
  );
}
