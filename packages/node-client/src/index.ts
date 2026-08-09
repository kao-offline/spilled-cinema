import {
  cancelFullDownloadJob,
  createFullDownloadJob,
  deleteEpisodeDownload,
  findEpisodeDownloadByFileNameFast,
  findEpisodeDownloadFast,
  getDownloadedEpisodes,
  getDownloadedSubtitles,
  getFullDownloadJob,
  getMediaToolStatus,
  listDownloadedEpisodeIds,
  resolveBrowserDownload,
  resolvePlaybackStream,
} from "../../../apps/dashboard/src/server/full-download";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { basename } from "node:path";
import { enrichArtwork, searchArtworkAssets } from "../../../apps/dashboard/src/server/artwork";
import {
  hasRequiredSearchTokenCoverage,
  keepHighConfidenceSearchResults,
  scoreSearchCandidate,
  sortUnifiedSearchResults,
  trimWeakSearchEdges,
} from "../../../apps/dashboard/src/lib/search-ranking";
import { fetchBombujMovie, searchBombuj } from "../../../apps/dashboard/src/server/bombuj";
import { checkVidkingAvailabilityBatch, searchVidking } from "../../../apps/dashboard/src/server/vidking";
import { getExploreFeed } from "../../../apps/dashboard/src/server/explore-feed";
import { loadProviderFeed } from "../../../apps/dashboard/src/server/provider-feed";
import { importProviderModuleItem } from "../../../apps/dashboard/src/server/provider-import";
import { loadProviderModulesFromControlPlane } from "../../../apps/dashboard/src/server/provider-modules";
import { searchProviderModule } from "../../../apps/dashboard/src/server/provider-search";
import {
  fetchSvetSerialuShow,
  searchSvetSerialu,
  verifySvetSerialuLogin,
  type SvetSerialuCredentials,
} from "../../../apps/dashboard/src/server/svetserialu";
import { getTrendingFeed } from "../../../apps/dashboard/src/server/trending-feed";
import {
  importResolvedTitle,
  listIntegrationCatalog,
  resolveTitle,
  searchTitles,
} from "../../../apps/dashboard/src/server/title-resolver";
import { SpilledCinemaNodeRuntime } from "../../../apps/server/src/runtime";
import { sha256 } from "../../security/src";

function inferEndpointUrl() {
  if (process.env.SPILLED_NODE_ENDPOINT_URL) {
    return process.env.SPILLED_NODE_ENDPOINT_URL;
  }

  const port = process.env.PORT;
  if (!port) {
    return undefined;
  }

  const host = process.env.HOST && !["0.0.0.0", "::"].includes(process.env.HOST)
    ? process.env.HOST
    : "127.0.0.1";
  return `http://${host}:${port}`;
}

const runtime = new SpilledCinemaNodeRuntime({
  endpointUrl: inferEndpointUrl(),
});

export function getNodeRuntime() {
  return runtime;
}

export function setNodeEndpointUrl(endpointUrl?: string) {
  runtime.setEndpointUrl(endpointUrl);
}

export async function getNodeStatus() {
  const [status, mediaTools] = await Promise.all([runtime.getStatus(), getMediaToolStatus()]);
  return {
    ...status,
    mediaTools,
  };
}

export async function searchNode(query: string, options: { svetserialuCredentials?: SvetSerialuCredentials | null } = {}) {
  const normalizedQuery = query.trim();
  if (normalizedQuery.length < 2) {
    return [];
  }

  const cacheKey = `${normalizeBridgeText(normalizedQuery)}:${options.svetserialuCredentials ? "authenticated" : "public"}`;
  const cached = remoteSearchCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.results;
  }
  const pending = remoteSearchInflight.get(cacheKey);
  if (pending) {
    return pending;
  }

  const search = runParallelProviderSearch(normalizedQuery, options)
    .then((results) => {
      // Do not turn a temporary provider timeout into 10 minutes of guaranteed
      // "0 found" responses. Successful searches are safe to cache; empty
      // searches must be allowed to retry immediately.
      if (results.length > 0) {
        remoteSearchCache.set(cacheKey, { expiresAt: Date.now() + REMOTE_SEARCH_CACHE_TTL_MS, results });
        if (remoteSearchCache.size > REMOTE_SEARCH_CACHE_MAX) {
          const oldestKey = remoteSearchCache.keys().next().value as string | undefined;
          if (oldestKey) remoteSearchCache.delete(oldestKey);
        }
      }
      return results;
    })
    .finally(() => remoteSearchInflight.delete(cacheKey));
  remoteSearchInflight.set(cacheKey, search);
  return search;
}

