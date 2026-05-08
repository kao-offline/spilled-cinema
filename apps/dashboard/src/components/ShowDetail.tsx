import { useEffect, useMemo, useState } from "react";
import type { ImportedShow, LibraryEpisode } from "../lib/types";
import { ChevronDown, Play, ArrowLeft, Trash2, Heart, Download, LoaderCircle, X, ImagePlus } from "lucide-react";
import { clsx } from "clsx";
import type { FullDownloadJob } from "../lib/full-download-client";
import { ArtworkPickerModal } from "./ArtworkPickerModal";
import { formatEpisodeTitle } from "../lib/episode-title";

type ShowDetailProps = {
  show: ImportedShow | null;
  onBack: () => void;
  onSelectEpisode: (episode: LibraryEpisode) => void;
  onRemoveShow: () => void;
  onToggleFavorite: () => void;
  onUpdateArtwork: (artwork: {
    posterUrl?: string | null;
    backdropUrl?: string | null;
    clearLogoUrl?: string | null;
  }) => void;
  fullDownloadJobsByEpisode: Record<string, FullDownloadJob>;
  onStartFullDownload: (episode: LibraryEpisode) => void;
  onCancelFullDownload: (episode: LibraryEpisode) => void;
  downloadedEpisodeIds: Set<string>;
  onDeleteFullDownload: (episode: LibraryEpisode) => void;
};

