import { requestRuntimeJson } from "./local-api";
import {
  DEFAULT_PROVIDER_MODULES,
  hydrateProviderModules,
  type ProviderModuleRecord,
} from "./provider-modules-shared";
import type { ExploreItem, ProviderFeedResponse, ProviderModuleManifest } from "./types";

async function fetchControlPlaneProviderModules() {
  const response = await fetch("/api/server/provider-modules", {
    method: "GET",
    headers: { Accept: "application/json" },
  });
  if (!response.ok) {
    throw new Error(`Control plane provider modules failed (${response.status}).`);
  }

  const payload = await response.json() as { modules?: ProviderModuleRecord[] };
  if (!Array.isArray(payload.modules) || payload.modules.length === 0) {
    return DEFAULT_PROVIDER_MODULES;
  }

  return hydrateProviderModules(payload.modules) as ProviderModuleManifest[];
}

export async function fetchProviderModules() {
  try {
    return await fetchControlPlaneProviderModules();
  } catch {
    const response = await requestRuntimeJson<{ modules?: ProviderModuleRecord[]; error?: string }>("/api/provider-modules", {
      method: "GET",
    });

    if (!response.ok) {
      throw new Error(response.data?.error ?? "Failed to load provider modules.");
    }

    if (!Array.isArray(response.data?.modules) || response.data.modules.length === 0) {
      return DEFAULT_PROVIDER_MODULES;
    }

    return hydrateProviderModules(response.data.modules) as ProviderModuleManifest[];
  }
}

export async function fetchProviderFeed(input: {
  moduleId: string;
  feedId: string;
  cursor?: string | null;
  limit?: number;
}) {
  const response = await requestRuntimeJson<ProviderFeedResponse & { error?: string }>("/api/provider-feed", {
    method: "POST",
    body: input,
  });

  if (!response.ok || !response.data?.items) {
    throw new Error(response.data?.error ?? "Failed to load provider feed.");
  }

  return response.data;
}

export async function searchProviderModuleItems(input: { moduleId: string; query: string }) {
  const response = await requestRuntimeJson<{ results?: ExploreItem[]; error?: string }>("/api/provider-search", {
    method: "POST",
    body: input,
  });

  if (!response.ok || !Array.isArray(response.data?.results)) {
    throw new Error(response.data?.error ?? "Failed to search this provider.");
  }

  return response.data.results;
}
