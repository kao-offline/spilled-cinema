import { createProviderFeedKey } from "./provider-modules-shared";
import type { EnabledProviderFeed, ProviderModuleManifest } from "./types";

const ENABLED_PROVIDER_FEEDS_KEY = "spilled.provider-feeds.enabled.v1";
const CACHED_PROVIDER_MODULES_KEY = "spilled.provider-feeds.modules.v1";
const PROVIDER_REPOSITORY_URLS_KEY = "spilled.provider-feeds.repositories.v1";

export type ProviderModulesCache = {
  updatedAt: number;
  modules: ProviderModuleManifest[];
};

export const DEFAULT_PROVIDER_REPOSITORY_URL = "https://github.com/kao-offline/spilled-connectors";

function canUseStorage() {
  return typeof window !== "undefined";
}

function readJson<T>(key: string, fallback: T) {
  if (!canUseStorage()) {
    return fallback;
  }

  try {
    const raw = window.localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function writeJson(key: string, value: unknown) {
  if (!canUseStorage()) {
    return;
  }

  window.localStorage.setItem(key, JSON.stringify(value));
}

function isEnabledProviderFeed(value: unknown): value is EnabledProviderFeed {
  if (!value || typeof value !== "object") {
    return false;
  }

  const candidate = value as Record<string, unknown>;
  return typeof candidate.moduleId === "string" && typeof candidate.feedId === "string";
}

export function readEnabledProviderFeeds() {
  const parsed = readJson<unknown[]>(ENABLED_PROVIDER_FEEDS_KEY, []);
  return uniqueEnabledProviderFeeds(parsed.filter(isEnabledProviderFeed));
}

export function writeEnabledProviderFeeds(feeds: EnabledProviderFeed[]) {
  writeJson(ENABLED_PROVIDER_FEEDS_KEY, uniqueEnabledProviderFeeds(feeds));
}

export function toggleEnabledProviderFeed(
  feeds: EnabledProviderFeed[],
  target: EnabledProviderFeed,
) {
  const exists = feeds.some((feed) => createProviderFeedKey(feed) === createProviderFeedKey(target));
  return exists
    ? feeds.filter((feed) => createProviderFeedKey(feed) !== createProviderFeedKey(target))
    : uniqueEnabledProviderFeeds([...feeds, target]);
}

export function uniqueEnabledProviderFeeds(feeds: EnabledProviderFeed[]) {
  return Array.from(new Map(feeds.map((feed) => [createProviderFeedKey(feed), feed])).values());
}

export function sanitizeEnabledProviderFeeds(
  feeds: EnabledProviderFeed[],
  modules: ProviderModuleManifest[],
) {
  const validKeys = new Set(
    modules.flatMap((module) =>
      module.capabilities.feeds.map((feed) => createProviderFeedKey(feed)),
    ),
  );

  return uniqueEnabledProviderFeeds(feeds).filter((feed) => validKeys.has(createProviderFeedKey(feed)));
}

export function readCachedProviderModules() {
  const fallback: ProviderModulesCache = {
    updatedAt: 0,
    modules: [],
  };
  const parsed = readJson<ProviderModulesCache>(CACHED_PROVIDER_MODULES_KEY, fallback);
  if (!Array.isArray(parsed.modules)) {
    return fallback;
  }
  return parsed;
}

export function writeCachedProviderModules(modules: ProviderModuleManifest[]) {
  writeJson(CACHED_PROVIDER_MODULES_KEY, {
    updatedAt: Date.now(),
    modules,
  } satisfies ProviderModulesCache);
}

function normalizeRepositoryUrl(value: string) {
  const normalized = value.trim().replace(/\/+$/, "");
  if (normalized === "https://github.com/kao-offline/spilled-conectors") {
    return DEFAULT_PROVIDER_REPOSITORY_URL;
  }
  return normalized;
}

export function readProviderRepositoryUrls() {
  const parsed = readJson<unknown[]>(PROVIDER_REPOSITORY_URLS_KEY, []);
  return Array.from(
    new Set(
      [DEFAULT_PROVIDER_REPOSITORY_URL, ...parsed
        .filter((value): value is string => typeof value === "string")
        .map(normalizeRepositoryUrl)
        .filter(Boolean)],
    ),
  );
}

export function writeProviderRepositoryUrls(urls: string[]) {
  writeJson(
    PROVIDER_REPOSITORY_URLS_KEY,
    Array.from(new Set([DEFAULT_PROVIDER_REPOSITORY_URL, ...urls.map(normalizeRepositoryUrl).filter(Boolean)])),
  );
}
