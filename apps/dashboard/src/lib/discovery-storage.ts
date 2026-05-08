import type {
  ExploreItem,
  ExploreFeedResponse,
  ExploreFilters,
  TrendingFeedResponse,
  UserTasteProfile,
} from "./types";
import type { ImportedShow, LibraryEpisode, LibraryState } from "./types";
import type { IntegrationId } from "./integrations";

const DISCOVERY_STATE_KEY = "spilled-discovery.state.v1";
const PROFILE_KEY = "spilled-discovery.profile.v1";

type CachedFeed<T> = {
  updatedAt: number;
  signature: string;
  payload: T;
};

export type DiscoveryUiState = {
  exploreQuery: string;
  trendingQuery: string;
  exploreFilters: ExploreFilters;
  cachedExplore?: CachedFeed<ExploreFeedResponse>;
  cachedTrending?: CachedFeed<TrendingFeedResponse>;
};

const emptyFilters: ExploreFilters = {
  mediaTypes: [],
  providers: [],
  genres: [],
  audioBuckets: [],
  networks: [],
  sections: [],
  inVault: "all",
  availability: "all",
  personRole: "any",
};

const emptyDiscoveryState: DiscoveryUiState = {
  exploreQuery: "",
  trendingQuery: "",
  exploreFilters: emptyFilters,
};

const emptyProfile: UserTasteProfile = {
  updatedAt: 0,
  importedSlugs: [],
  favoriteSlugs: [],
  recentShowSlugs: [],
  recentEpisodeIds: [],
  providerAffinity: {},
  genreAffinity: {},
  networkAffinity: {},
  audioAffinity: {},
};

function canUseStorage() {
  return typeof window !== "undefined";
}

