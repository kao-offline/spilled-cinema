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
  streamUrl?: string;
  streamType?: "hls" | "mp4" | "dash" | "embed" | "unknown";
  streamRefererUrl?: string;
  resolvedAt?: number;
  resolutionHash?: string;
  resolutionStatus?: "unresolved" | "resolving" | "resolved" | "failed";
  resolutionError?: string;
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
  durationSeconds?: number;
  playbackPositionSeconds?: number;
  playbackDurationSeconds?: number;
  playbackUpdatedAt?: number;
  importedAt: number;
};

export type CastMember = {
  name: string;
  role?: string | null;
  profileUrl?: string | null;
};

export type PersonCredit = {
  id: string;
  tmdbId: number;
  title: string;
  mediaType: ExploreMediaType;
  role?: string | null;
  year?: string | null;
  posterUrl?: string | null;
  backdropUrl?: string | null;
  description?: string | null;
};

export type ImportedShow = {
  slug: string;
  title: string;
  altTitle?: string | null;
  description?: string | null;
  years?: string | null;
  mediaType?: ExploreMediaType;
  externalIds?: {
    imdb?: string;
    tmdb?: string;
    tvdb?: string;
  };
  posterUrl?: string | null;
  backdropUrl?: string | null;
  bannerUrl?: string | null;
  homepagePosterUrl?: string | null;
  homepageBannerUrl?: string | null;
  homepageArtworkVersion?: number | null;
  clearLogoUrl?: string | null;
  artwork?: LibraryArtworkSet;
  metadata?: LibraryTitleMetadata;
  canonicalIdentity?: TitleIdentity;
  providerMatches?: ProviderMatch[];
  actors?: CastMember[];
  directors?: CastMember[];
  availableSeasons: number[];
  importedAt: number;
  episodes: LibraryEpisode[];
  isFavorite?: boolean;
};

export type LibraryRating = {
  source: "csfd" | "tmdb" | "imdb" | "user" | "provider";
  value: number;
  scale: 5 | 10 | 100;
  label?: string | null;
};

export type LibraryArtworkSet = {
  posterUrl?: string | null;
  /** Clean, wide artwork used behind a separate HD logo. */
  bannerUrl?: string | null;
  /** Transparent title treatment layered over a clean banner. */
  clearLogoUrl?: string | null;
  /** Self-contained wide artwork with the title/logo baked in. */
  bannerWithLogoUrl?: string | null;
  /** @deprecated Legacy alias for a clean banner. */
  backdropUrl?: string | null;
};

