import { scoreSearchCandidate } from "../lib/search-ranking";
import type { ExploreFilters, ExploreItem, LibraryState, RecommendationReason, UserTasteProfile } from "../lib/types";

export function normalizeDiscoveryText(value: string | null | undefined) {
  return String(value || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function uniqueReasons(reasons: RecommendationReason[]) {
  return Array.from(new Map(reasons.map((reason) => [`${reason.kind}:${reason.label}`, reason])).values());
}

function scoreTitleAffinity(candidate: ExploreItem, values: string[], kind: RecommendationReason["kind"], label: string) {
  if (values.length === 0) {
    return null;
  }

  const score = scoreSearchCandidate(candidate.title, values);
  if (score <= 0) {
    return null;
  }

  return {
    score,
    reason: {
      kind,
      label,
      detail: values[0],
    } satisfies RecommendationReason,
  };
}

function lookupRecentTitles(librarySnapshot: LibraryState, tasteProfile: UserTasteProfile) {
  const recentShowTitles = tasteProfile.recentShowSlugs
    .map((slug) => librarySnapshot.shows.find((show) => show.slug === slug)?.title ?? "")
    .filter(Boolean);

  const recentEpisodeTitles = tasteProfile.recentEpisodeIds
    .map((episodeId) => {
      for (const show of librarySnapshot.shows) {
        const episode = show.episodes.find((entry) => entry.id === episodeId);
        if (episode) {
          return episode.showTitle || show.title;
        }
      }
      return "";
    })
    .filter(Boolean);

  return Array.from(new Set([...recentShowTitles, ...recentEpisodeTitles]));
}

function collectSearchFields(candidate: ExploreItem) {
  return [candidate.title, candidate.description, candidate.year, candidate.network, ...candidate.genres, ...candidate.directors, ...candidate.actors];
}

export function buildDiscoveryScore(input: {
  candidate: ExploreItem;
  query: string;
  filters: ExploreFilters;
  librarySnapshot: LibraryState;
  tasteProfile?: UserTasteProfile;
}) {
  const { candidate, query, filters, librarySnapshot } = input;
  const tasteProfile = input.tasteProfile;
  const trimmedQuery = query.trim();
  const queryScore = trimmedQuery ? scoreSearchCandidate(trimmedQuery, collectSearchFields(candidate)) : 0;

  if (trimmedQuery && queryScore <= 0) {
    return {
      queryScore: 0,
      personalizationScore: 0,
      totalScore: 0,
      reasons: [] as RecommendationReason[],
    };
  }

  let personalizationScore = 0;
  const reasons: RecommendationReason[] = [];

  if (tasteProfile) {
    const favoriteTitles = librarySnapshot.shows.filter((show) => show.isFavorite).map((show) => show.title);
    const importedTitles = librarySnapshot.shows.slice(0, 36).map((show) => show.title);
    const recentTitles = lookupRecentTitles(librarySnapshot, tasteProfile);

    const favoriteMatch = scoreTitleAffinity(candidate, favoriteTitles, "favorite-match", "Matches titles you favorited");
    if (favoriteMatch) {
      personalizationScore += 180 + favoriteMatch.score;
      reasons.push(favoriteMatch.reason);
    }

    const recentMatch = scoreTitleAffinity(candidate, recentTitles, "recent-open", "Close to what you opened recently");
    if (recentMatch) {
      personalizationScore += 150 + recentMatch.score;
      reasons.push(recentMatch.reason);
    }

    const importMatch = scoreTitleAffinity(candidate, importedTitles, "import-match", "Fits what already lands in your vault");
    if (importMatch) {
      personalizationScore += 125 + importMatch.score;
      reasons.push(importMatch.reason);
    }

    const providerWeight = tasteProfile.providerAffinity[candidate.provider] ?? 0;
    if (providerWeight > 0) {
      personalizationScore += providerWeight * 12;
      reasons.push({
        kind: "preferred-source",
        label: candidate.provider === "svetserialu" ? "From a source you use often" : "From a source you use often",
      });
    }

    const normalizedGenres = candidate.genres.map((genre) => normalizeDiscoveryText(genre)).filter(Boolean);
    const bestGenre = normalizedGenres
      .map((genre) => ({ genre, weight: tasteProfile.genreAffinity[genre] ?? 0 }))
      .sort((left, right) => right.weight - left.weight)[0];
    if (bestGenre && bestGenre.weight > 0) {
      personalizationScore += bestGenre.weight * 18;
      reasons.push({
        kind: "genre-affinity",
        label: "Hits genres you keep circling back to",
        detail: candidate.genres.find((genre) => normalizeDiscoveryText(genre) === bestGenre.genre) ?? bestGenre.genre,
      });
    }

    const normalizedNetwork = normalizeDiscoveryText(candidate.network);
    const networkWeight = normalizedNetwork ? (tasteProfile.networkAffinity[normalizedNetwork] ?? 0) : 0;
    if (networkWeight > 0) {
      personalizationScore += networkWeight * 16;
      reasons.push({
        kind: "network-affinity",
        label: "From a network that already performs for you",
        detail: candidate.network ?? undefined,
      });
    }
  }

  if (candidate.mediaType === "movie" && librarySnapshot.settings.preferredMovieSource === candidate.provider) {
    personalizationScore += 36;
    reasons.push({
      kind: "preferred-source",
      label: "Aligned with your preferred movie source",
    });
  }

  if (candidate.mediaType === "serial" && librarySnapshot.settings.preferredSeriesSource === candidate.provider) {
    personalizationScore += 36;
    reasons.push({
      kind: "preferred-source",
      label: "Aligned with your preferred series source",
    });
  }

  if (candidate.sectionKeys.includes("newest") || candidate.sectionKeys.includes("novinky") || candidate.sectionKeys.includes("latestEpisodes")) {
    personalizationScore += 28;
    reasons.push({
      kind: "fresh-source",
      label: "Fresh on your active sources",
    });
  }

  if (candidate.inVault && filters.inVault !== "yes") {
    personalizationScore -= 18;
  }

  const totalScore = trimmedQuery ? queryScore * 24 + personalizationScore : personalizationScore;

  return {
    queryScore,
    personalizationScore,
    totalScore,
    reasons: uniqueReasons(reasons).slice(0, 4),
  };
}