function readJson<T>(key: string, fallback: T) {
  if (!canUseStorage()) {
    return fallback;
  }

  try {
    const raw = window.localStorage.getItem(key);
    return raw ? ({ ...fallback, ...JSON.parse(raw) } as T) : fallback;
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

function uniqueRecent(list: string[], value: string, limit = 24) {
  const next = [value, ...list.filter((entry) => entry !== value)];
  return next.slice(0, limit);
}

function incrementRecord(record: Record<string, number>, key: string, amount = 1) {
  if (!key) {
    return record;
  }
  return {
    ...record,
    [key]: (record[key] ?? 0) + amount,
  };
}

function normalizeDiscoveryKey(value: string | null | undefined) {
  return String(value || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function inferProviderFromShow(show: ImportedShow): IntegrationId {
  if (show.slug.startsWith("bombuj-")) {
    return "bombuj";
  }

  const providers = new Set(
    show.episodes
      .flatMap((episode) => episode.players)
      .map((player) => player.provider.toLowerCase()),
  );

  if ([...providers].some((provider) => provider.includes("bombuj"))) {
    return "bombuj";
  }

  return "svetserialu";
}

export function readDiscoveryUiState(): DiscoveryUiState {
  const parsed = readJson<Partial<DiscoveryUiState>>(DISCOVERY_STATE_KEY, emptyDiscoveryState);
  return {
    ...emptyDiscoveryState,
    ...parsed,
    exploreFilters: {
      ...emptyFilters,
      ...(parsed.exploreFilters ?? {}),
    },
  };
}

export function writeDiscoveryUiState(state: DiscoveryUiState) {
  writeJson(DISCOVERY_STATE_KEY, state);
}

export function updateDiscoveryUiState(change: Partial<DiscoveryUiState>) {
  const next = {
    ...readDiscoveryUiState(),
    ...change,
    exploreFilters: {
      ...readDiscoveryUiState().exploreFilters,
      ...(change.exploreFilters ?? {}),
    },
  };
  writeDiscoveryUiState(next);
  return next;
}

export function readTasteProfile() {
  const parsed = readJson<Partial<UserTasteProfile>>(PROFILE_KEY, emptyProfile);
  return {
    ...emptyProfile,
    ...parsed,
    providerAffinity: {
      ...emptyProfile.providerAffinity,
      ...(parsed.providerAffinity ?? {}),
    },
    genreAffinity: {
      ...emptyProfile.genreAffinity,
      ...(parsed.genreAffinity ?? {}),
    },
    networkAffinity: {
      ...emptyProfile.networkAffinity,
      ...(parsed.networkAffinity ?? {}),
    },
    audioAffinity: {
      ...emptyProfile.audioAffinity,
      ...(parsed.audioAffinity ?? {}),
    },
  };
}

export function writeTasteProfile(profile: UserTasteProfile) {
  writeJson(PROFILE_KEY, profile);
}

export function updateTasteProfile(mutator: (current: UserTasteProfile) => UserTasteProfile) {
  const next = mutator(readTasteProfile());
  writeTasteProfile({
    ...next,
    updatedAt: Date.now(),
  });
  return next;
}

export function cacheExploreFeed(signature: string, payload: ExploreFeedResponse) {
  return updateDiscoveryUiState({
    cachedExplore: {
      signature,
      payload,
      updatedAt: Date.now(),
    },
  });
}

export function cacheTrendingFeed(signature: string, payload: TrendingFeedResponse) {
  return updateDiscoveryUiState({
    cachedTrending: {
      signature,
      payload,
      updatedAt: Date.now(),
    },
  });
}

export function recordImportedShowSignal(show: ImportedShow) {
  const provider = inferProviderFromShow(show);
  return updateTasteProfile((current) => ({
    ...current,
    importedSlugs: uniqueRecent(current.importedSlugs, show.slug, 80),
    recentShowSlugs: uniqueRecent(current.recentShowSlugs, show.slug),
    providerAffinity: {
      ...current.providerAffinity,
      [provider]: (current.providerAffinity[provider] ?? 0) + 3,
    },
  }));
}

export function recordFavoriteSignal(show: ImportedShow, isFavorite: boolean) {
  const provider = inferProviderFromShow(show);
  return updateTasteProfile((current) => ({
    ...current,
    favoriteSlugs: isFavorite
      ? uniqueRecent(current.favoriteSlugs, show.slug, 80)
      : current.favoriteSlugs.filter((entry) => entry !== show.slug),
    providerAffinity: {
      ...current.providerAffinity,
      [provider]: (current.providerAffinity[provider] ?? 0) + (isFavorite ? 4 : 1),
    },
  }));
}

export function recordShowOpenSignal(show: ImportedShow) {
  const provider = inferProviderFromShow(show);
  return updateTasteProfile((current) => ({
    ...current,
    recentShowSlugs: uniqueRecent(current.recentShowSlugs, show.slug),
    providerAffinity: {
      ...current.providerAffinity,
      [provider]: (current.providerAffinity[provider] ?? 0) + 1,
    },
  }));
}

export function recordEpisodePlaySignal(show: ImportedShow, episode: LibraryEpisode) {
  const provider = inferProviderFromShow(show);
  return updateTasteProfile((current) => ({
    ...current,
    recentShowSlugs: uniqueRecent(current.recentShowSlugs, show.slug),
    recentEpisodeIds: uniqueRecent(current.recentEpisodeIds, episode.id, 120),
    providerAffinity: {
      ...current.providerAffinity,
      [provider]: (current.providerAffinity[provider] ?? 0) + 2,
    },
  }));
}

export function recordAudioPreferenceSignal(language: string | undefined) {
  if (!language) {
    return readTasteProfile();
  }

  return updateTasteProfile((current) => ({
    ...current,
    audioAffinity: incrementRecord(current.audioAffinity, language.toLowerCase(), 1),
  }));
}

export function deriveTasteProfileFromLibraryState(state: LibraryState) {
  const persisted = readTasteProfile();
  const cachedExploreItems = readDiscoveryUiState().cachedExplore?.payload.items ?? [];
  const importedSlugs = state.shows.slice(0, 120).map((show) => show.slug);
  const favoriteSlugs = state.shows.filter((show) => show.isFavorite).map((show) => show.slug);

  const providerAffinity: Partial<Record<IntegrationId, number>> = {
    ...persisted.providerAffinity,
  };
  const genreAffinity = {
    ...persisted.genreAffinity,
  };
  const networkAffinity = {
    ...persisted.networkAffinity,
  };

  const cachedByProviderSlug = new Map<string, ExploreItem>();
  const cachedByTitle = new Map<string, ExploreItem>();
  for (const item of cachedExploreItems) {
    cachedByProviderSlug.set(`${item.provider}:${item.importSlug}`, item);
    cachedByTitle.set(normalizeDiscoveryKey(item.title), item);
  }

  for (const show of state.shows) {
    const provider = inferProviderFromShow(show);
    providerAffinity[provider] = (providerAffinity[provider] ?? 0) + 1;
    if (show.isFavorite) {
      providerAffinity[provider] = (providerAffinity[provider] ?? 0) + 2;
    }

    const providerSlug = show.slug.startsWith("bombuj-") ? show.slug.replace(/^bombuj-/, "") : show.slug;
    const discoveryMatch =
      cachedByProviderSlug.get(`${provider}:${providerSlug}`) ??
      cachedByTitle.get(normalizeDiscoveryKey(show.title)) ??
      (show.altTitle ? cachedByTitle.get(normalizeDiscoveryKey(show.altTitle)) : undefined);
    const signalWeight = show.isFavorite ? 3 : 1;

    for (const genre of discoveryMatch?.genres ?? []) {
      const normalizedGenre = normalizeDiscoveryKey(genre);
      if (!normalizedGenre) {
        continue;
      }
      genreAffinity[normalizedGenre] = (genreAffinity[normalizedGenre] ?? 0) + signalWeight;
    }

    const normalizedNetwork = normalizeDiscoveryKey(discoveryMatch?.network);
    if (normalizedNetwork) {
      networkAffinity[normalizedNetwork] = (networkAffinity[normalizedNetwork] ?? 0) + signalWeight;
    }
  }

  return {
    ...persisted,
    updatedAt: Date.now(),
    importedSlugs,
    favoriteSlugs,
    providerAffinity,
    genreAffinity,
    networkAffinity,
  };
}
