import {
  cancelFullDownloadJob,
  createFullDownloadJob,
  deleteEpisodeDownload,
  findEpisodeDownloadFast,
  getDownloadedEpisodes,
  getDownloadedSubtitles,
  getFullDownloadJob,
  listDownloadedEpisodeIds,
  resolveBrowserDownload,
} from "../../../apps/dashboard/src/server/full-download";
import { enrichArtwork, searchArtworkAssets } from "../../../apps/dashboard/src/server/artwork";
import { compareSearchScores, scoreSearchCandidate } from "../../../apps/dashboard/src/lib/search-ranking";
import { fetchBombujMovie, searchBombuj } from "../../../apps/dashboard/src/server/bombuj";
import { getExploreFeed } from "../../../apps/dashboard/src/server/explore-feed";
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

export async function getNodeStatus() {
  return runtime.getStatus();
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

export async function listDownloads() {
  const episodeIds = await listDownloadedEpisodeIds();
  const files = await getDownloadedEpisodes();
  await runtime.updateDownloadInventory(episodeIds, files);

  const nodeId = (await runtime.getNodeRecord()).nodeId;
  for (const fileName of files) {
    const contentId = sha256(fileName);
    await runtime.publishSpillshareSource({
      contentId,
      nodeId,
      fileName,
      manifestId: `manifest_${contentId.slice(0, 16)}`,
      size: 0,
      mimeType: "video/mp4",
    });
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
