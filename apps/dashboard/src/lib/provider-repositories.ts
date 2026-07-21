import {
  hydrateProviderModules,
  type ProviderModuleRecord,
} from "./provider-modules-shared";
import type {
  IntegrationCapability,
  IntegrationManifestV2,
  IntegrationRepositoryManifestV2,
  ProviderFeedManifest,
  ProviderModuleManifest,
} from "./types";

export type ProviderRepositoryManifest = {
  schemaVersion: 1;
  name?: string;
  modules: ProviderModuleRecord[];
};

export type IntegrationRepositoryManifest = ProviderRepositoryManifest | IntegrationRepositoryManifestV2;

export type LoadedProviderRepositoryManifest = {
  repositoryUrl: string;
  manifestUrl: string;
  manifest: IntegrationRepositoryManifest;
};

export function normalizeRepositoryManifestUrl(input: string) {
  const value = input.trim();
  if (!value) {
    return null;
  }

  try {
    const url = new URL(value);
    if (url.hostname === "github.com") {
      const parts = url.pathname.split("/").filter(Boolean);
      if (parts.length >= 2) {
        const owner = parts[0];
        const repo = parts[1];
        const branchIndex = parts.findIndex((part) => part === "tree" || part === "blob");
        const branch = branchIndex >= 0 && parts[branchIndex + 1] ? parts[branchIndex + 1] : "main";
        const path = branchIndex >= 0 && parts.length > branchIndex + 2
          ? parts.slice(branchIndex + 2).join("/")
          : "spilled-connectors.json";
        return `https://raw.githubusercontent.com/${owner}/${repo}/${branch}/${path}`;
      }
    }

    if (url.pathname.endsWith(".json")) {
      return url.toString();
    }

    url.pathname = `${url.pathname.replace(/\/+$/, "")}/spilled-connectors.json`;
    return url.toString();
  } catch {
    return null;
  }
}

function githubRawUrlToContentsApiUrl(input: string) {
  try {
    const url = new URL(input);
    if (url.hostname !== "raw.githubusercontent.com") {
      return null;
    }
    const parts = url.pathname.split("/").filter(Boolean);
    if (parts.length < 4) {
      return null;
    }
    const [owner, repo, branch, ...pathParts] = parts;
    return `https://api.github.com/repos/${owner}/${repo}/contents/${pathParts.join("/")}?ref=${encodeURIComponent(branch)}`;
  } catch {
    return null;
  }
}

function decodeBase64Content(value: string) {
  const normalized = value.replace(/\s+/g, "");
  if (typeof atob === "function") {
    return decodeURIComponent(
      Array.from(atob(normalized), (char) => `%${char.charCodeAt(0).toString(16).padStart(2, "0")}`).join(""),
    );
  }
  throw new Error("Base64 decoding is unavailable in this runtime.");
}

export async function fetchProviderRepositoryText(url: string, accept: string) {
  const githubApiUrl = githubRawUrlToContentsApiUrl(url);
  if (githubApiUrl) {
    try {
      const response = await fetch(githubApiUrl, {
        cache: "no-store",
      });
      if (response.ok) {
        const payload = await response.json() as { content?: string; encoding?: string };
        if (payload.encoding === "base64" && typeof payload.content === "string") {
          return decodeBase64Content(payload.content);
        }
      }
    } catch {
      // Fall through to the raw URL. This keeps repository loading working when
      // the GitHub Contents API is rate-limited or unavailable.
    }
  }

  const response = await fetch(url, {
    cache: "no-store",
    headers: accept === "application/json" ? { Accept: accept } : undefined,
  });
  if (!response.ok) {
    throw new Error(`Provider repository file failed (${response.status}) for ${url}.`);
  }
  return await response.text();
}

function isProviderRepositoryManifest(value: unknown): value is ProviderRepositoryManifest {
  if (!value || typeof value !== "object") {
    return false;
  }

  const candidate = value as Record<string, unknown>;
  return candidate.schemaVersion === 1 && Array.isArray(candidate.modules);
}

function isIntegrationRepositoryManifestV2(value: unknown): value is IntegrationRepositoryManifestV2 {
  if (!value || typeof value !== "object") {
    return false;
  }

  const candidate = value as Record<string, unknown>;
  return candidate.schemaVersion === 2
    && typeof candidate.repositoryId === "string"
    && typeof candidate.repositoryName === "string"
    && Array.isArray(candidate.integrations);
}

const capabilitySet = (capabilities: IntegrationCapability[]) => new Set(capabilities);

function defaultFeedForIntegration(integration: IntegrationManifestV2): ProviderFeedManifest[] {
  const capabilities = capabilitySet(integration.capabilities);
  if (!capabilities.has("discovery")) {
    return [];
  }

  return [
    {
      moduleId: integration.id,
      providerId: integration.id as ProviderFeedManifest["providerId"],
      feedId: "default",
      title: `${integration.displayName} Discovery`,
      description: `Discovery feed from ${integration.displayName}.`,
      kind: "custom",
      defaultEnabled: false,
      pageTitle: integration.displayName,
      supportsSearch: capabilities.has("search"),
      supportsOpenSource: true,
      supportsImport: capabilities.has("import"),
      sortMode: "newest",
      itemGranularity: "show",
    },
  ];
}

