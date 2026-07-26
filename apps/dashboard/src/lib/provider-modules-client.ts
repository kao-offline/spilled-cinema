import { requestRuntimeJson } from "./local-api";
import {
  fetchIntegrationRepositoryCatalogSettled,
  fetchProviderRepositoryModulesSettled,
  mergeProviderModules,
} from "./provider-repositories";
import { readProviderRepositoryUrls } from "./provider-feed-storage";
import { readSvetSerialuCredentials } from "./integration-user-config";
import type {
  ExploreItem,
  ImportedShow,
  IntegrationManifestV2,
  ProviderFeedResponse,
  ProviderModuleManifest,
  ResolvedTitle,
  TitleSearchResponse,
} from "./types";

export async function fetchProviderModules(repositoryUrls = readProviderRepositoryUrls()) {
  if (repositoryUrls.length === 0) {
    return [];
  }
  const repositoryModules = await fetchProviderRepositoryModulesSettled(repositoryUrls);
  return mergeProviderModules([repositoryModules]) as ProviderModuleManifest[];
}

export async function fetchIntegrationCatalog(repositoryUrls = readProviderRepositoryUrls()) {
  if (repositoryUrls.length === 0) {
    return [];
  }
  return await fetchIntegrationRepositoryCatalogSettled(repositoryUrls);
}

export async function refreshIntegrationCatalog(repositoryUrls = readProviderRepositoryUrls()) {
  const response = await requestRuntimeJson<{ integrations?: IntegrationManifestV2[]; error?: string }>("/api/integrations/refresh", {
    method: "POST",
    body: {
      repositoryUrls,
    },
  });

  if (!response.ok || !Array.isArray(response.data?.integrations)) {
    throw new Error(response.data?.error ?? "Failed to refresh integrations.");
  }

  return response.data.integrations;
}

export async function fetchProviderFeed(input: {
  moduleId: string;
  feedId: string;
  cursor?: string | null;
  limit?: number;
  fresh?: boolean;
}) {
  const response = await requestRuntimeJson<ProviderFeedResponse & { error?: string }>("/api/provider-feed", {
    method: "POST",
    body: {
      ...input,
      repositoryUrls: readProviderRepositoryUrls(),
      svetserialuCredentials: input.moduleId === "svetserialu" ? readSvetSerialuCredentials() : undefined,
    },
  });

  if (!response.ok || !response.data?.items) {
    throw new Error(response.data?.error ?? "Failed to load provider feed.");
  }

  return response.data;
}

export async function searchProviderModuleItems(input: { moduleId: string; query: string }) {
  const response = await requestRuntimeJson<{ results?: ExploreItem[]; error?: string }>("/api/provider-search", {
    method: "POST",
    body: {
      ...input,
      repositoryUrls: readProviderRepositoryUrls(),
      svetserialuCredentials: input.moduleId === "svetserialu" ? readSvetSerialuCredentials() : undefined,
    },
  });

  if (!response.ok || !Array.isArray(response.data?.results)) {
    throw new Error(response.data?.error ?? "Failed to search this provider.");
  }

  return response.data.results;
}

export async function searchTitleItems(input: { query: string; mediaType?: "movie" | "series" }) {
  const response = await requestRuntimeJson<TitleSearchResponse & { error?: string }>("/api/title/search", {
    method: "POST",
    body: {
      ...input,
      repositoryUrls: readProviderRepositoryUrls(),
    },
  });

  if (!response.ok || !Array.isArray(response.data?.results)) {
    throw new Error(response.data?.error ?? "Failed to search titles.");
  }

  return response.data;
}

export async function resolveTitleItem(title: ResolvedTitle) {
  const response = await requestRuntimeJson<{ title?: ResolvedTitle; error?: string }>("/api/title/resolve", {
    method: "POST",
    body: {
      title,
      repositoryUrls: readProviderRepositoryUrls(),
    },
  });

  if (!response.ok || !response.data?.title) {
    throw new Error(response.data?.error ?? "Failed to resolve title.");
  }

  return response.data.title;
}

export async function importTitleItem(title: ResolvedTitle) {
  const response = await requestRuntimeJson<{ show?: ImportedShow; resolvedTitle?: ResolvedTitle; error?: string }>("/api/title/import", {
    method: "POST",
    body: {
      title,
      repositoryUrls: readProviderRepositoryUrls(),
    },
  });

  if (!response.ok || !response.data?.show) {
    throw new Error(response.data?.error ?? "Failed to import title.");
  }

  return response.data;
}