export type LibraryTitleMetadata = {
  title: string;
  originalTitle?: string | null;
  description?: string | null;
  year?: number | null;
  years?: string | null;
  mediaType?: ExploreMediaType;
  runtimeMinutes?: number | null;
  seasonCount: number;
  episodeCount: number;
  genres: string[];
  ratings: LibraryRating[];
  actors: CastMember[];
  directors: CastMember[];
  updatedAt: number;
  enrichmentVersion?: number;
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
  bannerUrl?: string | null;
  year?: string | null;
  yearLabel?: string | null;
  alternateTitles?: string[];
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
  availability?: "available" | "checking" | "unavailable" | "unknown";
  availabilityReason?: string | null;
  matchScore?: number;
  searchSignals?: {
    source?: "tmdb" | "imdb" | "tvmaze" | "wikidata" | "provider";
    popularity?: number | null;
    voteCount?: number | null;
    voteAverage?: number | null;
    releaseDate?: string | null;
    originalLanguage?: string | null;
  };
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

export type ProviderFeedKind =
  | "new-episodes"
  | "new-additions"
  | "popular"
  | "latest-episodes"
  | "custom";

export type ProviderFeedItemGranularity = "episode" | "show" | "movie";

export type ProviderFeedManifest = {
  moduleId: string;
  providerId: IntegrationId;
  feedId: string;
  title: string;
  description: string;
  kind: ProviderFeedKind;
  defaultEnabled: boolean;
  pageTitle: string;
  supportsSearch: boolean;
  supportsOpenSource: boolean;
  supportsImport: boolean;
  sortMode: "newest";
  itemGranularity: ProviderFeedItemGranularity;
};

export type ProviderModuleManifest = {
  moduleId: string;
  providerId: IntegrationId;
  displayName: string;
  version: number;
  status: "active" | "disabled";
  runtime?: {
    entry: string;
  };
  capabilities: {
    import: boolean;
    player: boolean;
    search: boolean;
    download: boolean;
    feeds: ProviderFeedManifest[];
  };
  publishedAt: number;
  updatedAt: number;
};

export type IntegrationCapability =
  | "search"
  | "discovery"
  | "metadata"
  | "artwork"
  | "import"
  | "players"
  | "subtitles"
  | "downloads"
  | "sharedAppKey"
  | "userApiKey"
  | "siteLogin"
  | "noCredentials";

export type IntegrationRuntimeManifest = {
  apiVersion: 2;
  entry: string;
  integrity?: string;
  format?: "builtin" | "wasm" | "javascript";
  publisherKeyId?: string;
  signature?: string;
  allowedMethods?: Array<"GET" | "POST">;
  maxResponseBytes?: number;
  timeoutMs?: number;
};

export type IntegrationConfigSchemaField = {
  key: string;
  label: string;
  type: "string" | "password" | "boolean" | "number" | "select";
  required?: boolean;
  description?: string;
  options?: Array<{ label: string; value: string }>;
};

export type IntegrationConfigSchema = {
  fields: IntegrationConfigSchemaField[];
};

export type CredentialRequirement = {
  kind: "none" | "sharedAppKey" | "userApiKey" | "siteLogin";
  label?: string;
  secretName?: string;
  optional?: boolean;
};

export type IntegrationManifestV2 = {
  id: string;
  displayName: string;
  version: string;
  homepage?: string;
  status: "stable" | "experimental" | "disabled";
  runtime?: IntegrationRuntimeManifest;
  capabilities: IntegrationCapability[];
  configSchema?: IntegrationConfigSchema;
  credentialRequirements?: CredentialRequirement[];
  networkPermissions?: string[];
  repositoryUrl?: string;
  manifestUrl?: string;
};

export type IntegrationRepositoryManifestV2 = {
  schemaVersion: 2;
  repositoryId: string;
  repositoryName: string;
  updatedAt: string;
  integrations: IntegrationManifestV2[];
};

export type TitleIdentity = {
  identityId: string;
  mediaType: "movie" | "series";
  canonicalTitle: string;
  originalTitle?: string;
  year?: number;
  externalIds: {
    imdb?: string;
    tmdb?: string;
    tvdb?: string;
  };
  normalizedKey: string;
};

export type ProviderCandidate = {
  integrationId: string;
  providerItemId: string;
  mediaType: "movie" | "series";
  title: string;
  originalTitle?: string;
  year?: number;
  sourceUrl?: string;
  posterUrl?: string | null;
  externalIds?: {
    imdb?: string;
    tmdb?: string;
    tvdb?: string;
  };
  confidenceHints?: {
    normalizedTitle?: string;
    durationMinutes?: number;
    releaseDate?: string;
  };
};

export type ProviderMatch = {
  identityId: string;
  integrationId: string;
  providerItemId: string;
  sourceUrl?: string;
  confidenceScore: number;
  resolvedCapabilities: IntegrationCapability[];
};

export type PlayerSource = {
  integrationId: string;
  label: string;
  quality?: string;
  language?: string;
  url: string;
  type: "embed" | "direct" | "hls" | "dash";
};

export type SubtitleSource = {
  integrationId: string;
  label: string;
  language?: string;
  url: string;
};

export type DownloadSource = {
  integrationId: string;
  label: string;
  quality?: string;
  url: string;
};

export type CanonicalMetadata = {
  title: string;
  originalTitle?: string;
  description?: string | null;
  year?: number;
  years?: string | null;
  genres?: string[];
};

export type ArtworkSet = {
  posterUrl?: string | null;
  backdropUrl?: string | null;
  bannerUrl?: string | null;
  clearLogoUrl?: string | null;
};

export type ResolvedTitleStatus = "pending" | "partial" | "complete" | "failed";

export type ResolvedTitle = {
  identity: TitleIdentity;
  metadata: CanonicalMetadata;
  artwork: ArtworkSet;
  providerMatches: ProviderMatch[];
  players: PlayerSource[];
  subtitles: SubtitleSource[];
  downloads: DownloadSource[];
  resolutionStatus: {
    metadata: ResolvedTitleStatus;
    players: ResolvedTitleStatus;
  };
};

export type TitleSearchResult = ResolvedTitle & {
  candidates: ProviderCandidate[];
  importedShow?: ImportedShow;
};

export type TitleSearchResponse = {
  generatedAt: number;
  query: string;
  results: TitleSearchResult[];
};

export type EnabledProviderFeed = {
  moduleId: string;
  feedId: string;
};

export type ProviderFeedResponse = {
  generatedAt: number;
  stale: boolean;
  moduleId: string;
  feedId: string;
  items: ExploreItem[];
  continueCursor: string | null;
};

export type ProviderFeedCatalogEntry = {
  moduleId: string;
  feedId: string;
  providerId: IntegrationId;
  providerName: string;
  title: string;
  description: string;
  pageTitle: string;
  enabled: boolean;
};
