import { Buffer } from "node:buffer";
import type {
  ExploreItem,
  ImportedShow,
  IntegrationManifestV2,
  PlayerSource,
  ProviderCandidate,
  ProviderFeedResponse,
  ProviderMatch,
  SubtitleSource,
  DownloadSource,
  TitleIdentity,
} from "../lib/types";
import {
  fetchProviderRepositoryManifestsSettled,
  fetchProviderRepositoryText,
  getRepositoryIntegrations,
  integrationToProviderModuleManifest,
  resolveProviderRepositoryAssetUrl,
} from "../lib/provider-repositories";
import { hydrateProviderModuleRecord } from "../lib/provider-modules-shared";
import type { ProviderModuleAdapter } from "./provider-modules";

type RemoteProviderModule = {
  getFeed?: (input: {
    moduleId: string;
    feedId: string;
    cursor?: string | null;
    limit?: number;
  }) => Promise<ProviderFeedResponse>;
  search?: (input: {
    moduleId: string;
    query: string;
  }) => Promise<ExploreItem[]>;
  importItem?: (input: {
    moduleId: string;
    slug: string;
    mediaType?: "movie" | "serial";
  }) => Promise<ImportedShow>;
  default?: {
    getFeed?: RemoteProviderModule["getFeed"];
    search?: RemoteProviderModule["search"];
    importItem?: RemoteProviderModule["importItem"];
  };
};

export type RemoteIntegrationContext = {
  fetch: typeof fetch;
  log: (message: string, details?: unknown) => void;
  timeoutMs: number;
};

type RemoteIntegrationModule = RemoteProviderModule & {
  integration?: {
    apiVersion?: number;
    search?: (input: {
      query: string;
      mediaType?: "movie" | "series";
      locale?: string;
      limit?: number;
    }, context: RemoteIntegrationContext) => Promise<ProviderCandidate[] | ExploreItem[]>;
    getFeed?: (input: {
      feedId: string;
      cursor?: string | null;
      limit?: number;
    }, context: RemoteIntegrationContext) => Promise<ProviderFeedResponse>;
    resolveCandidateMetadata?: (input: {
      candidate: ProviderCandidate;
    }, context: RemoteIntegrationContext) => Promise<Partial<ProviderCandidate>>;
    resolvePlayers?: (input: {
      identity: TitleIdentity;
      providerMatch?: ProviderMatch;
    }, context: RemoteIntegrationContext) => Promise<PlayerSource[]>;
    resolveSubtitles?: (input: {
      identity: TitleIdentity;
      providerMatch?: ProviderMatch;
    }, context: RemoteIntegrationContext) => Promise<SubtitleSource[]>;
    resolveDownloads?: (input: {
      identity: TitleIdentity;
      providerMatch?: ProviderMatch;
    }, context: RemoteIntegrationContext) => Promise<DownloadSource[]>;
    importFallback?: (input: {
      slug: string;
      mediaType?: "movie" | "serial";
    }, context: RemoteIntegrationContext) => Promise<ImportedShow>;
  };
};

const remoteModuleCache = new Map<string, Promise<RemoteProviderModule>>();

async function importRemoteConnector(entryUrl: string) {
  const cached = remoteModuleCache.get(entryUrl);
  if (cached) {
    return cached;
  }

  const loaded = (async () => {
    const source = await fetchProviderRepositoryText(entryUrl, "text/javascript, application/javascript, */*");
    const dataUrl = `data:text/javascript;base64,${Buffer.from(source, "utf8").toString("base64")}#${encodeURIComponent(entryUrl)}`;
    return await import(dataUrl) as RemoteIntegrationModule;
  })();

  remoteModuleCache.set(entryUrl, loaded);
  return loaded;
}

function getRemoteFunction<T extends "getFeed" | "search" | "importItem">(module: RemoteIntegrationModule, key: T) {
  const fn = module[key] ?? module.default?.[key];
  return typeof fn === "function" ? fn : null;
}

function assertDeclaredCapability(integration: IntegrationManifestV2, capability: string, fn: unknown) {
  if (typeof fn === "function" && !integration.capabilities.includes(capability as never)) {
    throw new Error(`Integration "${integration.id}" exports ${capability} but does not declare that capability.`);
  }
}

function createConstrainedFetch(integration: IntegrationManifestV2): typeof fetch {
  const allowedHosts = new Set(
    (integration.networkPermissions ?? [])
      .map((permission) => {
        try {
          return new URL(permission).host;
        } catch {
          return null;
        }
      })
      .filter((host): host is string => Boolean(host)),
  );

  return (async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
    const url = typeof input === "string" || input instanceof URL
      ? new URL(input)
      : new URL(input.url);
    if (allowedHosts.size > 0 && !allowedHosts.has(url.host)) {
      throw new Error(`Integration "${integration.id}" requested undeclared host ${url.host}.`);
    }
    return await fetch(input, init);
  }) as typeof fetch;
}

