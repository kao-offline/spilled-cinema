import type { ImportedShow, LibraryArtworkSet, LibraryEpisode, LibraryTitleMetadata } from "./types";

export const TITLE_METADATA_ENRICHMENT_VERSION = 2;

export type TitleMetadataFallback = {
  year?: string | null;
  genres?: string[] | null;
  csfdRating?: string | number | null;
  description?: string | null;
  runtimeMinutes?: number | null;
  seasonCount?: number | null;
  episodeCount?: number | null;
  episodeTitle?: string | null;
  episodeDescription?: string | null;
  episodeRuntimeMinutes?: number | null;
  episodeYear?: string | null;
};

export function getShowArtwork(show: ImportedShow | null | undefined): LibraryArtworkSet {
  // Prefer the legacy backdrop slot when present: older libraries stored provider
  // WLogo strips in `bannerUrl`, while `backdropUrl` held the clean background.
  const cleanBannerUrl = show?.artwork?.backdropUrl ?? show?.backdropUrl ?? show?.artwork?.bannerUrl ?? show?.bannerUrl ?? null;
  return {
    posterUrl: show?.artwork?.posterUrl ?? show?.posterUrl ?? null,
    bannerUrl: cleanBannerUrl,
    backdropUrl: cleanBannerUrl,
    clearLogoUrl: show?.artwork?.clearLogoUrl ?? show?.clearLogoUrl ?? null,
    bannerWithLogoUrl: show?.artwork?.bannerWithLogoUrl ?? show?.homepageBannerUrl ?? null,
  };
}

/** Clean background + separate HD logo: heroes and the library parallax carousel only. */
export function getOverlayBannerArtwork(show: ImportedShow | null | undefined) {
  const artwork = getShowArtwork(show);
  return { bannerUrl: artwork.bannerUrl ?? artwork.posterUrl ?? null, logoUrl: artwork.clearLogoUrl ?? null };
}

/** Self-contained card artwork. Prefer a baked-logo banner wherever no logo layer is rendered. */
export function getStandaloneBannerArtwork(show: ImportedShow | null | undefined) {
  const artwork = getShowArtwork(show);
  return artwork.bannerWithLogoUrl ?? artwork.bannerUrl ?? artwork.posterUrl ?? null;
}

function parseYear(value: string | number | null | undefined) {
  const match = String(value ?? "").match(/\b(19|20)\d{2}\b/);
  return match ? Number.parseInt(match[0], 10) : null;
}

function parseCsfdRating(value: string | number | null | undefined) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.max(0, Math.min(100, value));
  }
  const match = String(value ?? "").match(/(?:CSFD\s*)?(\d{1,3})\s*%/i);
  if (!match) return null;
  const rating = Number.parseInt(match[1], 10);
  return Number.isFinite(rating) ? Math.max(0, Math.min(100, rating)) : null;
}

export function getShowMetadata(show: ImportedShow | null | undefined): LibraryTitleMetadata | null {
  if (!show) return null;
  const extendedShow = show as ImportedShow & {
    genres?: string[] | null;
    rating?: string | number | null;
    csfdRating?: string | number | null;
    runtimeMinutes?: number | null;
  };
  const metadata = show.metadata;
  const year = metadata?.year ?? parseYear(show.years);
  const runtimeMinutes =
    metadata?.runtimeMinutes ??
    (typeof extendedShow.runtimeMinutes === "number" && Number.isFinite(extendedShow.runtimeMinutes) ? extendedShow.runtimeMinutes : null);
  const genres = metadata?.genres?.length ? metadata.genres : Array.isArray(extendedShow.genres) ? extendedShow.genres : [];
  const ratings = metadata?.ratings?.length
    ? metadata.ratings
    : [parseCsfdRating(extendedShow.csfdRating ?? extendedShow.rating ?? show.years ?? show.description)]
      .filter((value): value is number => value !== null)
      .map((value) => ({ source: "csfd" as const, value, scale: 100 as const, label: `${value}%` }));

  return {
    title: metadata?.title ?? show.title,
    originalTitle: metadata?.originalTitle ?? show.altTitle ?? null,
    description: metadata?.description ?? show.description ?? null,
    year,
    years: metadata?.years ?? show.years ?? (year ? String(year) : null),
    mediaType: metadata?.mediaType ?? show.mediaType,
    runtimeMinutes,
    seasonCount: metadata?.seasonCount ?? show.availableSeasons.length,
    episodeCount: metadata?.episodeCount ?? show.episodes.length,
    genres,
    ratings,
    actors: metadata?.actors?.length ? metadata.actors : show.actors ?? [],
    directors: metadata?.directors?.length ? metadata.directors : show.directors ?? [],
    updatedAt: metadata?.updatedAt ?? 0,
  };
}

export function getPrimaryRatingLabel(show: ImportedShow | null | undefined) {
  const rating = getShowMetadata(show)?.ratings[0];
  if (!rating) return null;
  if (rating.label?.trim()) return rating.label.trim();
  return `${rating.value}${rating.scale === 100 ? "%" : `/${rating.scale}`}`;
}

export function getTitleDescription(show: ImportedShow | null | undefined, fallback?: TitleMetadataFallback | null) {
  const raw = getShowMetadata(show)?.description?.trim() || fallback?.description?.trim() || "";
  return raw
    .replace(/^csfd\s*rating:[^\n]*\n?/i, "")
    .replace(/^csfd\s*rating:[^)]*\)\s*/i, "")
    .trim() || null;
}

export function hasCompleteTitleMetadata(show: ImportedShow | null | undefined) {
  if (!show) return false;
  const metadata = getShowMetadata(show);
  const isMovie = show.mediaType === "movie" || show.episodes.some((episode) => episode.episodeCode === "movie");
  return Boolean(
    metadata?.description?.trim()
    && metadata.year
    && metadata.genres.length
    && metadata.ratings.length
    && (!isMovie || metadata.runtimeMinutes),
  );
}

