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
} from "../../../apps/dashboard/src/server/full-download";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { basename } from "node:path";
import { enrichArtwork, searchArtworkAssets } from "../../../apps/dashboard/src/server/artwork";
import { compareSearchScores, scoreSearchCandidate } from "../../../apps/dashboard/src/lib/search-ranking";
import { fetchBombujMovie, searchBombuj } from "../../../apps/dashboard/src/server/bombuj";
import { getExploreFeed } from "../../../apps/dashboard/src/server/explore-feed";
import { loadProviderFeed } from "../../../apps/dashboard/src/server/provider-feed";
import { loadProviderModulesFromControlPlane } from "../../../apps/dashboard/src/server/provider-modules";
import { searchProviderModule } from "../../../apps/dashboard/src/server/provider-search";
import { searchSvetSerialu } from "../../../apps/dashboard/src/server/svetserialu";
import { getTrendingFeed } from "../../../apps/dashboard/src/server/trending-feed";
import { SpilledCinemaNodeRuntime } from "../../../apps/server/src/runtime";
import { sha256 } from "../../security/src";
// The shared importer lives in a JS module so both dashboard API routes and the node runtime use one parser.
// @ts-ignore -- runtime import is valid; this package has no local declaration for the shared JS helper.
import { fetchSvetSerialuShow } from "../../../apps/dashboard/api/_lib/svetserialu.js";

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

export function setNodeEndpointUrl(endpointUrl: string) {
  runtime.setEndpointUrl(endpointUrl);
}

export async function getNodeStatus() {
  const [status, mediaTools] = await Promise.all([runtime.getStatus(), getMediaToolStatus()]);
  return {
    ...status,
    mediaTools,
  };
}

export async function searchNode(query: string) {
  const [svet, bomb] = await Promise.allSettled([searchSvetSerialu(query), searchBombuj(query)]);
  const merged = [
    ...(svet.status === "fulfilled" ? svet.value : []),
    ...(bomb.status === "fulfilled" ? bomb.value : []),
  ].map((item, index) => ({
    ...item,
    matchScore: Math.max(
      typeof item.matchScore === "number" ? item.matchScore : 0,
      scoreSearchCandidate(query, [item.title, item.slug, item.year], index),
    ),
  }));

  return merged.sort(compareSearchScores);
}

export async function importShow(source: "svetserialu" | "bombuj", slug: string, _mediaType?: "movie" | "serial") {
  const show = source === "bombuj"
    ? await fetchBombujMovie(slug)
    : await fetchSvetSerialuShow(slug);
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

export async function getDownloadedSubtitleList(episodeId: string) {
  return getDownloadedSubtitles(episodeId);
}
