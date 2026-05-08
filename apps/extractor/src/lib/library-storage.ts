"use client";

import type { MediaItem, PlayerPreferences } from "@/lib/types";

const LIBRARY_TOKEN_KEY = "spilledcinema.libraryToken";
const PLAYER_PREFS_KEY = "spilledcinema.playerPrefs";

function canUseStorage() {
  return typeof window !== "undefined";
}

export function getLibraryToken() {
  if (!canUseStorage()) {
    return null;
  }

  return window.localStorage.getItem(LIBRARY_TOKEN_KEY);
}

export function setLibraryToken(token: string) {
  if (!canUseStorage()) {
    return;
  }

  window.localStorage.setItem(LIBRARY_TOKEN_KEY, token);
}

export async function bootstrapLibraryToken() {
  const existing = getLibraryToken();
  const response = await fetch("/api/library/bootstrap", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      libraryToken: existing,
    }),
  });
  const payload = (await response.json()) as { libraryToken: string };
  setLibraryToken(payload.libraryToken);
  return payload.libraryToken;
}

async function requireLibraryToken() {
  return getLibraryToken() ?? bootstrapLibraryToken();
}

export async function fetchMediaItems() {
  const libraryToken = await requireLibraryToken();
  const response = await fetch(
    `/api/library/items?libraryToken=${encodeURIComponent(libraryToken)}`,
    {
      cache: "no-store",
    },
  );
  const payload = (await response.json()) as { items?: MediaItem[]; error?: string };

  if (!response.ok) {
    throw new Error(payload.error ?? "Failed to load library items.");
  }

  return payload.items ?? [];
}

export async function createMediaItem(
  item: Omit<MediaItem, "id" | "createdAt" | "updatedAt" | "resumePositionSeconds">,
) {
  const response = await fetch("/api/library/items", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(item),
  });
  const payload = (await response.json()) as { item?: MediaItem; error?: string };

  if (!response.ok || !payload.item) {
    throw new Error(payload.error ?? "Failed to save media item.");
  }

  return payload.item;
}

export async function fetchMediaItem(id: string) {
  const libraryToken = await requireLibraryToken();
  const response = await fetch(
    `/api/library/items/${encodeURIComponent(id)}?libraryToken=${encodeURIComponent(libraryToken)}`,
    {
      cache: "no-store",
    },
  );
  const payload = (await response.json()) as { item?: MediaItem; error?: string };

  if (response.status === 404) {
    return null;
  }

  if (!response.ok) {
    throw new Error(payload.error ?? "Failed to load media item.");
  }

  return payload.item ?? null;
}

export async function updateMediaProgress(id: string, resumePositionSeconds: number) {
  const libraryToken = await requireLibraryToken();
  await fetch(`/api/library/items/${encodeURIComponent(id)}`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      libraryToken,
      resumePositionSeconds,
    }),
  });
}

export async function importSvetSerialuShow(slug: string) {
  const libraryToken = await requireLibraryToken();
  const response = await fetch("/api/library/import-svetserialu", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      libraryToken,
      slug,
    }),
  });
  const payload = (await response.json()) as {
    error?: string;
    show?: {
      slug: string;
      title: string;
      seasons: number[];
      importedCount: number;
      updatedCount: number;
      totalItems: number;
    };
  };

  if (!response.ok) {
    throw new Error(payload.error ?? "Failed to import show.");
  }

  return payload;
}

const defaultPlayerPreferences: PlayerPreferences = {
  volume: 0.9,
  muted: false,
  playbackRate: 1,
  subtitleMode: "showing",
};

export function readPlayerPreferences() {
  if (!canUseStorage()) {
    return defaultPlayerPreferences;
  }

  const raw = window.localStorage.getItem(PLAYER_PREFS_KEY);
  if (!raw) {
    return defaultPlayerPreferences;
  }

  try {
    return {
      ...defaultPlayerPreferences,
      ...(JSON.parse(raw) as Partial<PlayerPreferences>),
    };
  } catch {
    return defaultPlayerPreferences;
  }
}

export function writePlayerPreferences(prefs: PlayerPreferences) {
  if (!canUseStorage()) {
    return;
  }

  window.localStorage.setItem(PLAYER_PREFS_KEY, JSON.stringify(prefs));
}