const REMOTE_SEARCH_CACHE_TTL_MS = 10 * 60 * 1000;
const REMOTE_SEARCH_CACHE_MAX = 500;
const remoteSearchCache = new Map<string, { expiresAt: number; results: RemoteSearchItem[] }>();
const remoteSearchInflight = new Map<string, Promise<RemoteSearchItem[]>>();

async function runParallelProviderSearch(
  query: string,
  options: { svetserialuCredentials?: SvetSerialuCredentials | null },
) {
  // Public provider pages regularly need more than 3.5 seconds even when they
  // are healthy. The old budget returned and cached an empty result while the
  // successful provider request was still in flight.
  const timeoutMs = Number.parseInt(process.env.SPILLED_COMMAND_SEARCH_TIMEOUT_MS || "20000", 10);
  const bombujTimeoutMs = Number.parseInt(process.env.SPILLED_BOMBUJ_SEARCH_TIMEOUT_MS || "20000", 10);
  const withSearchBudget = async <T>(search: Promise<T[]>, budgetMs = timeoutMs) => {
    let timeout: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        search,
        new Promise<T[]>((resolve) => {
          timeout = setTimeout(() => resolve([]), Number.isFinite(budgetMs) && budgetMs > 0 ? budgetMs : 850);
        }),
      ]);
    } finally {
      if (timeout) clearTimeout(timeout);
    }
  };

  // Start every provider immediately. Search used to await VidKing before even
  // starting the other providers, turning one deadline into two sequential waits.
  // Providers receive the weak-word-trimmed query so "the friends show" searches
  // for "friends" instead of raw phrasing, while ranking still uses the full
  // query for relevance.
  const providerQuery = trimWeakSearchEdges(query);
  const [vidking, svet, bomb] = await Promise.allSettled([
    withSearchBudget(searchVidking(providerQuery)),
    withSearchBudget(searchSvetSerialu(providerQuery, options.svetserialuCredentials)),
    withSearchBudget(searchBombuj(providerQuery), bombujTimeoutMs),
  ]);
  const merged = [
    ...(vidking.status === "fulfilled" ? vidking.value : []),
    ...(svet.status === "fulfilled" ? svet.value : []),
    ...(bomb.status === "fulfilled" ? bomb.value : []),
  ]
    .filter((item) => hasProviderSearchTokenCoverage(query, item))
    .map<RemoteSearchItem>((item, index) => ({
      ...item,
      matchScore: Math.max(
        typeof item.matchScore === "number" ? item.matchScore : 0,
        scoreSearchCandidate(query, [item.title, item.slug, item.year], index),
      ),
    }));

  // Apply confidence pruning inside each provider. A perfect match from one
  // catalog must not erase a valid, playable match from another catalog.
  const byProvider = new Map<string, RemoteSearchItem[]>();
  for (const item of merged) {
    const provider = item.provider ?? item.platform ?? "unknown";
    const group = byProvider.get(provider) ?? [];
    group.push(item);
    byProvider.set(provider, group);
  }

  const unique = new Map<string, RemoteSearchItem>();
  for (const [provider, items] of byProvider) {
    for (const item of keepHighConfidenceSearchResults(items).slice(0, 12)) {
      const key = `${provider}:${item.importSlug ?? item.slug}`;
      if (!unique.has(key)) unique.set(key, item);
    }
  }

  // Rank the per-provider survivors, then re-attach cross-provider matches for
  // the top titles so the dashboard can group every available source behind one
  // result card. Without this, a title that is present on several providers can
  // drop below the unified cut and show only a single source.
  const ranked = sortUnifiedSearchResults(query, [...unique.values()]);
  const top = ranked.slice(0, 30);
  const kept = new Set(top);
  for (const item of merged) {
    if (top.length >= 48) break;
    if (kept.has(item)) continue;
    if (top.some((entry) => sameRemoteSearchIdentity(entry, item))) {
      top.push(item);
      kept.add(item);
    }
  }
  return sortUnifiedSearchResults(query, top).slice(0, 48);
}

