import { useEffect, useMemo, useState } from "react";
import type { ArtworkSourceSettings, CastMember, ExploreItem, ImportedShow, LibraryEpisode, LibraryState, PersonCredit, UserTasteProfile } from "../lib/types";
import { ArrowLeft, ChevronDown, Download, ExternalLink, Heart, ImagePlus, Library, LoaderCircle, MoreHorizontal, Play, Trash2, X } from "lucide-react";
import { clsx } from "clsx";
import type { FullDownloadJob } from "../lib/full-download-client";
import { ArtworkPickerModal } from "./ArtworkPickerModal";
import { formatEpisodeTitle } from "../lib/episode-title";
import { balanceImageResolution, balancedBackgroundImage } from "../lib/image-resolution";
import { fetchCastForShow, fetchPersonCredits } from "../lib/import-client";
import { fetchExploreFeed } from "../lib/discovery-client";
import { getProviderLabel } from "../lib/command-search";
import { getOverlayBannerArtwork, getShowArtwork, getShowMetadata, getStandaloneBannerArtwork, getTitleDescription, getTitleMetadataParts } from "../lib/media-library";
import { getCanonicalLanguageKey } from "../lib/language";

type ShowDetailProps = {
  show: ImportedShow | null;
  relatedShows?: ImportedShow[];
  libraryState: LibraryState;
  tasteProfile: UserTasteProfile;
  onBack: () => void;
  onOpenRelatedShow?: (slug: string) => void;
  onSelectEpisode: (episode: LibraryEpisode) => void;
  onRemoveShow: () => void;
  onToggleFavorite: () => void;
  onUpdateArtwork: (artwork: {
    posterUrl?: string | null;
    backdropUrl?: string | null;
    bannerUrl?: string | null;
    bannerWithLogoUrl?: string | null;
    clearLogoUrl?: string | null;
  }) => void;
  onUpdateCast: (actors: CastMember[]) => void;
  artworkSources: ArtworkSourceSettings;
  fullDownloadJobsByEpisode: Record<string, FullDownloadJob>;
  onStartFullDownload: (episode: LibraryEpisode) => void;
  onCancelFullDownload: (episode: LibraryEpisode) => void;
  downloadedEpisodeIds: Set<string>;
  onDeleteFullDownload: (episode: LibraryEpisode) => void;
};

function isBusy(job: FullDownloadJob | undefined) {
  return Boolean(job && ["queued", "resolving", "downloading"].includes(job.state));
}

function episodeShortLabel(episode: LibraryEpisode | null) {
  if (!episode) return "Select episode";
  if (episode.episodeCode) return episode.episodeCode.toUpperCase();
  if (episode.episodeNumber != null) {
    return `S${episode.seasonNumber}E${String(episode.episodeNumber).padStart(2, "0")}`;
  }
  return `S${episode.seasonNumber}`;
}

function hasCzechSubtitles(episode: LibraryEpisode) {
  return episode.players.some((player) => {
    if (!player.subtitlesUrl) return false;
    const key = getCanonicalLanguageKey(player.language);
    return key.includes("cz") && key.includes("subs");
  });
}

function initialsForName(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("");
}