function createRemoteIntegrationContext(integration: IntegrationManifestV2): RemoteIntegrationContext {
  return {
    fetch: createConstrainedFetch(integration),
    log: (message, details) => {
      console.info(`[integration:${integration.id}] ${message}`, details ?? "");
    },
    timeoutMs: 20_000,
  };
}

function validateRemoteIntegration(integration: IntegrationManifestV2, remoteModule: RemoteIntegrationModule) {
  const api = remoteModule.integration;
  if (!api) {
    return null;
  }
  if (api.apiVersion !== 2) {
    throw new Error(`Integration "${integration.id}" exports unsupported apiVersion.`);
  }
  assertDeclaredCapability(integration, "search", api.search);
  assertDeclaredCapability(integration, "discovery", api.getFeed);
  assertDeclaredCapability(integration, "metadata", api.resolveCandidateMetadata);
  assertDeclaredCapability(integration, "players", api.resolvePlayers);
  assertDeclaredCapability(integration, "subtitles", api.resolveSubtitles);
  assertDeclaredCapability(integration, "downloads", api.resolveDownloads);
  assertDeclaredCapability(integration, "import", api.importFallback);
  return api;
}

export async function getRemoteIntegrationAdapter(input: {
  integrationId: string;
  repositoryUrls?: string[];
}) {
  if (!input.repositoryUrls?.length) {
    return null;
  }

  const repositories = await fetchProviderRepositoryManifestsSettled(input.repositoryUrls);
  for (const repository of repositories) {
    const integration = getRepositoryIntegrations(repository).find((entry) => entry.id === input.integrationId);
    if (!integration?.runtime?.entry) {
      continue;
    }

    const entryUrl = resolveProviderRepositoryAssetUrl(repository.manifestUrl, integration.runtime.entry);
    const remoteModule = await importRemoteConnector(entryUrl);
    const api = validateRemoteIntegration(integration, remoteModule);
    if (!api) {
      continue;
    }
    return {
      manifest: integration,
      api,
      context: createRemoteIntegrationContext(integration),
    };
  }

  return null;
}

export async function getRemoteProviderModuleAdapter(input: {
  moduleId: string;
  repositoryUrls?: string[];
}): Promise<ProviderModuleAdapter | null> {
  if (!input.repositoryUrls?.length) {
    return null;
  }

  const repositories = await fetchProviderRepositoryManifestsSettled(input.repositoryUrls);
  for (const repository of repositories) {
    const integration = getRepositoryIntegrations(repository).find((entry) => entry.id === input.moduleId);
    if (integration?.runtime?.entry) {
      const manifest = integrationToProviderModuleManifest(integration);
      const entryUrl = resolveProviderRepositoryAssetUrl(repository.manifestUrl, integration.runtime.entry);
      const remoteModule = await importRemoteConnector(entryUrl);
      const api = validateRemoteIntegration(integration, remoteModule);
      if (api) {
        const context = createRemoteIntegrationContext(integration);
        return {
          moduleId: manifest.moduleId,
          providerId: manifest.providerId,
          getFeed: api.getFeed
            ? async (feedId, args) => await api.getFeed!({
                feedId,
                cursor: args.cursor ?? null,
                limit: args.limit,
              }, context)
            : undefined,
          search: api.search
            ? async (query) => (await api.search!({ query }, context) as ExploreItem[])
            : undefined,
          import: api.importFallback
            ? async (slug, mediaType) => await api.importFallback!({ slug, mediaType }, context)
            : undefined,
        };
      }
    }

    if (repository.manifest.schemaVersion !== 1) {
      continue;
    }

    const record = repository.manifest.modules.find((moduleRecord) => moduleRecord.moduleId === input.moduleId);
    if (!record?.runtime?.entry) {
      continue;
    }

    const manifest = hydrateProviderModuleRecord(record);
    const entryUrl = resolveProviderRepositoryAssetUrl(repository.manifestUrl, record.runtime.entry);
    const remoteModule = await importRemoteConnector(entryUrl);
    const remoteGetFeed = getRemoteFunction(remoteModule, "getFeed");
    const remoteSearch = getRemoteFunction(remoteModule, "search");
    const remoteImportItem = getRemoteFunction(remoteModule, "importItem");

    return {
      moduleId: manifest.moduleId,
      providerId: manifest.providerId,
      getFeed: remoteGetFeed
        ? async (feedId, args) => await remoteGetFeed({
            moduleId: manifest.moduleId,
            feedId,
            cursor: args.cursor ?? null,
            limit: args.limit,
          })
        : undefined,
      search: remoteSearch
        ? async (query) => await remoteSearch({
            moduleId: manifest.moduleId,
            query,
          })
        : undefined,
      import: remoteImportItem
        ? async (slug, mediaType) => await remoteImportItem({
            moduleId: manifest.moduleId,
            slug,
            mediaType,
          })
        : undefined,
    };
  }

  return null;
}
