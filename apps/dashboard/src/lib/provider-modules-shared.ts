import type {
  EnabledProviderFeed,
  ProviderFeedManifest,
  ProviderModuleManifest,
} from "./types";

export type ProviderFeedViewId = `feed:${string}:${string}`;

export type ProviderFeedDefinition = Omit<ProviderFeedManifest, "moduleId" | "providerId">;

export type ProviderModuleRecord = Omit<ProviderModuleManifest, "capabilities"> & {
  capabilities: {
    import: boolean;
    player: boolean;
    search: boolean;
    download: boolean;
    feeds: ProviderFeedDefinition[];
  };
};

const defaultPublishedAt = Date.UTC(2026, 4, 8);

export const DEFAULT_PROVIDER_MODULE_RECORDS: ProviderModuleRecord[] = [
  {
    moduleId: "vidking",
    providerId: "vidking",
    displayName: "VidKing",
    version: 1,
    status: "active",
    runtime: {
      entry: "connectors/vidking.js",
    },
    capabilities: {
      import: true,
      player: true,
      search: true,
      download: false,
      feeds: [],
    },
    publishedAt: defaultPublishedAt,
    updatedAt: defaultPublishedAt,
  },
  {
    moduleId: "svetserialu",
    providerId: "svetserialu",
    displayName: "SvetSerialu",
    version: 1,
    status: "active",
    runtime: {
      entry: "connectors/svetserialu.js",
    },
    capabilities: {
      import: true,
      player: true,
      search: true,
      download: true,
      feeds: [
        {
          feedId: "new-episodes",
          title: "New Episodes",
          description: "Recently added episodes from SvetSerialu, shown directly inside Spilled.",
          kind: "new-episodes",
          defaultEnabled: false,
          pageTitle: "SvetSerialu New Episodes",
          supportsSearch: true,
          supportsOpenSource: true,
          supportsImport: true,
          sortMode: "newest",
          itemGranularity: "episode",
        },
      ],
    },
    publishedAt: defaultPublishedAt,
    updatedAt: defaultPublishedAt,
  },
  {
    moduleId: "bombuj",
    providerId: "bombuj",
    displayName: "Bombuj",
    version: 1,
    status: "active",
    runtime: {
      entry: "connectors/bombuj.js",
    },
    capabilities: {
      import: true,
      player: true,
      search: true,
      download: true,
      feeds: [
        {
          feedId: "latest-movies",
          title: "Latest Movies",
          description: "Recently added movies from Bombuj.",
          kind: "new-additions",
          defaultEnabled: false,
          pageTitle: "Bombuj Latest Movies",
          supportsSearch: true,
          supportsOpenSource: true,
          supportsImport: true,
          sortMode: "newest",
          itemGranularity: "movie",
        },
        {
          feedId: "latest-series",
          title: "Latest Series",
          description: "Recently added series and episodes from Bombuj.",
          kind: "latest-episodes",
          defaultEnabled: false,
          pageTitle: "Bombuj Latest Series",
          supportsSearch: true,
          supportsOpenSource: true,
          supportsImport: true,
          sortMode: "newest",
          itemGranularity: "show",
        },
      ],
    },
    publishedAt: defaultPublishedAt,
    updatedAt: defaultPublishedAt,
  },
];

export const DEFAULT_PROVIDER_MODULES = hydrateProviderModules(DEFAULT_PROVIDER_MODULE_RECORDS);

export function hydrateProviderModuleRecord(record: ProviderModuleRecord): ProviderModuleManifest {
  return {
    ...record,
    capabilities: {
      ...record.capabilities,
      feeds: record.capabilities.feeds.map((feed) => ({
        ...feed,
        moduleId: record.moduleId,
        providerId: record.providerId,
      })),
    },
  };
}

export function hydrateProviderModules(records: ProviderModuleRecord[]) {
  return records.map(hydrateProviderModuleRecord);
}

export function createProviderFeedViewId(moduleId: string, feedId: string): ProviderFeedViewId {
  return `feed:${moduleId}:${feedId}`;
}

export function isProviderFeedViewId(value: string): value is ProviderFeedViewId {
  return /^feed:[^:]+:[^:]+$/i.test(value);
}

export function parseProviderFeedViewId(value: string) {
  if (!isProviderFeedViewId(value)) {
    return null;
  }

  const [, moduleId, feedId] = value.split(":");
  return { moduleId, feedId };
}

export function createProviderFeedKey(feed: Pick<EnabledProviderFeed, "moduleId" | "feedId">) {
  return `${feed.moduleId}:${feed.feedId}`;
}

export function isSameProviderFeed(
  left: Pick<EnabledProviderFeed, "moduleId" | "feedId">,
  right: Pick<EnabledProviderFeed, "moduleId" | "feedId">,
) {
  return left.moduleId === right.moduleId && left.feedId === right.feedId;
}