export function ShowDetail({
  show,
  onBack,
  onSelectEpisode,
  onRemoveShow,
  onToggleFavorite,
  onUpdateArtwork,
  fullDownloadJobsByEpisode,
  onStartFullDownload,
  onCancelFullDownload,
  downloadedEpisodeIds,
  onDeleteFullDownload,
}: ShowDetailProps) {
  const [expandedSeason, setExpandedSeason] = useState<number | null>(null);
  const [editingArtwork, setEditingArtwork] = useState(false);
  const [scrollY, setScrollY] = useState(0);
  const clearLogoOffset = Math.min(scrollY * 0.12, 36);

  useEffect(() => {
    const handleScroll = () => setScrollY(window.scrollY || 0);
    handleScroll();
    window.addEventListener("scroll", handleScroll, { passive: true });
    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

  const sortedEpisodes = useMemo(() => {
    if (!show) {
      return [];
    }
    return [...show.episodes].sort((left, right) => {
      if (left.seasonNumber !== right.seasonNumber) {
        return left.seasonNumber - right.seasonNumber;
      }
      return (left.episodeNumber ?? 0) - (right.episodeNumber ?? 0);
    });
  }, [show]);

  const seasons = useMemo(() => {
    const map = new Map<number, LibraryEpisode[]>();
    for (const episode of sortedEpisodes) {
      const list = map.get(episode.seasonNumber) ?? [];
      list.push(episode);
      map.set(episode.seasonNumber, list);
    }
    return Array.from(map.entries()).sort((left, right) => left[0] - right[0]);
  }, [sortedEpisodes]);

  const latestEpisode = sortedEpisodes[sortedEpisodes.length - 1] ?? null;
  const heroImage = show?.posterUrl ?? null;
  const heroBackdrop = show?.backdropUrl ?? null;
  const yearsText = show?.years ?? null;
  const csfdRatingMatch = yearsText?.match(/CSFD\s*(\d{1,3})%/i);
  const csfdRating = csfdRatingMatch?.[1] ?? null;
  const yearLabel = yearsText
    ? yearsText
        .replace(/\s*(?:•|-)?\s*CSFD\s*\d{1,3}%/i, "")
        .replace(/\s{2,}/g, " ")
        .trim()
    : null;
  const movieEpisode = sortedEpisodes.length === 1 ? sortedEpisodes[0] : null;
  const movieJob = movieEpisode ? fullDownloadJobsByEpisode[movieEpisode.id] : undefined;
  const movieBusy = Boolean(movieJob && ["queued", "resolving", "downloading"].includes(movieJob.state));
  const movieDownloaded = Boolean(movieEpisode && (downloadedEpisodeIds.has(movieEpisode.id) || movieJob?.state === "completed"));
  const moviePercent = movieJob?.percent ?? 0;
  const displayDescription = useMemo(() => {
    const raw = show?.description?.trim();
    if (!raw) {
      return "No description available.";
    }

    if (!/^csfd\s*rating:/i.test(raw)) {
      return raw;
    }

    const afterInlineRating = raw.replace(/^csfd\s*rating:[^)]*\)\s*/i, "").trim();
    if (afterInlineRating.length > 0) {
      return afterInlineRating;
    }

    const afterFirstLine = raw.replace(/^csfd\s*rating:[^\n]*\n?/i, "").trim();
    return afterFirstLine || "No description available.";
  }, [show?.description]);

  useEffect(() => {
    setEditingArtwork(false);
  }, [show?.slug, show?.posterUrl, show?.backdropUrl, show?.clearLogoUrl]);

  if (!show) {
    return (
      <section className="px-4 pb-12 sm:px-6 lg:px-10">
        <div className="rounded-2xl bg-white/5 p-10 text-white/70">
          <div className="text-sm font-bold">Show not found.</div>
          <button
            onClick={onBack}
            className="mt-6 flex items-center gap-2 rounded-xl bg-white/10 px-4 py-2 text-sm font-medium text-white transition hover:bg-white/20"
          >
            <ArrowLeft className="h-4 w-4" />
            Back to library
          </button>
        </div>
      </section>
    );
  }

  return (
    <section className="relative z-10 w-full overflow-hidden px-4 pb-16 animate-fade-in sm:px-6 lg:px-10">
      <button
        onClick={onBack}
        className="mb-6 flex items-center gap-2 text-sm font-medium text-white/50 transition hover:text-white lg:mb-8"
      >
        <ArrowLeft className="h-4 w-4" />
        Back to library
      </button>

      <div className="relative mb-10 overflow-hidden rounded-[2rem] border border-white/8 bg-[#14151d] lg:mb-12">
        {heroBackdrop ? (
          <>
            <div
              className="absolute inset-0 bg-cover bg-center opacity-30"
              style={{ backgroundImage: `url(${heroBackdrop})` }}
            />
            <div className="absolute inset-0 bg-gradient-to-r from-[#0d0e14] via-[#0d0e14]/88 to-[#0d0e14]/55" />
            <div className="absolute inset-0 bg-gradient-to-t from-[#0d0e14] via-[#0d0e14]/35 to-transparent" />
          </>
        ) : null}

        {show.clearLogoUrl ? (
          <div
            className="pointer-events-none absolute right-6 top-8 hidden w-[30%] max-w-[360px] opacity-75 drop-shadow-[0_20px_40px_rgba(0,0,0,0.45)] lg:block"
            style={{ transform: `translate3d(0, ${clearLogoOffset}px, 0)` }}
          >
            <img src={show.clearLogoUrl} alt={`${show.title} logo`} className="h-auto w-full object-contain" />
          </div>
        ) : null}

        <div className="absolute right-5 top-5 z-20 lg:right-6 lg:top-6">
          <button
            onClick={() => setEditingArtwork((value) => !value)}
            className={clsx(
              "flex h-11 w-11 items-center justify-center rounded-full border backdrop-blur-md transition-colors",
              editingArtwork
                ? "border-orange-400/40 bg-orange-400/20 text-orange-100"
                : "border-white/10 bg-black/25 text-white/70 hover:bg-black/40 hover:text-white",
            )}
            title="Edit artwork"
            aria-label="Edit artwork"
          >
            <ImagePlus className="h-5 w-5" />
          </button>
        </div>

        <div className="relative flex flex-col gap-8 p-6 md:flex-row lg:gap-10 lg:p-8">
          {/* Poster */}
          <div className="shrink-0 self-center md:self-start">
            <div className="aspect-[2/3] w-56 overflow-hidden rounded-2xl bg-[#1a1b23] shadow-2xl sm:w-64 md:w-72 lg:w-80">
              {heroImage ? (
                <div
                  className="h-full w-full bg-cover bg-center"
                  style={{ backgroundImage: `url(${heroImage})` }}
                />
              ) : null}
            </div>
          </div>

          {/* Info */}
          <div className="flex flex-col justify-center">
            <div className="mb-2 flex flex-wrap items-center gap-3">
              <span className="rounded-full bg-orange-400 px-3 py-1 text-xs font-bold text-[#0c0d12]">
                {sortedEpisodes.length === 1 ? "Movie" : "Show"}
              </span>
              {yearLabel ? <span className="text-sm font-medium text-white/40">{yearLabel}</span> : null}
              {csfdRating ? (
                <span className="rounded-full border border-emerald-400/35 bg-emerald-500/15 px-3 py-1 text-xs font-semibold text-emerald-200">
                  CSFD {csfdRating}%
                </span>
              ) : null}
              {sortedEpisodes.length > 1 ? (
                <span className="text-sm font-medium text-white/40">{show.availableSeasons.length} Seasons</span>
              ) : null}
            </div>

            <h1 className="mb-4 text-3xl font-bold tracking-tight text-white sm:text-4xl lg:text-7xl">
              {show.title}
            </h1>

            {show.altTitle ? (
              <h2 className="mb-6 text-xl tracking-tight text-white/40">{show.altTitle}</h2>
            ) : null}

            <p className="mb-8 max-w-2xl text-base leading-relaxed text-white/60">
              {displayDescription}
            </p>

            <div className="flex flex-wrap gap-3 sm:gap-4">
              {latestEpisode ? (
                <button
                  onClick={() => onSelectEpisode(latestEpisode)}
                  className="flex items-center gap-2 rounded-xl bg-white px-6 py-4 text-sm font-bold text-black transition-transform hover:scale-105 sm:px-8"
                >
                  <Play className="h-5 w-5 fill-black" strokeWidth={0} />
                  {sortedEpisodes.length === 1 ? "Play Movie" : "Play latest"}
                </button>
              ) : null}
              {movieEpisode ? (
                <>
                  <button
                    onClick={() => {
                      if (movieBusy || movieDownloaded) {
                        return;
                      }
                      onStartFullDownload(movieEpisode);
                    }}
                    className={clsx(
                      "flex items-center gap-2 rounded-xl border px-5 py-4 text-sm font-bold transition-colors sm:px-6",
                      movieDownloaded
                        ? "bg-sky-500/20 border-sky-500/20 text-sky-200 hover:bg-sky-500/30"
                        : movieJob?.state === "failed"
                          ? "bg-red-500/20 border-red-500/20 text-red-200 hover:bg-red-500/30"
                          : "bg-white/5 border-white/10 text-white/75 hover:bg-white/10 hover:text-white",
                    )}
                    title="Download full video"
                  >
                    {movieBusy ? <LoaderCircle className="h-5 w-5 animate-spin" /> : <Download className="h-5 w-5" />}
                    {movieBusy
                      ? `Downloading ${moviePercent}%`
                      : movieDownloaded
                        ? "Saved"
                        : movieJob?.state === "failed"
                          ? "Retry Download"
                          : "Download Movie"}
                  </button>

                  {movieBusy ? (
                    <button
                      onClick={() => onCancelFullDownload(movieEpisode)}
                      className="flex items-center gap-2 rounded-xl border border-red-500/30 bg-red-500/15 px-5 py-4 text-sm font-bold text-red-200 transition-colors hover:bg-red-500/25 sm:px-6"
                      title="Cancel active download and remove partial files"
                    >
                      <X className="h-5 w-5" />
                      Cancel Download
                    </button>
                  ) : null}

                  {movieDownloaded ? (
                    <button
                      onClick={() => onDeleteFullDownload(movieEpisode)}
                      className="flex items-center gap-2 rounded-xl bg-red-500/10 border border-red-500/20 px-5 py-4 text-sm font-bold text-red-300 transition-colors hover:bg-red-500/20 sm:px-6"
                      title="Delete downloaded file"
                    >
                      <Trash2 className="h-5 w-5" />
                      Delete Download
                    </button>
                  ) : null}
                </>
              ) : null}
              <button
                onClick={onToggleFavorite}
                className={clsx(
                  "flex items-center justify-center gap-2 rounded-xl border px-5 py-4 text-sm font-bold transition-colors sm:px-6",
                  show.isFavorite
                    ? "bg-red-500/10 border-red-500/20 text-red-500 hover:bg-red-500/20"
                    : "bg-white/5 border-white/10 text-white/70 hover:bg-white/10 hover:text-white"
                )}
              >
                <Heart className={clsx("h-5 w-5", show.isFavorite && "fill-red-500 text-red-500")} />
              </button>
              <button
                onClick={onRemoveShow}
                className="flex items-center gap-2 rounded-xl bg-white/5 border border-white/10 px-5 py-4 text-sm font-bold text-red-500 transition-colors hover:bg-red-500/10 hover:border-red-500/20 sm:px-6"
              >
                <Trash2 className="h-5 w-5" />
                Remove
              </button>
            </div>

            {movieEpisode && movieBusy ? (
              <div className="mt-4 h-1.5 w-full max-w-2xl overflow-hidden rounded-full bg-white/10">
                <div
                  className="h-full rounded-full bg-sky-400 transition-all duration-300"
                  style={{ width: `${Math.max(3, Math.min(moviePercent, 100))}%` }}
                />
              </div>
            ) : null}
            {movieEpisode && movieJob?.state === "failed" && movieJob.error ? (
              <div className="mt-3 max-w-2xl text-sm text-red-300/90" title={movieJob.error}>
                {movieJob.error}
              </div>
            ) : null}
          </div>
        </div>
      </div>

      <ArtworkPickerModal
        show={show}
        open={editingArtwork}
        onClose={() => setEditingArtwork(false)}
        onApplyArtwork={onUpdateArtwork}
      />

      {sortedEpisodes.length > 1 ? (
        <div className="columns-1 lg:columns-2 gap-6 space-y-6">
          {seasons.map(([seasonNumber, episodes]) => {
            const isOpen = expandedSeason === seasonNumber;
            return (
              <div key={seasonNumber} className="overflow-hidden rounded-2xl bg-white/5 transition-all break-inside-avoid">
                <button
                  onClick={() => setExpandedSeason(isOpen ? null : seasonNumber)}
                  className="flex w-full items-center justify-between p-6 text-left transition-colors hover:bg-white/5 active:bg-white/10"
                >
                  <div className="flex items-center gap-4">
                    <span className="text-lg font-bold text-white">Season {seasonNumber}</span>
                    <span className="rounded-full bg-white/10 px-3 py-1 text-xs font-semibold text-white/50">
                      {episodes.length} episodes
                    </span>
                  </div>
                  <ChevronDown className={clsx("h-5 w-5 text-white/40 transition-transform duration-300", isOpen && "rotate-180")} />
                </button>

                <div 
                  className={clsx(
                    "grid transition-all duration-300 ease-in-out",
                    isOpen ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0"
                  )}
                >
                  <div className="overflow-hidden">
                    <div className="flex flex-col gap-1 p-4 pt-0">
                      {episodes.map((episode) => {
                        const epName = formatEpisodeTitle(episode);
                        
                        const fullJob = fullDownloadJobsByEpisode[episode.id];
                        const fullBusy = fullJob && ["queued", "resolving", "downloading"].includes(fullJob.state);
                        const fullPercent = fullJob?.percent ?? 0;
                        const isDownloaded = downloadedEpisodeIds.has(episode.id) || fullJob?.state === "completed";

                        return (
                          <div
                            key={episode.id}
                            className="group rounded-xl px-4 py-3 text-left transition-colors hover:bg-white/10"
                          >
                            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                                      <div className="flex flex-1 items-center justify-start gap-3 overflow-hidden">
                              <span className="text-sm font-semibold text-white/40 group-hover:text-white/60 shrink-0">
                                {episode.episodeNumber ?? "0"}
                              </span>
                              <span className="text-sm font-medium text-white/80 group-hover:text-white truncate">
                                {epName}
                              </span>
                            </div>
                            
                                      <div className="flex flex-wrap items-center justify-start gap-2 sm:justify-end shrink-0 sm:ml-3">
                                                          <button
                                                            onClick={() => {
                                                              if (fullBusy || isDownloaded) return;
                                                              onStartFullDownload(episode);
                                                            }}
                                                            className={clsx(
                                                              "inline-flex h-8 items-center gap-1.5 rounded-full px-3 text-[10px] font-bold uppercase tracking-[0.16em] transition",
                                                              isDownloaded
                                                                ? "bg-sky-500/20 text-sky-300 hover:bg-sky-500/30"
                                                                : fullJob?.state === "failed"
                                                                  ? "bg-red-500/20 text-red-300 hover:bg-red-500/30"
                                                                  : "bg-white/10 text-white/75 hover:bg-white/20",
                                                            )}
                                                            title="Download full video"
                                                          >
                                                            {fullBusy ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}
                                                            {fullBusy ? `Downloading ${fullPercent}%` : isDownloaded ? "Saved" : fullJob?.state === "failed" ? "Retry" : "Download"}
                                                          </button>
                                                          {fullBusy ? (
                                                            <button
                                                              onClick={() => onCancelFullDownload(episode)}
                                                              className="inline-flex h-8 items-center gap-1.5 rounded-full bg-red-500/20 px-3 text-[10px] font-bold uppercase tracking-[0.16em] text-red-300 transition hover:bg-red-500/30"
                                                              title="Cancel active download and remove partial files"
                                                            >
                                                              <X className="h-3.5 w-3.5" />
                                                              Cancel
                                                            </button>
                                                          ) : null}
                                                          {isDownloaded ? (
                                                            <button
                                                              onClick={() => onDeleteFullDownload(episode)}
                                                              className="inline-flex h-8 items-center gap-1.5 rounded-full bg-red-500/20 px-3 text-[10px] font-bold uppercase tracking-[0.16em] text-red-300 transition hover:bg-red-500/30"
                                                              title="Delete downloaded file"
                                                            >
                                                              <Trash2 className="h-3.5 w-3.5" />
                                                              Delete
                                                            </button>
                                                          ) : null}
                              <span className="rounded bg-white/5 px-2 py-1 text-[10px] font-bold uppercase tracking-wider text-white/30 truncate max-w-[100px]">
                                {episode.episodeCode ?? "N/A"}
                              </span>
                                                          <button
                                                            onClick={() => onSelectEpisode(episode)}
                                                            className="flex h-8 w-8 items-center justify-center rounded-full bg-white/10 opacity-100 transition-opacity hover:bg-white/20 sm:opacity-0 sm:group-hover:opacity-100 shrink-0"
                                                            title="Play episode"
                                                          >
                                                            <Play className="h-3 w-3 fill-white text-white" />
                                                          </button>
                            </div>
                                                        </div>
                                                        {fullBusy ? (
                                                          <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-white/10">
                                                            <div
                                                              className="h-full rounded-full bg-sky-400 transition-all duration-300"
                                                              style={{ width: `${Math.max(3, Math.min(fullPercent, 100))}%` }}
                                                            />
                                                          </div>
                                                        ) : null}
                                                        {fullJob?.state === "failed" && fullJob.error ? (
                                                          <div className="mt-2 text-[11px] text-red-300/80 truncate" title={fullJob.error}>
                                                            {fullJob.error}
                                                          </div>
                                                        ) : null}
                                                      </div>
                        );
                      })}
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      ) : null}
    </section>
  );
}