export function integrationToProviderModuleManifest(integration: IntegrationManifestV2): ProviderModuleManifest {
  const capabilities = capabilitySet(integration.capabilities);
  const now = Date.parse(integration.version) || Date.parse(integration.manifestUrl ?? "") || Date.now();
  return {
    moduleId: integration.id,
    providerId: integration.id as ProviderModuleManifest["providerId"],
    displayName: integration.displayName,
    version: Number.parseInt(integration.version, 10) || 2,
    status: integration.status === "disabled" ? "disabled" : "active",
    runtime: integration.runtime ? { entry: integration.runtime.entry } : undefined,
    capabilities: {
      import: capabilities.has("import"),
      player: capabilities.has("players"),
      search: capabilities.has("search"),
      download: capabilities.has("downloads"),
      feeds: defaultFeedForIntegration(integration),
    },
    publishedAt: now,
    updatedAt: now,
  };
}

export function getRepositoryIntegrations(loaded: LoadedProviderRepositoryManifest): IntegrationManifestV2[] {
  if (loaded.manifest.schemaVersion === 2) {
    return loaded.manifest.integrations.map((integration) => ({
      ...integration,
      repositoryUrl: loaded.repositoryUrl,
      manifestUrl: loaded.manifestUrl,
    }));
  }

  return hydrateProviderModules(loaded.manifest.modules).map((module) => {
    const capabilities: IntegrationCapability[] = [];
    if (module.capabilities.search) capabilities.push("search");
    if (module.capabilities.feeds.length) capabilities.push("discovery");
    if (module.capabilities.import) capabilities.push("import", "metadata");
    if (module.capabilities.player) capabilities.push("players");
    if (module.capabilities.download) capabilities.push("downloads");
    capabilities.push("noCredentials");

    return {
      id: module.moduleId,
      displayName: module.displayName,
      version: String(module.version),
      status: module.status === "active" ? "stable" : "disabled",
      runtime: module.runtime ? { apiVersion: 2, entry: module.runtime.entry } : undefined,
      capabilities,
      repositoryUrl: loaded.repositoryUrl,
      manifestUrl: loaded.manifestUrl,
    };
  });
}

export async function fetchProviderRepositoryModules(repositoryUrl: string) {
  const loaded = await fetchProviderRepositoryManifest(repositoryUrl);
  if (loaded.manifest.schemaVersion === 1) {
    return hydrateProviderModules(loaded.manifest.modules) as ProviderModuleManifest[];
  }
  return getRepositoryIntegrations(loaded).map(integrationToProviderModuleManifest);
}

export async function fetchProviderRepositoryManifest(repositoryUrl: string): Promise<LoadedProviderRepositoryManifest> {
  const manifestUrl = normalizeRepositoryManifestUrl(repositoryUrl);
  if (!manifestUrl) {
    throw new Error("Provider repository URL is invalid.");
  }

  const payload = JSON.parse(await fetchProviderRepositoryText(manifestUrl, "application/json")) as unknown;
  if (!isProviderRepositoryManifest(payload) && !isIntegrationRepositoryManifestV2(payload)) {
    throw new Error("Provider repository manifest is invalid.");
  }

  return {
    repositoryUrl,
    manifestUrl,
    manifest: payload,
  };
}

export async function fetchIntegrationRepositoryCatalog(repositoryUrl: string) {
  const loaded = await fetchProviderRepositoryManifest(repositoryUrl);
  return getRepositoryIntegrations(loaded);
}

export async function fetchIntegrationRepositoryCatalogSettled(repositoryUrls: string[]) {
  const settled = await Promise.allSettled(repositoryUrls.map(fetchIntegrationRepositoryCatalog));
  return settled.flatMap((result) => (result.status === "fulfilled" ? result.value : []));
}

export async function fetchProviderRepositoryModulesSettled(repositoryUrls: string[]) {
  const settled = await Promise.allSettled(repositoryUrls.map(fetchProviderRepositoryModules));
  return settled.flatMap((result) => (result.status === "fulfilled" ? result.value : []));
}

export async function fetchProviderRepositoryManifestsSettled(repositoryUrls: string[]) {
  const settled = await Promise.allSettled(repositoryUrls.map(fetchProviderRepositoryManifest));
  return settled.flatMap((result) => (result.status === "fulfilled" ? result.value : []));
}

export function resolveProviderRepositoryAssetUrl(manifestUrl: string, entry: string) {
  return new URL(entry, manifestUrl).toString();
}

export function mergeProviderModules(moduleSets: ProviderModuleManifest[][]) {
  const merged = new Map<string, ProviderModuleManifest>();
  for (const moduleSet of moduleSets) {
    for (const module of moduleSet) {
      merged.set(module.moduleId, module);
    }
  }
  return Array.from(merged.values());
}
