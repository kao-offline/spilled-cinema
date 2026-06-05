import {
  hydrateProviderModules,
  type ProviderModuleRecord,
} from "./provider-modules-shared";
import type { ProviderModuleManifest } from "./types";

export type ProviderRepositoryManifest = {
  schemaVersion: 1;
  name?: string;
  modules: ProviderModuleRecord[];
};

function normalizeRepositoryManifestUrl(input: string) {
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

function isProviderRepositoryManifest(value: unknown): value is ProviderRepositoryManifest {
  if (!value || typeof value !== "object") {
    return false;
  }

  const candidate = value as Record<string, unknown>;
  return candidate.schemaVersion === 1 && Array.isArray(candidate.modules);
}

export async function fetchProviderRepositoryModules(repositoryUrl: string) {
  const manifestUrl = normalizeRepositoryManifestUrl(repositoryUrl);
  if (!manifestUrl) {
    throw new Error("Provider repository URL is invalid.");
  }

  const response = await fetch(manifestUrl, {
    headers: { Accept: "application/json" },
  });
  if (!response.ok) {
    throw new Error(`Provider repository failed (${response.status}).`);
  }

  const payload = await response.json() as unknown;
  if (!isProviderRepositoryManifest(payload)) {
    throw new Error("Provider repository manifest is invalid.");
  }

  return hydrateProviderModules(payload.modules) as ProviderModuleManifest[];
}

export async function fetchProviderRepositoryModulesSettled(repositoryUrls: string[]) {
  const settled = await Promise.allSettled(repositoryUrls.map(fetchProviderRepositoryModules));
  return settled.flatMap((result) => (result.status === "fulfilled" ? result.value : []));
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
