import { fetchProviderFeed } from "./provider-modules-client";
import { importProviderItem } from "./import-client";
import { mergeImportedShowIntoState } from "./storage";
import type {
  ArtworkSourceSettings,
  ExploreItem,
  ImportedShow,
  LibraryState,
  ProviderFeedManifest,
  ProviderModuleManifest,
} from "./types";

const WATCHABLE_FEED_KINDS = new Set(["new-episodes", "latest-episodes", "new-additions"]);
const SUCCESS_COOLDOWN_MS = 45_000;
const FAILURE_COOLDOWN_MS = 20_000;
const recentlyChecked = new Map<string, { checkedAt: number; failed: boolean }>();
const inflightImports = new Map<string, Promise<ImportedShow>>();

export type LibraryWatcherResult = {
  state: LibraryState;
  checkedFeeds: number;
  matchedTitles: number;
  refreshedTitles: number;
  changedTitles: string[];
  failures: string[];
  feedResponses: Awaited<ReturnType<typeof fetchProviderFeed>>[];
};

type WatcherDependencies = {
  fetchFeed?: typeof fetchProviderFeed;
  importItem?: typeof importProviderItem;
  now?: () => number;
};

function normalizeText(value: string | null | undefined) {
  return String(value ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function parseYear(value: string | number | null | undefined) {
  return String(value ?? "").match(/\b(?:19|20)\d{2}\b/)?.[0] ?? null;
}

function showMediaType(show: ImportedShow) {
  return show.mediaType === "movie" || (show.episodes.length === 1 && show.episodes[0]?.episodeCode === "movie")
    ? "movie"
    : "serial";
}

function providerItemKey(item: Pick<ExploreItem, "provider" | "importSlug">) {
  return `${item.provider}:${item.importSlug}`;
}

function hasProviderMatch(show: ImportedShow, item: Pick<ExploreItem, "provider" | "importSlug">) {
  const key = providerItemKey(item);
  return show.providerMatches?.some((match) => `${match.integrationId}:${match.providerItemId}` === key) ?? false;
}

function titleMatches(show: ImportedShow, item: ExploreItem) {
  const showTitles = new Set([
    show.title,
    show.altTitle,
    show.canonicalIdentity?.canonicalTitle,
    show.canonicalIdentity?.originalTitle,
  ].map(normalizeText).filter(Boolean));
  const itemTitles = [
    item.title,
    ...(item.alternateTitles ?? []),
  ].map(normalizeText).filter(Boolean);
  if (!itemTitles.some((title) => showTitles.has(title))) {
    return false;
  }

  const itemType = item.mediaType === "movie" ? "movie" : "serial";
  if (showMediaType(show) !== itemType) {
    return false;
  }

  const showYear = parseYear(show.years ?? show.metadata?.year ?? show.canonicalIdentity?.year);
  const itemYear = parseYear(item.year ?? item.yearLabel);
  return !showYear || !itemYear || showYear === itemYear;
}

export function findLibraryMatch(state: LibraryState, item: ExploreItem): ImportedShow | undefined {
  const exactMatch = state.shows.find((show) => hasProviderMatch(show, item));
  if (exactMatch) return exactMatch;

  if (item.provider === "vidking") {
    const match = item.importSlug.match(/^(movie|tv)\/(\d+)/i);
    const slug = match ? `vidking-${match[1].toLowerCase()}-${match[2]}` : "";
    const show = state.shows.find((entry) => entry.slug === slug);
    if (show) return show;
  }
  if (item.provider === "bombuj") {
    const show = state.shows.find((entry) => entry.slug === `bombuj-${item.importSlug}`);
    if (show) return show;
  }
  if (item.provider === "cineby") {
    const match = item.importSlug.match(/^(movie|tv)\/(\d+)/i);
    const slug = match ? `cineby-${match[1].toLowerCase()}-${match[2]}` : "";
    const show = state.shows.find((entry) => entry.slug === slug);
    if (show) return show;
  }

  return state.shows.find((show) => show.slug === item.importSlug || titleMatches(show, item));
}

function hasEpisode(show: ImportedShow, item: ExploreItem) {
  const code = item.episode?.episodeCode?.trim().toLowerCase();
  if (code) {
    return show.episodes.some((episode) => episode.episodeCode?.trim().toLowerCase() === code);
  }
  const season = item.episode?.seasonNumber;
  const episode = item.episode?.episodeNumber;
  if (Number.isFinite(season) && Number.isFinite(episode)) {
    return show.episodes.some((entry) => entry.seasonNumber === season && entry.episodeNumber === episode);
  }
  return false;
}

function shouldRefreshTitle(show: ImportedShow, item: ExploreItem, feed: ProviderFeedManifest) {
  if (feed.itemGranularity === "episode" || item.episode) {
    return !hasEpisode(show, item);
  }
  if (feed.itemGranularity === "movie") {
    return !hasProviderMatch(show, item);
  }
  // A show-level "latest episodes" card does not identify the episode. Its
  // presence means the provider's full show snapshot must be refreshed.
  return true;
}

function watchedFeeds(modules: ProviderModuleManifest[]) {
  return modules.flatMap((module) =>
    module.status === "active"
      ? module.capabilities.feeds
          .filter((feed) => WATCHABLE_FEED_KINDS.has(feed.kind))
          .map((feed) => ({ module, feed }))
      : [],
  );
}

function showContentFingerprint(show: ImportedShow) {
  return JSON.stringify({
    providerMatches: (show.providerMatches ?? [])
      .map((match) => `${match.integrationId}:${match.providerItemId}`)
      .sort(),
    episodes: show.episodes.map((episode) => ({
      code: episode.episodeCode,
      season: episode.seasonNumber,
      episode: episode.episodeNumber,
      title: episode.episodeTitle,
      players: episode.players
        .map((player) => `${player.provider}|${player.embedUrl}|${player.language ?? ""}|${player.subtitlesUrl ?? ""}`)
        .sort(),
    })),
  });
}

async function importSingleFlight(
  key: string,
  task: () => Promise<ImportedShow>,
) {
  const existing = inflightImports.get(key);
  if (existing) return existing;
  const promise = task().finally(() => inflightImports.delete(key));
  inflightImports.set(key, promise);
  return promise;
}

export async function scanProviderFeeds(
  state: LibraryState,
  modules: ProviderModuleManifest[],
  artworkSources: ArtworkSourceSettings,
  dependencies: WatcherDependencies = {},
): Promise<LibraryWatcherResult> {
  const fetchFeed = dependencies.fetchFeed ?? fetchProviderFeed;
  const importItem = dependencies.importItem ?? importProviderItem;
  const now = dependencies.now ?? Date.now;
  const feeds = watchedFeeds(modules);
  let current = state;
  let checkedFeeds = 0;
  let matchedTitles = 0;
  let refreshedTitles = 0;
  const changedTitles: string[] = [];
  const failures: string[] = [];
  const feedResponses: Awaited<ReturnType<typeof fetchProviderFeed>>[] = [];
  const handledTitles = new Set<string>();

  for (const { module, feed } of feeds) {
    try {
      const response = await fetchFeed({
        moduleId: module.moduleId,
        feedId: feed.feedId,
        limit: 48,
        fresh: true,
      });
      checkedFeeds += 1;
      feedResponses.push(response);

      for (const item of response.items) {
        const show = findLibraryMatch(current, item);
        if (!show || !shouldRefreshTitle(show, item, feed)) continue;
        matchedTitles += 1;

        const checkKey = `${module.moduleId}:${item.importSlug}:${show.slug}`;
        if (handledTitles.has(checkKey)) continue;
        handledTitles.add(checkKey);

        const previousCheck = recentlyChecked.get(checkKey);
        const cooldown = previousCheck?.failed ? FAILURE_COOLDOWN_MS : SUCCESS_COOLDOWN_MS;
        if (previousCheck && now() - previousCheck.checkedAt < cooldown) continue;

        try {
          const imported = await importSingleFlight(checkKey, () =>
            importItem(item.provider, item.importSlug, item.mediaType, artworkSources),
          );
          refreshedTitles += 1;
          recentlyChecked.set(checkKey, { checkedAt: now(), failed: false });

          const before = showContentFingerprint(show);
          const merged = mergeImportedShowIntoState(current, imported, show.slug);
          const mergedShow = merged.shows.find((entry) => entry.slug === show.slug);
          if (mergedShow && showContentFingerprint(mergedShow) !== before) {
            current = merged;
            changedTitles.push(show.slug);
          }
        } catch (error) {
          recentlyChecked.set(checkKey, { checkedAt: now(), failed: true });
          failures.push(`${show.title}: ${error instanceof Error ? error.message : String(error)}`);
        }
      }
    } catch (error) {
      failures.push(`${module.displayName} ${feed.title}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  return {
    state: current,
    checkedFeeds,
    matchedTitles,
    refreshedTitles,
    changedTitles: Array.from(new Set(changedTitles)),
    failures,
    feedResponses,
  };
}
