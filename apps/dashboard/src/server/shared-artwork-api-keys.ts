import type { ArtworkApiKeys } from "./artwork.js";

type SharedArtworkKeysPayload = {
  keys?: ArtworkApiKeys;
};

let sharedKeysPromise: Promise<ArtworkApiKeys> | null = null;
let seedPromise: Promise<void> | null = null;

function controlPlaneUrl(path: string) {
  const normalizedPath = path.replace(/^\/+/, "");
  const convexSiteUrl = process.env.CONVEX_SITE_URL?.trim();
  if (convexSiteUrl) {
    return `${convexSiteUrl.replace(/\/+$/, "")}/server/${normalizedPath}`;
  }

  const controlPlaneUrl = process.env.SPILLED_CONTROL_PLANE_URL?.trim();
  if (controlPlaneUrl) {
    return `${controlPlaneUrl.replace(/\/+$/, "")}/${normalizedPath}`;
  }

  return null;
}

function controlPlaneHeaders() {
  const secret = process.env.SPILLED_CONTROL_PLANE_SECRET?.trim();
  return {
    "Content-Type": "application/json",
    ...(secret ? { "x-spilled-control-plane-secret": secret } : {}),
  };
}

function envArtworkApiKeys(): ArtworkApiKeys {
  return {
    tmdbApiKey: process.env.TMDB_API_KEY?.trim() || undefined,
    fanartApiKey: process.env.FANART_API_KEY?.trim() || undefined,
    tvdbApiKey: process.env.TVDB_API_KEY?.trim() || undefined,
  };
}

function hasAnyKey(keys: ArtworkApiKeys) {
  return Boolean(keys.tmdbApiKey || keys.fanartApiKey || keys.tvdbApiKey);
}

async function seedSharedArtworkApiKeysFromEnv() {
  const url = controlPlaneUrl("integrations/shared-artwork-api-keys/seed");
  const keys = envArtworkApiKeys();
  if (!url || !hasAnyKey(keys)) {
    return;
  }

  await fetch(url, {
    method: "POST",
    headers: controlPlaneHeaders(),
    body: JSON.stringify({ keys }),
  }).catch(() => null);
}

async function fetchSharedArtworkApiKeys() {
  seedPromise ??= seedSharedArtworkApiKeysFromEnv();
  await seedPromise;

  const url = controlPlaneUrl("integrations/shared-artwork-api-keys");
  if (!url) {
    return {};
  }

  const response = await fetch(url, {
    method: "GET",
    headers: controlPlaneHeaders(),
  }).catch(() => null);

  if (!response?.ok) {
    return {};
  }

  const payload = (await response.json().catch(() => null)) as SharedArtworkKeysPayload | null;
  return payload?.keys ?? {};
}

export async function resolveArtworkApiKeys(userKeys?: ArtworkApiKeys): Promise<ArtworkApiKeys | undefined> {
  sharedKeysPromise ??= fetchSharedArtworkApiKeys();
  const sharedKeys = await sharedKeysPromise;
  const envKeys = envArtworkApiKeys();
  const merged = {
    tmdbApiKey: userKeys?.tmdbApiKey?.trim() || sharedKeys.tmdbApiKey || envKeys.tmdbApiKey,
    fanartApiKey: userKeys?.fanartApiKey?.trim() || sharedKeys.fanartApiKey || envKeys.fanartApiKey,
    tvdbApiKey: userKeys?.tvdbApiKey?.trim() || sharedKeys.tvdbApiKey || envKeys.tvdbApiKey,
  };

  return hasAnyKey(merged) ? merged : undefined;
}