type RemoteSearchItem = {
  title: string;
  slug: string;
  importSlug?: string;
  provider?: string;
  platform?: string;
  mediaType?: "movie" | "serial";
  year?: string | null;
  yearLabel?: string | null;
  alternateTitles?: string[];
  matchScore?: number;
  searchSignals?: {
    popularity?: number | null;
    voteCount?: number | null;
    voteAverage?: number | null;
    releaseDate?: string | null;
    originalLanguage?: string | null;
  };
};

function normalizeBridgeText(value: string | null | undefined) {
  return String(value ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function remoteSearchTitleKeys(item: RemoteSearchItem) {
  return [item.title, ...(item.alternateTitles ?? [])]
    .map(normalizeBridgeText)
    .filter(Boolean);
}

function parseRemoteSearchYear(value: string | null | undefined) {
  const match = value?.match(/\b(19|20)\d{2}\b/);
  return match ? Number.parseInt(match[0], 10) : null;
}

function sameRemoteSearchIdentity(left: RemoteSearchItem, right: RemoteSearchItem) {
  const leftMedia = left.mediaType ?? "movie";
  const rightMedia = right.mediaType ?? "movie";
  if (leftMedia !== rightMedia) {
    return false;
  }

  const leftYear = parseRemoteSearchYear(left.year);
  const rightYear = parseRemoteSearchYear(right.year);
  if (leftYear !== null && rightYear !== null && Math.abs(leftYear - rightYear) > 1) {
    return false;
  }

  const rightKeys = new Set(remoteSearchTitleKeys(right));
  return remoteSearchTitleKeys(left).some((key) => rightKeys.has(key));
}

export function hasProviderSearchTokenCoverage(
  query: string,
  item: Pick<RemoteSearchItem, "title" | "slug" | "alternateTitles">,
) {
  return hasRequiredSearchTokenCoverage(query, [
    item.title,
    item.slug,
    ...(item.alternateTitles ?? []),
  ]);
}

export async function verifySvetSerialuCredentials(credentials?: SvetSerialuCredentials | null) {
  return verifySvetSerialuLogin(credentials);
}

export async function importShow(
  source: "svetserialu" | "bombuj",
  slug: string,
  _mediaType?: "movie" | "serial",
  options: { svetserialuCredentials?: SvetSerialuCredentials | null } = {},
) {
  const show = source === "bombuj"
    ? await fetchBombujMovie(slug)
    : await fetchSvetSerialuShow(slug, options.svetserialuCredentials);
  await runtime.persistImportedShow(show.slug, show.title, show);
  return show;
}

export async function importProviderItem(input: Parameters<typeof importProviderModuleItem>[0]) {
  const show = await importProviderModuleItem(input);
  await runtime.persistImportedShow(show.slug, show.title, show);
  return show;
}

export async function refreshArtwork(input: Parameters<typeof enrichArtwork>[0]) {
  return enrichArtwork(input);
}

export async function searchArtwork(input: Parameters<typeof searchArtworkAssets>[0]) {
  return searchArtworkAssets(input);
}

export async function loadExploreFeed(input: Parameters<typeof getExploreFeed>[0]) {
  return getExploreFeed(input);
}

export async function loadTrendingFeed(input: Parameters<typeof getTrendingFeed>[0]) {
  return getTrendingFeed(input);
}

export async function loadProviderModules() {
  return loadProviderModulesFromControlPlane();
}

export async function loadProviderFeedItems(input: Parameters<typeof loadProviderFeed>[0]) {
  return loadProviderFeed(input);
}

export async function searchProviderModuleItems(input: Parameters<typeof searchProviderModule>[0]) {
  return searchProviderModule(input);
}

export async function loadIntegrationCatalog(input: Parameters<typeof listIntegrationCatalog>[0]) {
  return listIntegrationCatalog(input);
}

export async function searchTitleItems(input: Parameters<typeof searchTitles>[0]) {
  return searchTitles(input);
}

export async function checkVidkingAvailabilityItems(input: Parameters<typeof checkVidkingAvailabilityBatch>[0]) {
  return checkVidkingAvailabilityBatch(input);
}

export async function resolveTitleItem(input: Parameters<typeof resolveTitle>[0]) {
  return resolveTitle(input);
}

export async function importTitleItem(input: Parameters<typeof importResolvedTitle>[0]) {
  const result = await importResolvedTitle(input);
  await runtime.persistImportedShow(result.show.slug, result.show.title, result.show);
  return result;
}

export async function startDownload(input: Parameters<typeof createFullDownloadJob>[0]) {
  return createFullDownloadJob(input);
}

export function getDownloadStatus(jobId: string) {
  return getFullDownloadJob(jobId);
}

export async function cancelDownload(episodeId: string) {
  return cancelFullDownloadJob(episodeId);
}

export async function deleteDownload(episodeId: string) {
  await deleteEpisodeDownload(episodeId);
}

function hashFile(filePath: string) {
  return new Promise<string>((resolvePromise, rejectPromise) => {
    const hash = createHash("sha256");
    const stream = createReadStream(filePath);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("error", rejectPromise);
    stream.on("end", () => resolvePromise(hash.digest("hex")));
  });
}

async function publishSpillshareFile(input: {
  nodeId: string;
  filePath: string;
  fileName?: string;
}) {
  const fileInfo = await stat(input.filePath);
  if (!fileInfo.isFile() || fileInfo.size <= 0) {
    return null;
  }

  const fileName = input.fileName ?? basename(input.filePath);
  const fileSha256 = await hashFile(input.filePath);
  return await runtime.publishSpillshareSource({
    contentId: fileSha256,
    nodeId: input.nodeId,
    fileName,
    manifestId: `manifest_${fileSha256.slice(0, 16)}`,
    size: fileInfo.size,
    mimeType: "video/mp4",
    sha256: fileSha256,
  });
}

export async function listDownloads() {
  const episodeIds = await listDownloadedEpisodeIds();
  const files = await getDownloadedEpisodes();
  await runtime.updateDownloadInventory(episodeIds, files);

  const nodeId = (await runtime.getNodeRecord()).nodeId;
  const publishedPaths = new Set<string>();
  for (const episodeId of episodeIds) {
    const filePath = await findEpisodeDownloadFast(episodeId);
    if (!filePath || publishedPaths.has(filePath)) {
      continue;
    }
    try {
      await publishSpillshareFile({ nodeId, filePath });
      publishedPaths.add(filePath);
    } catch (error) {
      console.warn("[spillshare] failed to publish episode source", {
        episodeId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  for (const fileName of files) {
    const filePath = await findEpisodeDownloadByFileNameFast(fileName);
    if (!filePath || publishedPaths.has(filePath)) {
      continue;
    }
    try {
      await publishSpillshareFile({ nodeId, filePath, fileName });
      publishedPaths.add(filePath);
    } catch (error) {
      const fallbackId = sha256(fileName);
      await runtime.publishSpillshareSource({
        contentId: fallbackId,
        nodeId,
        fileName,
        manifestId: `manifest_${fallbackId.slice(0, 16)}`,
        size: 0,
        mimeType: "video/mp4",
      });
    }
  }

  return { episodeIds, files };
}

export async function checkDownload(episodeId: string) {
  const filePath = await findEpisodeDownloadFast(episodeId);
  return {
    downloaded: Boolean(filePath),
    filePath,
  };
}

export async function resolveBrowserDownloadViaNode(input: Parameters<typeof resolveBrowserDownload>[0]) {
  return resolveBrowserDownload(input);
}

export async function resolveCleanPlaybackViaNode(input: Parameters<typeof resolveBrowserDownload>[0]) {
  return resolveBrowserDownload(input);
}

export async function resolvePlaybackViaNode(input: Parameters<typeof resolvePlaybackStream>[0]) {
  return resolvePlaybackStream(input);
}

export async function getDownloadedSubtitleList(episodeId: string) {
  return getDownloadedSubtitles(episodeId);
}