export function needsTitleMetadataEnrichment(show: ImportedShow | null | undefined) {
  return Boolean(show && show.metadata?.enrichmentVersion !== TITLE_METADATA_ENRICHMENT_VERSION);
}

export function mergeTitleMetadata(
  show: ImportedShow,
  fallback: TitleMetadataFallback,
): ImportedShow {
  const current = getShowMetadata(show);
  if (!current) return show;
  const parsedFallbackRating = parseCsfdRating(
    typeof fallback.csfdRating === "number" ? `${fallback.csfdRating}%` : fallback.csfdRating,
  );
  const ratings = current.ratings.length
    ? current.ratings
    : parsedFallbackRating !== null
      ? [{ source: "tmdb" as const, value: parsedFallbackRating, scale: 100 as const, label: `${parsedFallbackRating}%` }]
      : [];
  const year = current.year ?? parseYear(fallback.year);
  const metadata: LibraryTitleMetadata = {
    ...current,
    description: current.description?.trim() || fallback.description?.trim() || null,
    year,
    years: current.years?.trim() || fallback.year?.trim() || (year ? String(year) : null),
    runtimeMinutes: current.runtimeMinutes ?? fallback.runtimeMinutes ?? null,
    seasonCount: current.seasonCount || fallback.seasonCount || 0,
    episodeCount: current.episodeCount || fallback.episodeCount || 0,
    genres: current.genres.length ? current.genres : fallback.genres?.filter(Boolean) ?? [],
    ratings,
    updatedAt: Date.now(),
    enrichmentVersion: TITLE_METADATA_ENRICHMENT_VERSION,
  };
  return { ...show, metadata };
}

export function formatRuntimeMinutes(minutes: number | null | undefined) {
  if (typeof minutes !== "number" || !Number.isFinite(minutes) || minutes <= 0) return null;
  const rounded = Math.round(minutes);
  const hours = Math.floor(rounded / 60);
  const rest = rounded % 60;
  if (hours <= 0) return `${rounded}min`;
  return `${hours}h${rest > 0 ? ` ${rest}min` : ""}`;
}

function cleanYearLabel(value: string | number | null | undefined) {
  const raw = String(value ?? "")
    .replace(/\s*(?:\u2022|-|[|])?\s*CSFD\s*\d{1,3}%/i, "")
    .replace(/\s{2,}/g, " ")
    .trim();
  if (!raw) return null;
  const ongoing = raw.match(/\b((?:19|20)\d{2})\s*[-–—]\s*$/);
  if (ongoing?.[1]) return `${ongoing[1]}*`;
  const year = raw.match(/\b(19|20)\d{2}\b/)?.[0];
  return year ?? raw;
}

function episodeRuntimeMinutes(episode: LibraryEpisode | null | undefined) {
  const seconds = episode?.durationSeconds ?? episode?.playbackDurationSeconds ?? null;
  if (typeof seconds !== "number" || !Number.isFinite(seconds) || seconds <= 0) return null;
  return Math.round(seconds / 60);
}

export function getTitleMetadataParts(
  show: ImportedShow | null | undefined,
  options: {
    episode?: LibraryEpisode | null;
    fallback?: TitleMetadataFallback | null;
  } = {},
) {
  if (!show) return [];
  const metadata = getShowMetadata(show);
  const isMovie = show.mediaType === "movie"
    || options.episode?.episodeCode === "movie"
    || (show.mediaType !== "serial" && show.episodes.length <= 1);
  const fallback = options.fallback ?? null;
  const fallbackRating = typeof fallback?.csfdRating === "number"
    ? `${fallback.csfdRating}%`
    : typeof fallback?.csfdRating === "string" && fallback.csfdRating.trim()
      ? `${fallback.csfdRating.replace(/%$/, "")}%`
      : null;
  const rating = getPrimaryRatingLabel(show) ?? fallbackRating;
  const year = (options.episode && options.episode.episodeCode !== "movie" ? cleanYearLabel(fallback?.episodeYear) : null)
    ?? cleanYearLabel(metadata?.years)
    ?? cleanYearLabel(show.years)
    ?? cleanYearLabel(fallback?.year)
    ?? cleanYearLabel(metadata?.year);
  const episodeRuntime = formatRuntimeMinutes(episodeRuntimeMinutes(options.episode) ?? fallback?.episodeRuntimeMinutes);
  const runtime = isMovie
    ? formatRuntimeMinutes(metadata?.runtimeMinutes ?? fallback?.runtimeMinutes ?? episodeRuntimeMinutes(options.episode))
    : options.episode
      ? episodeRuntime
      : (metadata?.seasonCount || fallback?.seasonCount)
        ? `${metadata?.seasonCount || fallback?.seasonCount} ${(metadata?.seasonCount || fallback?.seasonCount) === 1 ? "Season" : "Seasons"}`
        : null;
  const genres = (metadata?.genres?.length ? metadata.genres : fallback?.genres ?? [])
    .filter((genre): genre is string => typeof genre === "string" && genre.trim().length > 0)
    .slice(0, 2)
    .join(", ");

  return [
    rating ? { label: rating, kind: "rating" as const } : null,
    year ? { label: year, kind: "year" as const } : null,
    runtime ? { label: runtime, kind: isMovie ? "runtime" as const : "scope" as const } : null,
    genres ? { label: genres, kind: "genre" as const } : null,
  ].filter((entry): entry is { label: string; kind: "rating" | "year" | "runtime" | "scope" | "genre" } => Boolean(entry));
}
