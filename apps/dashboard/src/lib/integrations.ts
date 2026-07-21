export type IntegrationId = "vidking" | "cineby" | "svetserialu" | "bombuj";

export type IntegrationKind = "series" | "movies" | "mixed";

export type IntegrationStatus = "active" | "beta" | "planned" | "unstable";

export type IntegrationCapabilityKey =
  | "import"
  | "remoteSearch"
  | "streaming"
  | "downloads"
  | "subtitles";

export type DiscoverySectionCapability =
  | "newest"
  | "popular"
  | "latestEpisodes"
  | "topOverall"
  | "topToday"
  | "novinky"
  | "genreBrowse";

export type IntegrationDefinition = {
  id: IntegrationId;
  name: string;
  domain: string;
  status: IntegrationStatus;
  kind: IntegrationKind;
  description: string;
  capabilities: Record<IntegrationCapabilityKey, boolean>;
  copy: {
    shortLabel: string;
    supportBadge: string;
    notes?: string;
  };
};

export const INTEGRATIONS: IntegrationDefinition[] = [
  {
    id: "vidking",
    name: "VidKing",
    domain: "vidking.net",
    status: "active",
    kind: "mixed",
    description: "TMDB-backed VidKing iframe provider for movie and TV playback without legacy site scraping.",
    capabilities: {
      import: true,
      remoteSearch: true,
      streaming: true,
      downloads: false,
      subtitles: false,
    },
    copy: {
      shortLabel: "Movies + TV",
      supportBadge: "TMDB module",
      notes: "Uses VidKing embed routes from TMDB movie and episode IDs.",
    },
  },
  {
    id: "svetserialu",
    name: "SvetSerialu",
    domain: "svetserialu.to",
    status: "active",
    kind: "mixed",
    description: "Primary mixed-source extractor for episodic imports, playback parsing, subtitle pickup, and direct download resolution.",
    capabilities: {
      import: true,
      remoteSearch: true,
      streaming: true,
      downloads: true,
      subtitles: true,
    },
    copy: {
      shortLabel: "Series + movies",
      supportBadge: "Native module",
      notes: "Best default for series libraries and subtitle-heavy pulls.",
    },
  },
  {
    id: "bombuj",
    name: "Bombuj",
    domain: "bombuj.si",
    status: "active",
    kind: "movies",
    description: "Movie-focused extractor for fast search hits, direct playback resolution, and high-confidence one-off film imports.",
    capabilities: {
      import: true,
      remoteSearch: true,
      streaming: true,
      downloads: true,
      subtitles: false,
    },
    copy: {
      shortLabel: "Movies first",
      supportBadge: "Movie module",
      notes: "Use when you want movie imports to prefer Bombuj before mixed sources.",
    },
  },
];

export const INTEGRATION_CAPABILITY_LABELS: Record<IntegrationCapabilityKey, string> = {
  import: "Import",
  remoteSearch: "Remote Search",
  streaming: "Playback",
  downloads: "Downloads",
  subtitles: "Subtitles",
};

export function getIntegrationById(id: IntegrationId) {
  return INTEGRATIONS.find((integration) => integration.id === id);
}

export function getIntegrationsForKind(kind: "series" | "movies") {
  return INTEGRATIONS.filter((integration) => integration.kind === "mixed" || integration.kind === kind);
}

export const DISCOVERY_PROVIDER_CAPABILITIES = {
  vidking: {
    supportsGenres: true,
    supportsNetworks: false,
    supportsAudioBuckets: ["all"] as const,
    supportsPeopleSearch: false,
    supportsActorSearch: false,
    supportsDirectorSearch: false,
    supportsSections: ["popular", "newest"] as const,
  },
  svetserialu: {
    supportsGenres: true,
    supportsNetworks: true,
    supportsAudioBuckets: ["all", "subtitles", "dubbing"] as const,
    supportsPeopleSearch: false,
    supportsActorSearch: false,
    supportsDirectorSearch: false,
    supportsSections: ["newest", "latestEpisodes", "novinky", "genreBrowse"] as const,
  },
  bombuj: {
    supportsGenres: true,
    supportsNetworks: false,
    supportsAudioBuckets: ["all", "subtitles", "dubbing", "no_subtitles"] as const,
    supportsPeopleSearch: true,
    supportsActorSearch: true,
    supportsDirectorSearch: true,
    supportsSections: ["newest", "popular", "latestEpisodes", "topOverall", "topToday", "novinky", "genreBrowse"] as const,
  },
};