function normalizePersonName(value: string | null | undefined) {
  return String(value ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function normalizeTitleKey(value: string | null | undefined) {
  return normalizePersonName(value);
}

function yearsOverlap(left: string | null | undefined, right: string | null | undefined) {
  const leftYear = String(left ?? "").match(/\b(19|20)\d{2}\b/)?.[0] ?? null;
  const rightYear = String(right ?? "").match(/\b(19|20)\d{2}\b/)?.[0] ?? null;
  return !leftYear || !rightYear || leftYear === rightYear;
}

function showHasActor(show: ImportedShow, actor: CastMember) {
  const targetName = normalizePersonName(actor.name);
  if (!targetName) return false;
  return (show.actors ?? []).some((entry) => {
    const entryName = normalizePersonName(entry.name);
    return entryName === targetName || entryName.includes(targetName) || targetName.includes(entryName);
  });
}

function findVaultShowForCredit(credit: PersonCredit, shows: ImportedShow[]) {
  const creditTitle = normalizeTitleKey(credit.title);
  return shows.find((show) => {
    const titleMatches = normalizeTitleKey(show.title) === creditTitle || normalizeTitleKey(show.altTitle) === creditTitle;
    return titleMatches && yearsOverlap(credit.year, show.years);
  }) ?? null;
}

function findSourceItemForCredit(credit: PersonCredit, items: ExploreItem[]) {
  const creditTitle = normalizeTitleKey(credit.title);
  return items.find((item) => {
    const titleMatches = normalizeTitleKey(item.title) === creditTitle || (item.alternateTitles ?? []).some((title) => normalizeTitleKey(title) === creditTitle);
    return titleMatches && yearsOverlap(credit.year, item.yearLabel ?? item.year);
  }) ?? null;
}

function findVaultShowForExploreItem(item: Pick<ExploreItem, "provider" | "importSlug">, shows: ImportedShow[]) {
  return shows.find((show) => {
    if (item.provider === "vidking") {
      const match = item.importSlug.match(/^(movie|tv)\/(\d+)/i);
      return match ? show.slug === `vidking-${match[1].toLowerCase()}-${match[2]}` : show.slug === item.importSlug;
    }
    if (item.provider === "bombuj") {
      return show.slug === `bombuj-${item.importSlug}`;
    }
    if (item.provider === "cineby") {
      const match = item.importSlug.match(/^(movie|tv)\/(\d+)/i);
      return match ? show.slug === `cineby-${match[1].toLowerCase()}-${match[2]}` : show.slug === item.importSlug;
    }
    return show.slug === item.importSlug;
  }) ?? null;
}

export function ShowDetail({
  show,
  relatedShows = [],
  libraryState,
  tasteProfile,
  onBack,
  onOpenRelatedShow,
  onSelectEpisode,
  onRemoveShow,
  onToggleFavorite,
  onUpdateArtwork,
  onUpdateCast,
  artworkSources,
  fullDownloadJobsByEpisode,
  onStartFullDownload,
  onCancelFullDownload,
  downloadedEpisodeIds,
  onDeleteFullDownload,
}: ShowDetailProps) {
  const [selectedSeason, setSelectedSeason] = useState<number | null>(null);
  const [episodeMenuOpen, setEpisodeMenuOpen] = useState(false);
  const [actionsOpen, setActionsOpen] = useState(false);
  const [editingArtwork, setEditingArtwork] = useState(false);
  const [fetchedActors, setFetchedActors] = useState<CastMember[]>([]);
  const [castLoading, setCastLoading] = useState(false);
  const [selectedActor, setSelectedActor] = useState<CastMember | null>(null);
  const [actorCredits, setActorCredits] = useState<PersonCredit[]>([]);
  const [actorCatalog, setActorCatalog] = useState<ExploreItem[]>([]);
  const [actorCatalogLoading, setActorCatalogLoading] = useState(false);
  const [actorCatalogError, setActorCatalogError] = useState<string | null>(null);

  const sortedEpisodes = useMemo(() => {
    if (!show) return [];
    return [...show.episodes].sort((left, right) => {
      if (left.seasonNumber !== right.seasonNumber) return left.seasonNumber - right.seasonNumber;
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
  const movieEpisode = sortedEpisodes.length === 1 ? sortedEpisodes[0] : null;
  const activeSeason = selectedSeason ?? latestEpisode?.seasonNumber ?? seasons[0]?.[0] ?? null;
  const activeSeasonEpisodes = seasons.find(([season]) => season === activeSeason)?.[1] ?? [];
  const showArtwork = getShowArtwork(show);
  const showMetadata = getShowMetadata(show);
  const heroBackdrop = getOverlayBannerArtwork(show).bannerUrl;
  const movieJob = movieEpisode ? fullDownloadJobsByEpisode[movieEpisode.id] : undefined;
  const movieBusy = isBusy(movieJob);
  const movieDownloaded = Boolean(movieEpisode && (downloadedEpisodeIds.has(movieEpisode.id) || movieJob?.state === "completed"));
  const moviePercent = movieJob?.percent ?? 0;

  const heroMetadata = getTitleMetadataParts(show);

  const displayDescription = getTitleDescription(show) ?? "No description available.";

  const actors = showMetadata?.actors?.length ? showMetadata.actors : show?.actors?.length ? show.actors : fetchedActors;
  const directors = showMetadata?.directors ?? [];
  const localActorShows = useMemo(() => {
    if (!selectedActor) return [];
    return libraryState.shows.filter((entry) => showHasActor(entry, selectedActor));
  }, [libraryState.shows, selectedActor]);
  const visibleActorCatalog = useMemo(() => {
    const localSlugs = new Set(localActorShows.map((entry) => entry.slug));
    return actorCatalog.filter((item) => {
      const vaultShow = findVaultShowForExploreItem(item, libraryState.shows);
      return !vaultShow || !localSlugs.has(vaultShow.slug);
    });
  }, [actorCatalog, libraryState.shows, localActorShows]);
  const visibleActorCredits = useMemo(() => {
    const seen = new Set<string>();
    return actorCredits.filter((credit) => {
      const key = `${credit.mediaType}:${credit.tmdbId}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }, [actorCredits]);
  const actorCreditTiles = useMemo<PersonCredit[]>(() => {
    if (visibleActorCredits.length > 0) return visibleActorCredits;
    return visibleActorCatalog.map((item) => ({
      id: `${item.provider}:${item.importSlug}`,
      tmdbId: Number.parseInt(item.id.match(/\d+/)?.[0] ?? "0", 10) || 0,
      title: item.title,
      mediaType: item.mediaType,
      role: null,
      year: item.yearLabel ?? item.year ?? null,
      posterUrl: item.posterUrl ?? null,
      backdropUrl: item.backdropUrl ?? item.bannerUrl ?? null,
      description: item.description ?? null,
    }));
  }, [visibleActorCatalog, visibleActorCredits]);

  useEffect(() => {
    setEditingArtwork(false);
    setEpisodeMenuOpen(false);
    setActionsOpen(false);
    setSelectedActor(null);
    setActorCredits([]);
    setActorCatalog([]);
    setActorCatalogError(null);
    setSelectedSeason(null);
    setFetchedActors([]);
    setCastLoading(false);
  }, [show?.slug, showArtwork.posterUrl, showArtwork.backdropUrl, showArtwork.clearLogoUrl]);

  useEffect(() => {
    if (!episodeMenuOpen) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setEpisodeMenuOpen(false);
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [episodeMenuOpen]);

  useEffect(() => {
    let canceled = false;
    if (!show || actors.length) return;
    setCastLoading(true);
    void fetchCastForShow(show)
      .then((cast) => {
        if (!canceled) {
          setFetchedActors(cast);
          if (cast.length > 0) onUpdateCast(cast);
        }
      })
      .catch(() => {
        if (!canceled) setFetchedActors([]);
      })
      .finally(() => {
        if (!canceled) setCastLoading(false);
      });
    return () => {
      canceled = true;
    };
  }, [show, actors.length, onUpdateCast]);

  useEffect(() => {
    let canceled = false;
    if (!selectedActor) return;

    setActorCatalogLoading(true);
    setActorCatalogError(null);
    setActorCredits([]);
    setActorCatalog([]);
    const loadActorCatalog = async () => {
      const items: ExploreItem[] = [];
      let cursor: string | null = null;
      do {
        const feed = await fetchExploreFeed({
          query: "",
          filters: {
            mediaTypes: [],
            providers: [],
            genres: [],
            audioBuckets: [],
            networks: [],
            sections: [],
            inVault: "all",
            availability: "all",
            personQuery: selectedActor.name,
            personRole: "actor",
          },
          cursor,
          limit: 120,
          librarySnapshot: libraryState,
          tasteProfile,
        });
        items.push(...feed.items);
        cursor = feed.continueCursor;
      } while (cursor);
      return items;
    };

    void Promise.allSettled([fetchPersonCredits(selectedActor.name), loadActorCatalog()])
      .then(([creditsResult, catalogResult]) => {
        if (!canceled) {
          const credits = creditsResult.status === "fulfilled" ? creditsResult.value : [];
          const catalog = catalogResult.status === "fulfilled" ? catalogResult.value : [];
          setActorCredits(credits);
          setActorCatalog(catalog.map((item) => ({ ...item, inVault: Boolean(findVaultShowForExploreItem(item, libraryState.shows)) })));
          if (creditsResult.status === "rejected" && catalogResult.status === "rejected") {
            setActorCatalogError(creditsResult.reason instanceof Error ? creditsResult.reason.message : "Could not load this actor's catalogue.");
          }
        }
      })
      .catch((error: unknown) => {
        if (!canceled) {
          setActorCatalog([]);
          setActorCatalogError(error instanceof Error ? error.message : "Could not load this actor's catalogue.");
        }
      })
      .finally(() => {
        if (!canceled) setActorCatalogLoading(false);
      });

    return () => {
      canceled = true;
    };
  }, [libraryState, selectedActor, tasteProfile]);

  if (!show) {
    return (
      <section className="min-h-screen bg-[#08090d] px-5 py-6 text-white">
        <button onClick={onBack} className="inline-flex h-11 items-center gap-2 rounded-full bg-white/10 px-4 text-sm font-bold text-white hover:bg-white/16">
          <ArrowLeft className="h-4 w-4" />
          Back to library
        </button>
        <div className="mt-10 text-sm font-bold text-white/70">Show not found.</div>
      </section>
    );
  }

  return (
    <section className="relative overflow-hidden bg-[#08090d] pb-28 text-white lg:pb-0">
      <div className="animate-detail-hero-open relative min-h-[100svh] origin-top overflow-hidden lg:min-h-[46rem]" style={{ viewTransitionName: `spilled-hero-${show.slug}` }}>
        {heroBackdrop ? (
          <div className="absolute inset-0">
            <div className="absolute inset-0 scale-[1.01] bg-cover bg-center" style={balancedBackgroundImage(heroBackdrop, showArtwork.backdropUrl || showArtwork.bannerUrl ? "backdrop-hero" : "poster-detail")} />
            <div className="absolute inset-0 bg-[radial-gradient(circle_at_72%_35%,rgba(8,9,13,0.1),rgba(8,9,13,0.76)_58%,#08090d_100%)]" />
            <div className="absolute inset-0 bg-gradient-to-r from-[#08090d]/95 via-[#08090d]/38 to-[#08090d]/74" />
            <div className="absolute inset-x-0 bottom-0 h-[48%] bg-gradient-to-t from-[#08090d] via-[#08090d]/74 to-transparent" />
            <div className="absolute inset-0 shadow-[inset_0_0_90px_rgba(0,0,0,0.96)]" />
          </div>
        ) : (
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_65%_20%,rgba(42,48,40,0.7),rgba(8,9,13,1)_62%)]" />
        )}

        <div className="relative z-20 flex min-h-[100svh] flex-col px-4 pb-28 pt-4 sm:px-8 lg:min-h-[46rem] lg:px-12 lg:pb-10 lg:pt-6">
          <div className="pointer-events-none absolute inset-x-0 top-0 z-30 flex items-start justify-between px-5 pt-6 sm:px-8 lg:px-12">
            <div className="pointer-events-auto flex items-center gap-3">
              <button onClick={onBack} className="spilled-glass-icon h-10 w-10" aria-label="Back to library">
                <ArrowLeft className="h-5 w-5" />
              </button>
              <img src="/Spilled.svg" alt="Spilled" className="hidden h-11 w-auto drop-shadow-[0_6px_18px_rgba(0,0,0,0.75)] sm:block" />
            </div>

            <div className="pointer-events-auto absolute left-1/2 top-4 w-[min(58vw,23rem)] -translate-x-1/2 sm:top-6 sm:w-[min(74vw,23rem)]">
              {sortedEpisodes.length > 1 ? (
                <div className="relative">
                  <button
                    type="button"
                    onClick={() => setEpisodeMenuOpen((value) => !value)}
                    className="spilled-glass-trigger mx-auto h-11 max-w-full px-3 pl-4"
                    aria-expanded={episodeMenuOpen}
                  >
                    <span className="shrink-0 text-xs font-black text-white/34">{episodeShortLabel(latestEpisode)}</span>
                    <span className="min-w-0 truncate text-sm font-black leading-none text-white sm:text-lg">{latestEpisode ? formatEpisodeTitle(latestEpisode) : "Episodes"}</span>
                    <span className="ml-auto flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-white/8 ring-1 ring-white/10">
                      <ChevronDown className={clsx("h-4 w-4 text-white/70 transition-transform", episodeMenuOpen && "rotate-180")} />
                    </span>
                  </button>

                  {episodeMenuOpen ? (
                    <div className="spilled-episode-picker absolute left-1/2 top-14 w-[min(90vw,33rem)] -translate-x-1/2 p-3">
                      <div className="grid max-h-[23rem] grid-cols-[3.75rem_minmax(0,1fr)] gap-3">
                        <div className="spilled-season-rail">
                          {seasons.map(([seasonNumber]) => (
                            <button
                              key={seasonNumber}
                              type="button"
                              onClick={() => setSelectedSeason(seasonNumber)}
                              className={clsx(
                                "spilled-season-tab",
                                activeSeason === seasonNumber && "spilled-season-tab-active",
                              )}
                            >
                              S{seasonNumber}
                            </button>
                          ))}
                        </div>

                        <div className="custom-scrollbar flex max-h-[21.5rem] min-w-0 flex-col gap-1 overflow-y-auto pr-1">
                          {activeSeasonEpisodes.map((episode) => {
                            const fullJob = fullDownloadJobsByEpisode[episode.id];
                            const fullBusy = isBusy(fullJob);
                            const fullPercent = fullJob?.percent ?? 0;
                            const isDownloaded = downloadedEpisodeIds.has(episode.id) || fullJob?.state === "completed";
                            const episodeTitle = formatEpisodeTitle(episode);
                            const hasCzSubs = hasCzechSubtitles(episode);
                            return (
                              <div key={episode.id} className="spilled-episode-row group">
                                <button
                                  type="button"
                                  onClick={() => {
                                    setEpisodeMenuOpen(false);
                                    onSelectEpisode(episode);
                                  }}
                                  className="flex min-w-0 flex-1 items-center gap-3 text-left"
                                  title={episodeTitle}
                                >
                                  <span className="spilled-episode-code">{episodeShortLabel(episode)}</span>
                                  <span className="min-w-0 flex-1 truncate text-sm font-black leading-tight text-white">{episodeTitle}</span>
                                  {hasCzSubs ? <span className="spilled-subtitle-tag" title="Czech subtitles">CZ TIT</span> : null}
                                </button>

                                <div className="flex shrink-0 items-center gap-1.5">
                                  <button
                                    type="button"
                                    onClick={(event) => {
                                      event.stopPropagation();
                                      if (fullBusy || isDownloaded) return;
                                      onStartFullDownload(episode);
                                    }}
                                    className={clsx(
                                      "spilled-episode-action",
                                      isDownloaded
                                        ? "bg-sky-400/16 text-sky-100 ring-sky-300/15 hover:bg-sky-400/24"
                                        : fullJob?.state === "failed"
                                          ? "bg-red-400/16 text-red-100 ring-red-300/15 hover:bg-red-400/24"
                                          : "bg-white/[0.07] text-white/58 ring-white/[0.08] hover:bg-white/12 hover:text-white",
                                    )}
                                    title={fullBusy ? `Downloading ${fullPercent}%` : isDownloaded ? "Saved" : fullJob?.state === "failed" ? "Retry download" : "Download full video"}
                                  >
                                    {fullBusy ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
                                  </button>
                                  {fullBusy ? (
                                    <button type="button" onClick={() => onCancelFullDownload(episode)} className="spilled-episode-action bg-red-400/16 text-red-100 ring-red-300/15 hover:bg-red-400/24" title="Cancel download">
                                      <X className="h-4 w-4" />
                                    </button>
                                  ) : null}
                                  {isDownloaded ? (
                                    <button type="button" onClick={() => onDeleteFullDownload(episode)} className="spilled-episode-action bg-red-400/16 text-red-100 ring-red-300/15 hover:bg-red-400/24" title="Delete downloaded file">
                                      <Trash2 className="h-4 w-4" />
                                    </button>
                                  ) : null}
                                </div>
                                {fullBusy ? (
                                  <div className="absolute inset-x-3 bottom-1 h-1 overflow-hidden rounded-full bg-white/10">
                                    <div className="h-full rounded-full bg-sky-300" style={{ width: `${Math.max(3, Math.min(fullPercent, 100))}%` }} />
                                  </div>
                                ) : null}
                                {fullJob?.state === "failed" && fullJob.error ? <div className="absolute inset-x-4 bottom-1 truncate text-[10px] font-bold text-red-200/80" title={fullJob.error}>{fullJob.error}</div> : null}
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    </div>
                  ) : null}
                </div>
              ) : null}
            </div>

            <div className="pointer-events-auto relative">
              <button type="button" onClick={() => setActionsOpen((value) => !value)} className="spilled-glass-icon h-10 w-10" aria-label="More actions">
                <MoreHorizontal className="h-5 w-5" />
              </button>
              {actionsOpen ? (
                <div className="spilled-floating-panel absolute right-0 top-12 w-56 p-2">
                  <button type="button" onClick={() => setEditingArtwork(true)} className="spilled-menu-row">
                    <ImagePlus className="h-4 w-4" />
                    Edit artwork
                  </button>
                  <button type="button" onClick={onToggleFavorite} className="spilled-menu-row">
                    <Heart className={clsx("h-4 w-4", show.isFavorite && "fill-red-400 text-red-400")} />
                    {show.isFavorite ? "Favorited" : "Favorite"}
                  </button>
                  <button type="button" onClick={onRemoveShow} className="spilled-menu-row text-red-200 hover:bg-red-500/12 hover:text-red-100">
                    <Trash2 className="h-4 w-4" />
                    Remove
                  </button>
                </div>
              ) : null}
            </div>
          </div>

          <div className="relative z-10 mt-auto max-w-[46rem] pb-5 pt-40 sm:pt-48 lg:pb-[9vh] lg:pl-7">
            {showArtwork.clearLogoUrl ? (
              <img
                src={balanceImageResolution(showArtwork.clearLogoUrl, "logo") ?? showArtwork.clearLogoUrl}
                alt={`${show.title} logo`}
                className="mb-4 max-h-32 max-w-[min(84vw,34rem)] object-contain drop-shadow-[0_12px_34px_rgba(0,0,0,0.92)]"
                loading="eager"
                decoding="async"
                style={{ viewTransitionName: `spilled-title-${show.slug}` }}
              />
            ) : (
              <h1 className="mb-3 max-w-[min(88vw,38rem)] text-4xl font-black uppercase leading-[0.88] tracking-normal text-white drop-shadow-[3px_0_0_#f26d21,-3px_0_0_#2b69ff,0_14px_30px_rgba(0,0,0,0.86)] sm:text-7xl lg:text-8xl" style={{ viewTransitionName: `spilled-title-${show.slug}` }}>
                {show.title}
              </h1>
            )}

            {show.altTitle ? <div className="mb-3 text-sm font-black text-white/58">{show.altTitle}</div> : null}
            <div className="mb-3 flex flex-wrap items-center gap-x-2 gap-y-1 text-base font-black text-white sm:text-lg" style={{ viewTransitionName: `spilled-meta-${show.slug}` }}>
              {heroMetadata.map((entry, index) => (
                <span key={`${entry.kind}:${entry.label}`} className="inline-flex items-center gap-2">
                  {index > 0 ? <span className="text-white/45">{"\u2022"}</span> : null}
                  {entry.kind === "rating" ? <img src="/rating-icon.png" alt="" className="h-4 w-4 shrink-0" /> : null}
                  {entry.label}
                </span>
              ))}
            </div>
            <p className="line-clamp-4 max-w-[44rem] text-[13px] font-medium leading-snug text-white/88 drop-shadow-[0_2px_14px_rgba(0,0,0,0.85)] sm:line-clamp-none sm:text-base">
              {displayDescription}
            </p>

            <div className="mt-6 flex flex-wrap items-center gap-3">
              {latestEpisode ? (
                <button onClick={() => onSelectEpisode(latestEpisode)} className="inline-flex h-9 items-center gap-2 rounded-full bg-white px-4 text-sm font-black text-black shadow-[0_10px_28px_rgba(0,0,0,0.35)] transition hover:bg-white/90">
                  <Play className="h-4 w-4 fill-black text-black" />
                  PLAY
                </button>
              ) : null}
              {movieEpisode ? (
                <>
                  <button
                    onClick={() => {
                      if (movieBusy || movieDownloaded) return;
                      onStartFullDownload(movieEpisode);
                    }}
                    className={clsx(
                      "inline-flex h-9 items-center gap-2 rounded-full border px-4 text-sm font-black transition",
                      movieDownloaded
                        ? "border-sky-300/20 bg-sky-400/16 text-sky-100"
                        : movieJob?.state === "failed"
                          ? "border-red-300/20 bg-red-400/16 text-red-100 hover:bg-red-400/24"
                          : "border-white/10 bg-white/10 text-white hover:bg-white/16",
                    )}
                  >
                    {movieBusy ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
                    {movieBusy ? `${moviePercent}%` : movieDownloaded ? "SAVED" : movieJob?.state === "failed" ? "RETRY" : "DOWNLOAD"}
                  </button>
                  {movieBusy ? (
                    <button onClick={() => onCancelFullDownload(movieEpisode)} className="inline-flex h-9 items-center gap-2 rounded-full border border-red-300/20 bg-red-400/16 px-4 text-sm font-black text-red-100 hover:bg-red-400/24">
                      <X className="h-4 w-4" />
                      CANCEL
                    </button>
                  ) : null}
                  {movieDownloaded ? (
                    <button onClick={() => onDeleteFullDownload(movieEpisode)} className="inline-flex h-9 items-center gap-2 rounded-full border border-red-300/20 bg-red-400/16 px-4 text-sm font-black text-red-100 hover:bg-red-400/24">
                      <Trash2 className="h-4 w-4" />
                      DELETE
                    </button>
                  ) : null}
                </>
              ) : null}
            </div>

            {movieEpisode && movieBusy ? (
              <div className="mt-4 h-1.5 w-full max-w-md overflow-hidden rounded-full bg-white/10">
                <div className="h-full rounded-full bg-sky-300 transition-all duration-300" style={{ width: `${Math.max(3, Math.min(moviePercent, 100))}%` }} />
              </div>
            ) : null}
            {movieEpisode && movieJob?.state === "failed" && movieJob.error ? <div className="mt-3 max-w-md text-sm text-red-200/90" title={movieJob.error}>{movieJob.error}</div> : null}
          </div>
        </div>
      </div>

      <div className="animate-detail-content-open relative z-10 border-t border-white/[0.04] bg-[#050609] px-5 pb-2 pt-8 sm:px-8 lg:px-12">
        {directors.length > 0 ? (
          <div className="mb-7 rounded-2xl border border-white/[0.08] bg-white/[0.025] px-4 py-4">
            <div className="mb-2 text-[11px] font-black uppercase tracking-[0.24em] text-white/34">Directed by</div>
            <div className="flex flex-wrap gap-2">
              {directors.map((director, index) => (
                <span key={`${director.name}:${index}`} className="rounded-full bg-white/8 px-3 py-1.5 text-sm font-bold text-white/78">
                  {director.name}
                </span>
              ))}
            </div>
          </div>
        ) : null}

        {sortedEpisodes.length > 1 ? (
          <section className="mb-9" aria-labelledby="episode-browser-heading">
            <div className="mb-4 flex items-center justify-between gap-4">
              <div id="episode-browser-heading" className="inline-flex items-center gap-2 text-2xl font-black text-white">
                <img src="/spilled-star.svg" alt="" className="h-4 w-4" />
                Episodes
              </div>
              <span className="text-xs font-bold text-white/32">{sortedEpisodes.length} available</span>
            </div>
            <div className="no-scrollbar mb-4 flex gap-2 overflow-x-auto pb-1">
              {seasons.map(([seasonNumber, episodes]) => (
                <button key={seasonNumber} type="button" onClick={() => setSelectedSeason(seasonNumber)} className={clsx("shrink-0 rounded-full border px-4 py-2 text-xs font-black transition", activeSeason === seasonNumber ? "border-white bg-white text-black" : "border-white/10 bg-white/[0.035] text-white/52 hover:bg-white/[0.08] hover:text-white")}>
                  Season {seasonNumber} <span className="ml-1 opacity-50">{episodes.length}</span>
                </button>
              ))}
            </div>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
              {activeSeasonEpisodes.map((episode) => (
                <button key={episode.id} type="button" onClick={() => onSelectEpisode(episode)} className="group min-w-0 rounded-xl border border-white/[0.08] bg-white/[0.025] p-3 text-left transition hover:border-white/18 hover:bg-white/[0.065] active:scale-[0.98]">
                  <div className="mb-2 flex items-center justify-between gap-2">
                    <span className="text-[10px] font-black uppercase tracking-[0.18em] text-white/35">{episodeShortLabel(episode)}</span>
                    <Play className="h-3.5 w-3.5 fill-white/65 text-white/65 transition group-hover:fill-white group-hover:text-white" />
                  </div>
                  <div className="truncate text-sm font-black text-white">{formatEpisodeTitle(episode)}</div>
                  {hasCzechSubtitles(episode) ? <div className="mt-1 text-[9px] font-black uppercase tracking-[0.14em] text-sky-200/70">Czech subtitles</div> : null}
                </button>
              ))}
            </div>
          </section>
        ) : null}

        <div className="mb-5 inline-flex items-center gap-2 bg-[#050609] pr-8 text-2xl font-black text-white">
          <img src="/spilled-star.svg" alt="" className="h-4 w-4" />
          Actors
        </div>
        {actors.length > 0 ? (
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {actors.slice(0, 12).map((actor, index) => (
              <button key={`${actor.name}:${index}`} type="button" onClick={() => setSelectedActor(actor)} className="flex min-w-0 items-center gap-3 rounded-xl border border-white/[0.08] bg-white/[0.025] px-3 py-3 text-left transition hover:border-white/16 hover:bg-white/[0.055]">
                <div className="h-12 w-12 shrink-0 overflow-hidden rounded-full bg-white/10">
                  {actor.profileUrl ? (
                    <img src={actor.profileUrl} alt={actor.name} className="h-full w-full object-cover" loading="lazy" decoding="async" />
                  ) : (
                    <div className="flex h-full w-full items-center justify-center text-sm font-black text-white/54">{initialsForName(actor.name)}</div>
                  )}
                </div>
                <div className="min-w-0">
                  <div className="truncate text-sm font-black text-white">{actor.name}</div>
                  {actor.role ? <div className="truncate text-xs font-semibold text-sky-200/68">{actor.role}</div> : null}
                </div>
              </button>
            ))}
          </div>
        ) : (
          <div className="rounded-xl border border-white/[0.08] bg-white/[0.025] px-4 py-5 text-sm font-semibold text-white/38">
            {castLoading ? "Loading cast..." : "Cast is unavailable for this title."}
          </div>
        )}
      </div>

      {relatedShows.length > 0 ? (
        <div className="animate-detail-content-open-late relative z-10 border-t border-white/[0.04] bg-[#08090d] px-5 pb-24 pt-8 sm:px-8 lg:px-12">
          <div className="mb-5 inline-flex items-center gap-2 bg-[#08090d] pr-8 text-2xl font-black text-white">
            <img src="/spilled-star.svg" alt="" className="h-4 w-4" />
            You may like
          </div>
          <div className="no-scrollbar flex gap-7 overflow-x-auto pb-4">
            {relatedShows.map((entry) => {
              const artwork = getStandaloneBannerArtwork(entry);
              return (
                <button
                  key={entry.slug}
                  type="button"
                  onClick={() => onOpenRelatedShow?.(entry.slug)}
                  className="group relative aspect-[16/7] w-[78vw] max-w-[31rem] shrink-0 overflow-hidden rounded-2xl bg-white/8 text-left shadow-[0_18px_42px_rgba(0,0,0,0.4)]"
                  aria-label={`Open ${entry.title}`}
                >
                  {artwork ? (
                    <div className="absolute inset-0 bg-cover bg-center transition duration-700 group-hover:scale-105" style={balancedBackgroundImage(artwork, "backdrop-thumb")} />
                  ) : null}
                  <div className="absolute inset-0 bg-black/0 transition-colors group-hover:bg-white/[0.04]" />
                </button>
              );
            })}
          </div>
        </div>
      ) : null}

      <ArtworkPickerModal
        show={show}
        open={editingArtwork}
        artworkSources={artworkSources}
        onClose={() => setEditingArtwork(false)}
        onApplyArtwork={onUpdateArtwork}
      />

      {selectedActor ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-black/72 px-3 py-5 backdrop-blur-md sm:px-6 sm:py-8" role="dialog" aria-modal="true" aria-label={`${selectedActor.name} catalogue`} onMouseDown={() => setSelectedActor(null)}>
          <div className="relative flex max-h-[88vh] w-full max-w-5xl flex-col overflow-hidden rounded-2xl border border-white/10 bg-[#07080c]/96 shadow-[0_34px_120px_rgba(0,0,0,0.82)] ring-1 ring-black/60" onMouseDown={(event) => event.stopPropagation()}>
            <div className="relative border-b border-white/[0.07] px-5 py-5 sm:px-7">
              <button type="button" onClick={() => setSelectedActor(null)} className="absolute right-4 top-4 flex h-9 w-9 items-center justify-center rounded-xl bg-white/8 text-white shadow-[0_12px_30px_rgba(0,0,0,0.25)] ring-1 ring-white/10 backdrop-blur-md transition hover:bg-white/14" aria-label="Close actor catalogue">
                <X className="h-5 w-5" />
              </button>
              <div className="flex min-w-0 items-center gap-4 pr-12">
                <div className="h-20 w-20 shrink-0 overflow-hidden rounded-2xl bg-white/8 ring-1 ring-white/10">
                    {selectedActor.profileUrl ? (
                      <img src={selectedActor.profileUrl} alt={selectedActor.name} className="h-full w-full object-cover" />
                    ) : (
                      <div className="flex h-full w-full items-center justify-center text-2xl font-black text-white/54">{initialsForName(selectedActor.name)}</div>
                    )}
                  </div>
                <div className="min-w-0">
                  <div className="text-[10px] font-black uppercase tracking-[0.24em] text-white/34">Actor</div>
                  <div className="mt-1 truncate text-3xl font-black leading-none text-white sm:text-4xl">{selectedActor.name}</div>
                  {selectedActor.role ? <div className="mt-2 truncate text-sm font-bold text-white/45">{selectedActor.role}</div> : null}
                  <div className="mt-3 flex flex-wrap gap-2 text-[11px] font-black uppercase tracking-[0.12em] text-white/50">
                    <span className="rounded-lg bg-white/[0.06] px-2.5 py-1 ring-1 ring-white/[0.08]">{localActorShows.length} in library</span>
                    <span className="rounded-lg bg-white/[0.06] px-2.5 py-1 ring-1 ring-white/[0.08]">{actorCreditTiles.length} credits</span>
                  </div>
                </div>
              </div>
            </div>

            <div className="custom-scrollbar overflow-y-auto px-5 pb-7 pt-6 sm:px-7">

              {localActorShows.length > 0 ? (
                <section className="mt-8">
                  <div className="mb-4 flex items-center gap-2 text-xl font-black text-white">
                    <Library className="h-5 w-5" />
                    In library
                  </div>
                  <div className="no-scrollbar flex gap-4 overflow-x-auto pb-2">
                    {localActorShows.map((entry) => {
                      const artwork = getStandaloneBannerArtwork(entry);
                      const entryMediaLabel = entry.mediaType === "movie" || entry.episodes.length <= 1 ? "Movie" : "TV Show";
                      return (
                        <button key={entry.slug} type="button" onClick={() => onOpenRelatedShow?.(entry.slug)} className="group w-[78vw] max-w-[420px] shrink-0 text-left sm:w-[31rem]">
                          <div className="relative aspect-[16/7] overflow-hidden rounded-2xl bg-white/8">
                            {artwork ? (
                              <div className="absolute inset-0 bg-cover bg-center transition duration-700 group-hover:scale-105" style={balancedBackgroundImage(artwork, "backdrop-thumb")} />
                            ) : null}
                            <div className="absolute left-3 top-3 inline-flex items-center gap-1.5 rounded-full bg-white px-2.5 py-1 text-[11px] font-black uppercase text-black">
                              <Library className="h-3 w-3" />
                              In library
                            </div>
                          </div>
                          <div className="mt-3 min-w-0">
                            <div className="line-clamp-1 text-base font-black text-white">{entry.title}</div>
                            <div className="mt-1 flex min-w-0 items-center gap-1.5 overflow-hidden whitespace-nowrap text-xs font-semibold text-white/45">
                              {[entry.years, entryMediaLabel].filter(Boolean).map((part, index) => (
                                <span key={`${entry.slug}:${part}`} className="flex min-w-0 items-center gap-1.5">
                                  {index > 0 ? <span className="h-1 w-1 shrink-0 rounded-full bg-white/24" /> : null}
                                  <span className="min-w-0 truncate">{part}</span>
                                </span>
                              ))}
                            </div>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </section>
              ) : null}

              <section className="mt-8">
                <div className="mb-4 flex items-center justify-between gap-4">
                  <div className="text-xl font-black text-white">Credits</div>
                  {actorCatalogLoading ? <div className="flex items-center gap-2 text-xs font-black uppercase tracking-[0.2em] text-white/34"><LoaderCircle className="h-4 w-4 animate-spin" />Loading</div> : null}
                </div>

                {actorCatalogError ? (
                  <div className="rounded-2xl border border-red-300/15 bg-red-400/10 px-4 py-5 text-sm font-semibold text-red-100">{actorCatalogError}</div>
                ) : actorCreditTiles.length > 0 ? (
                  <div className="grid grid-cols-2 gap-x-4 gap-y-7 sm:grid-cols-3 lg:grid-cols-5">
                    {actorCreditTiles.map((credit) => {
                      const artwork = credit.posterUrl ?? credit.backdropUrl ?? null;
                      const vaultShow = findVaultShowForCredit(credit, libraryState.shows);
                      const sourceItem = findSourceItemForCredit(credit, actorCatalog);
                      return (
                        <div key={credit.id} className="group min-w-0 text-left">
                          <button
                            type="button"
                            onClick={() => {
                              if (vaultShow) {
                                onOpenRelatedShow?.(vaultShow.slug);
                              } else if (sourceItem?.detailUrl) {
                                window.open(sourceItem.detailUrl, "_blank", "noopener,noreferrer");
                              }
                            }}
                            className="relative block aspect-[2/3] w-full overflow-hidden rounded-xl bg-white/8 text-left"
                          >
                            {artwork ? (
                              <div className="absolute inset-0 bg-cover bg-center transition duration-700 group-hover:scale-105" style={balancedBackgroundImage(artwork, credit.posterUrl ? "poster-card" : "backdrop-thumb")} />
                            ) : null}
                            {vaultShow ? (
                              <div className="absolute left-2 top-2 inline-flex items-center gap-1 rounded-full bg-white px-2 py-1 text-[10px] font-black uppercase text-black">
                                <Library className="h-3 w-3" />
                                In library
                              </div>
                            ) : null}
                          </button>
                          <div className="mt-3 flex min-w-0 items-start gap-2">
                            <div className="min-w-0 flex-1">
                              <div className="line-clamp-1 text-sm font-black text-white sm:text-base">{credit.title}</div>
                              <div className="mt-1 line-clamp-1 text-xs font-semibold text-white/45">
                                {[credit.year, credit.mediaType === "serial" ? "TV Show" : "Movie", sourceItem ? getProviderLabel(sourceItem.provider) : null].filter(Boolean).join("  |  ")}
                              </div>
                              {credit.role ? <div className="mt-1 line-clamp-1 text-[11px] font-semibold text-white/32">{credit.role}</div> : null}
                            </div>
                            {sourceItem?.detailUrl && !vaultShow ? (
                              <a href={sourceItem.detailUrl} target="_blank" rel="noreferrer" className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-white/40 transition hover:bg-white/8 hover:text-white/78" aria-label={`Open ${credit.title} source`}>
                                <ExternalLink className="h-4 w-4" />
                              </a>
                            ) : null}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ) : actorCatalogLoading ? (
                  <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
                    {Array.from({ length: 10 }).map((_, index) => (
                      <div key={index} className="aspect-[2/3] animate-pulse rounded-xl bg-white/[0.055]" />
                    ))}
                  </div>
                ) : (
                  <div className="rounded-2xl border border-white/[0.08] bg-white/[0.035] px-4 py-8 text-center text-sm font-semibold text-white/42">No credits found for this actor.</div>
                )}
              </section>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}
