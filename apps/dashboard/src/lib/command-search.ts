import type { ExploreItem, ImportedShow } from "./types";
import type { IntegrationId } from "./integrations";
import type { ExplorePersonSuggestion } from "./discovery-client";
import { hasRequiredSearchTokenCoverage, scoreSearchCandidate, sortUnifiedSearchResults } from "./search-ranking";
import { getShowArtwork, getShowMetadata } from "./media-library";

export type RemoteAvailability = "available" | "checking" | "unavailable" | "unknown" | "verifying";

export type RemoteCommandResult = {
  title: string;
  slug: string;
  platform: IntegrationId;
  posterUrl?: string | null;
  mediaType?: "movie" | "serial";
  year?: string | null;
  alternateTitles?: string[];
  description?: string | null;
  genres?: string[];
  actors?: string[];
  directors?: string[];
  detailUrl?: string | null;
  availability?: RemoteAvailability;
  availabilityReason?: string | null;
  matchScore?: number;
  searchSignals?: ExploreItem["searchSignals"];
};

export type RemoteSourceMatch = {
  provider: IntegrationId;
  importSlug: string;
  detailUrl?: string | null;
  mediaType: "movie" | "serial";
  availability?: RemoteAvailability;
  availabilityReason?: string | null;
};

export type CommandSearchResult =
  | {
      kind: "local-title";
      id: string;
      title: string;
      subtitle: string;
      posterUrl?: string | null;
      backdropUrl?: string | null;
      showSlug: string;
      mediaType: "movie" | "serial";
      year?: string | null;
      description?: string | null;
      saved: true;
      downloadedCount: number;
      sourceLabels: string[];
    }
  | {
      kind: "remote-title";
      id: string;
      title: string;
      subtitle: string;
      provider: IntegrationId;
      importSlug: string;
      sourceMatches: RemoteSourceMatch[];
      posterUrl?: string | null;
      mediaType: "movie" | "serial";
      year?: string | null;
      alternateTitles: string[];
      description?: string | null;
      genres: string[];
      actors: string[];
      directors: string[];
      detailUrl?: string | null;
      availability?: RemoteAvailability;
      availabilityReason?: string | null;
      saved: boolean;
      savedShowSlug?: string;
      downloadedCount: number;
    }
  | {
      kind: "person";
      id: string;
      name: string;
      subtitle: string;
      role: "actor" | "director" | "any";
      knownFor: string[];
    };

