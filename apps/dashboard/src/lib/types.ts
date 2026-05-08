import type { IntegrationId } from "./integrations";

export type PlayerAlias = string;

export type EpisodePlayer = {
  alias: PlayerAlias;
  provider: string;
  label: string;
  language?: string;
  sourcePageUrl: string;
  embedUrl: string;
  subtitlesUrl?: string;
};

export type LibraryEpisode = {
  id: string;
  showSlug: string;
  showTitle: string;
  posterUrl?: string;
  seasonNumber: number;
  episodeNumber: number | null;
  episodeCode: string | null;
  episodeTitle: string | null;
  episodeUrl: string;
  players: EpisodePlayer[];
  selectedPlayerAlias: PlayerAlias;
  importedAt: number;
};

export type ImportedShow = {
  slug: string;
  title: string;
  altTitle?: string | null;
  description?: string | null;
  years?: string | null;
  posterUrl?: string | null;
  backdropUrl?: string | null;
  clearLogoUrl?: string | null;
  availableSeasons: number[];
  importedAt: number;
  episodes: LibraryEpisode[];
  isFavorite?: boolean;
};

export type ArtworkSourceSettings = {
  tmdb: boolean;
  fanart: boolean;
  tvdb: boolean;
};

export type DownloadEngine = "localffmpeg" | "wasm";

export type LibrarySettings = {
  autoplayNext: boolean;
  offlineSizeLimitMb: number;
  downloadEngine: DownloadEngine;
  connectedFolderName?: string;
  preferredSeriesSource: IntegrationId;
  preferredMovieSource: IntegrationId;
  artworkSources: ArtworkSourceSettings;
};

export type OfflineEpisodeDownload = {
  cachedAt: number;
  urls: string[];
  sizeBytes: number;
};

export type LibraryState = {
  shows: ImportedShow[];
  selectedEpisodeId?: string;
  query: string;
  settings: LibrarySettings;
  offlineDownloads: Record<string, OfflineEpisodeDownload>;
};

export type ExploreMediaType = "movie" | "serial";

export type ExploreAudioBucket = "all" | "subtitles" | "dubbing" | "no_subtitles";

export type ExploreSectionKey =
  | "newest"
  | "popular"
  | "latestEpisodes"
  | "topOverall"
  | "topToday"
  | "novinky"
  | "genreBrowse";

export type ExplorePersonRole = "any" | "actor" | "director";

export type RecommendationReason = {
  kind:
    | "favorite-match"
    | "recent-play"
    | "recent-open"
    | "import-match"
    | "preferred-source"
    | "genre-affinity"
    | "network-affinity"
    | "fresh-source";
  label: string;
  detail?: string;
};

export type ExploreItem = {
  id: string;
  title: string;
  slug: string;
  importSlug: string;
  provider: IntegrationId;
  mediaType: ExploreMediaType;
  detailUrl: string;
  posterUrl?: string | null;
  backdropUrl?: string | null;
  year?: string | null;
  yearLabel?: string | null;
  description?: string | null;
  genres: string[];
  audioBuckets: ExploreAudioBucket[];
  languages: string[];
  network?: string | null;
  directors: string[];
  actors: string[];
  sectionKeys: ExploreSectionKey[];
  inVault: boolean;
  availableNow: boolean;
  matchScore?: number;
  discoveryScore?: number;
  recommendationReasons?: RecommendationReason[];
  importedAt?: number;
  episode?: {
    seasonNumber?: number | null;
    episodeNumber?: number | null;
    episodeCode?: string | null;
    episodeTitle?: string | null;
  };
};

export type ExploreFilters = {
  mediaTypes: ExploreMediaType[];
  providers: IntegrationId[];
  genres: string[];
  audioBuckets: ExploreAudioBucket[];
  networks: string[];
  sections: ExploreSectionKey[];
  inVault: "all" | "yes" | "no";
  availability: "all" | "available";
  yearMin?: number;
  yearMax?: number;
  personQuery?: string;
  personRole?: ExplorePersonRole;
};

export type ExploreFacet = {
  key: string;
  label: string;
  count: number;
  provider?: IntegrationId;
};

export type ExploreFacetCounts = {
  mediaTypes: ExploreFacet[];
  providers: ExploreFacet[];
  genres: ExploreFacet[];
  audioBuckets: ExploreFacet[];
  networks: ExploreFacet[];
  sections: ExploreFacet[];
};

export type ExploreSection = {
  key: ExploreSectionKey;
  label: string;
  provider?: IntegrationId;
  itemIds: string[];
};

export type TrendingItem = ExploreItem & {
  score: number;
  recommendationReasons: RecommendationReason[];
};

export type ProviderCapabilities = {
  provider: IntegrationId;
  supportsGenres: boolean;
  supportsNetworks: boolean;
  supportsAudioBuckets: ExploreAudioBucket[];
  supportsPeopleSearch: boolean;
  supportsActorSearch: boolean;
  supportsDirectorSearch: boolean;
  supportsSections: ExploreSectionKey[];
};

export type UserTasteProfile = {
  updatedAt: number;
  importedSlugs: string[];
  favoriteSlugs: string[];
  recentShowSlugs: string[];
  recentEpisodeIds: string[];
  providerAffinity: Partial<Record<IntegrationId, number>>;
  genreAffinity: Record<string, number>;
  networkAffinity: Record<string, number>;
  audioAffinity: Record<string, number>;
};

export type ExploreFeedResponse = {
  generatedAt: number;
  items: ExploreItem[];
  facetCounts: ExploreFacetCounts;
  sections: ExploreSection[];
  providerCoverage: IntegrationId[];
  stale: boolean;
  continueCursor: string | null;
};

export type TrendingFeedResponse = {
  generatedAt: number;
  items: TrendingItem[];
  source: "local" | "hybrid";
  stale: boolean;
};