function normalizeText(value: string | null | undefined) {
  return String(value ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function inferMediaType(show: ImportedShow): "movie" | "serial" {
  return show.mediaType === "movie" || show.episodes.length <= 1 ? "movie" : "serial";
}

function formatLocalSubtitle(show: ImportedShow) {
  const metadata = getShowMetadata(show);
  const mediaType = (metadata?.mediaType ?? inferMediaType(show)) === "movie" ? "Movie" : "TV Show";
  const year = metadata?.years?.trim() ?? show.years?.trim();
  const episodeCount = metadata?.episodeCount ?? show.episodes.length;
  const episodeLabel = episodeCount > 1 ? `${episodeCount} episodes` : "1 entry";
  return [mediaType, year, episodeLabel].filter(Boolean).join("  |  ");
}

function formatMergedRemoteSubtitle(result: RemoteCommandResult, sourceMatches: RemoteSourceMatch[]) {
  const mediaType = result.mediaType === "serial" ? "TV Show" : "Movie";
  const sources = sourceMatches.map((source) => getProviderLabel(source.provider)).join(", ");
  return [mediaType, result.year, sources, ...(result.genres ?? []).slice(0, 2)].filter(Boolean).join("  |  ");
}

export function getProviderLabel(provider: IntegrationId) {
  if (provider === "vidking") return "VidKing";
  if (provider === "svetserialu") return "SvetSerialu";
  if (provider === "bombuj") return "Bombuj";
  return "Unknown";
}

export function buildProviderDetailUrl(provider: IntegrationId, slug: string, mediaType?: "movie" | "serial") {
  if (provider === "vidking") {
    const normalizedSlug = slug.replace(/^\/+|\/+$/g, "");
    if (mediaType === "serial" && /^tv\/\d+$/i.test(normalizedSlug)) {
      return `https://www.vidking.net/embed/${normalizedSlug}/1/1`;
    }
    return `https://www.vidking.net/embed/${normalizedSlug}`;
  }
  if (provider === "svetserialu") {
    return `https://svetserialu.to/serial/${slug}`;
  }
  if (provider === "bombuj") {
    return mediaType === "serial"
      ? `https://serialy.bombuj.si/serial-${slug}#serial`
      : `https://www.bombuj.si/online-film-${slug}`;
  }
  return null;
}

export function findSavedShowForRemote(shows: ImportedShow[], result: RemoteCommandResult) {
  const titleKeys = new Set([result.title, ...(result.alternateTitles ?? [])].map(normalizeText).filter(Boolean));
  const slugKey = normalizeText(result.slug);
  return shows.find((show) => {
    const externalProviderId = result.platform === "vidking" ? show.externalIds?.tmdb : undefined;
    return (
      normalizeText(show.slug) === slugKey ||
      titleKeys.has(normalizeText(show.title)) ||
      titleKeys.has(normalizeText(show.altTitle)) ||
      Boolean(externalProviderId && result.slug.includes(externalProviderId))
    );
  });
}

function resultTitleKeys(result: RemoteCommandResult) {
  return [result.title, ...(result.alternateTitles ?? [])]
    .map(normalizeText)
    .filter(Boolean);
}

function parseYearNumber(value: string | null | undefined) {
  const match = value?.match(/\b(19|20)\d{2}\b/);
  return match ? Number.parseInt(match[0], 10) : null;
}

function sameRemoteIdentity(left: RemoteCommandResult, right: RemoteCommandResult) {
  const leftMedia = left.mediaType ?? "movie";
  const rightMedia = right.mediaType ?? "movie";
  if (leftMedia !== rightMedia) {
    return false;
  }

  const leftYear = parseYearNumber(left.year);
  const rightYear = parseYearNumber(right.year);
  if (leftYear !== null && rightYear !== null && Math.abs(leftYear - rightYear) > 1) {
    return false;
  }

  const rightKeys = new Set(resultTitleKeys(right));
  return resultTitleKeys(left).some((key) => rightKeys.has(key));
}

function mergeSourceMatches(matches: RemoteSourceMatch[]) {
  const seen = new Set<string>();
  return matches.filter((match) => {
    const key = `${match.provider}:${match.importSlug}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function buildLocalCommandResults(input: {
  query: string;
  shows: ImportedShow[];
  downloadedCountByShow: Record<string, number>;
}) {
  const query = input.query.trim();
  const source = query
    ? input.shows
        .map((show, index) => {
          const metadata = getShowMetadata(show);
          const fields = [
            show.title,
            show.altTitle,
            show.slug,
            metadata?.description ?? show.description,
            metadata?.years ?? show.years,
            ...(metadata?.genres ?? []),
            ...(metadata?.actors.map((actor) => actor.name) ?? []),
            ...(metadata?.directors.map((director) => director.name) ?? []),
            ...show.episodes.map((episode) => episode.episodeTitle ?? ""),
            ...show.episodes.flatMap((episode) => episode.players.map((player) => player.provider)),
          ];
          return {
            show,
            fields,
            score: scoreSearchCandidate(query, fields, index),
          };
        })
        .filter((entry) => entry.score > 0 && hasRequiredSearchTokenCoverage(query, entry.fields))
        .sort((left, right) => right.score - left.score)
        .map((entry) => entry.show)
    : input.shows.slice(0, 8);

  return source.slice(0, 8).map((show): CommandSearchResult => {
    const artwork = getShowArtwork(show);
    const metadata = getShowMetadata(show);
    return {
      kind: "local-title",
      id: `local:${show.slug}`,
      title: metadata?.title ?? show.title,
      subtitle: formatLocalSubtitle(show),
      posterUrl: artwork.posterUrl ?? null,
      backdropUrl: artwork.backdropUrl ?? artwork.bannerUrl ?? null,
      showSlug: show.slug,
      mediaType: metadata?.mediaType ?? inferMediaType(show),
      year: metadata?.years ?? show.years ?? null,
      description: metadata?.description ?? show.description ?? null,
      saved: true,
      downloadedCount: input.downloadedCountByShow[show.slug] ?? 0,
      sourceLabels: Array.from(new Set(show.episodes.flatMap((episode) => episode.players.map((player) => player.provider)).filter(Boolean))).slice(0, 3),
    };
  });
}

export function buildRemoteCommandResults(input: {
  query: string;
  results: RemoteCommandResult[];
  shows: ImportedShow[];
  downloadedCountByShow: Record<string, number>;
}) {
  const groups: Array<{ primary: RemoteCommandResult; items: RemoteCommandResult[] }> = [];
  const seen = new Set<string>();

  for (const result of sortUnifiedSearchResults(input.query, input.results)) {
    const key = `${result.platform}:${result.slug}`;
    if (seen.has(key)) continue;
    seen.add(key);

    const group = groups.find((entry) => entry.items.some((item) => sameRemoteIdentity(item, result)));
    if (group) {
      group.items.push(result);
    } else {
      groups.push({ primary: result, items: [result] });
    }
  }

  return groups.flatMap(({ primary, items }): CommandSearchResult[] => {
    const savedShow = items.map((item) => findSavedShowForRemote(input.shows, item)).find(Boolean);
    const sourceMatches = mergeSourceMatches(items.map((item) => ({
      provider: item.platform,
      importSlug: item.slug,
      mediaType: item.mediaType ?? "movie",
      detailUrl: item.detailUrl ?? buildProviderDetailUrl(item.platform, item.slug, item.mediaType),
      availability: item.availability,
      availabilityReason: item.availabilityReason,
    })));
    const aliases = Array.from(new Set(items.flatMap((item) => [item.title, ...(item.alternateTitles ?? [])]))).filter((title) => title !== primary.title);
    return [{
      kind: "remote-title",
      id: `remote:${sourceMatches.map((source) => `${source.provider}:${source.importSlug}`).join("+")}`,
      title: primary.title,
      subtitle: formatMergedRemoteSubtitle(primary, sourceMatches),
      provider: primary.platform,
      importSlug: primary.slug,
      sourceMatches,
      posterUrl: primary.posterUrl ?? items.find((item) => item.posterUrl)?.posterUrl ?? null,
      mediaType: primary.mediaType ?? "movie",
      year: primary.year ?? null,
      alternateTitles: aliases,
      description: primary.description ?? items.find((item) => item.description)?.description ?? null,
      genres: primary.genres ?? items.find((item) => item.genres?.length)?.genres ?? [],
      actors: primary.actors ?? items.find((item) => item.actors?.length)?.actors ?? [],
      directors: primary.directors ?? items.find((item) => item.directors?.length)?.directors ?? [],
      detailUrl: primary.detailUrl ?? buildProviderDetailUrl(primary.platform, primary.slug, primary.mediaType),
      availability: sourceMatches.some((source) => source.availability === "available")
        ? "available"
        : sourceMatches.some((source) => source.availability === "checking")
          ? "checking"
          : sourceMatches.some((source) => source.availability === "verifying")
            ? "verifying"
            : sourceMatches.every((source) => source.availability === "unavailable")
              ? "unavailable"
              : sourceMatches.some((source) => source.availability === "unknown")
                ? "unknown"
                : primary.availability,
      availabilityReason: primary.availabilityReason ?? sourceMatches.find((source) => source.availabilityReason)?.availabilityReason ?? null,
      saved: Boolean(savedShow),
      savedShowSlug: savedShow?.slug,
      downloadedCount: savedShow ? input.downloadedCountByShow[savedShow.slug] ?? 0 : 0,
    }];
  }).slice(0, 12);
}

export function buildPersonCommandResults(people: ExplorePersonSuggestion[]) {
  return people.map((person): CommandSearchResult => ({
    kind: "person",
    id: `person:${person.role}:${person.id}`,
    name: person.name,
    subtitle: [person.role === "director" ? "Director" : person.role === "actor" ? "Actor" : "Person", person.department].filter(Boolean).join("  |  "),
    role: person.role,
    knownFor: person.knownFor,
  }));
}

export function exploreItemToRemoteCommandResult(item: ExploreItem): RemoteCommandResult {
  return {
    title: item.title,
    slug: item.importSlug || item.slug,
    platform: item.provider,
    posterUrl: item.posterUrl,
    mediaType: item.mediaType,
    year: item.yearLabel ?? item.year,
    alternateTitles: item.alternateTitles,
    description: item.description,
    genres: item.genres,
    actors: item.actors,
    directors: item.directors,
    detailUrl: item.detailUrl,
    availability: item.availability,
    availabilityReason: item.availabilityReason,
    matchScore: item.matchScore,
    searchSignals: item.searchSignals,
  };
}
