import { Buffer } from "node:buffer";
import { createReadStream } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import { Readable } from "node:stream";
import type { SpillshareSource } from "../../../packages/node-protocol/src";
import {
  cancelDownload,
  checkDownload,
  deleteDownload,
  getDownloadedSubtitleList,
  getDownloadStatus,
  loadExploreFeed,
  loadTrendingFeed,
  getNodeRuntime,
  getNodeStatus,
  importShow,
  listDownloads,
  refreshArtwork,
  resolveBrowserDownloadViaNode,
  searchArtwork,
  searchNode,
  startDownload,
} from "../../../packages/node-client/src/index";
import { resolvePlayerEmbedUrl, shouldResolvePlayerUrl } from "./player-resolver";
import { searchPeopleSuggestions } from "../../dashboard/src/server/artwork";
import {
  ensureSeekableDownloadFile,
  findEpisodeDownloadByFileNameFast,
  findEpisodeDownloadFast,
  findSubtitleFilePath,
} from "../../dashboard/src/server/full-download";

const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

export type JsonResponse = {
  statusCode: number;
  headersSent?: boolean;
  setHeader: (name: string, value: string) => void;
  end: (body?: string) => void;
};

export type RequestLike = NodeJS.ReadableStream & {
  method?: string;
  url?: string;
  headers?: Record<string, string | string[] | undefined>;
};

async function readJsonBody<T>(req: NodeJS.ReadableStream) {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8")) as T;
}

function sendJson(res: JsonResponse, statusCode: number, payload: unknown) {
  res.statusCode = statusCode;
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify(payload));
}

function getQueryParams(url = "") {
  const query = url.includes("?") ? url.slice(url.indexOf("?") + 1) : "";
  return new URLSearchParams(query);
}

function getSafeFileName(input: string | null) {
  const cleaned = String(input || "download.mp4")
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 150);
  if (!cleaned) {
    return "download.mp4";
  }
  return /\.[a-z0-9]{2,5}$/i.test(cleaned) ? cleaned : `${cleaned}.mp4`;
}

function parseYearHint(value: string | null | undefined) {
  const match = value?.match(/\b(19|20)\d{2}\b/);
  return match?.[0] ?? undefined;
}

export function createHttpHandlers() {
  const runtime = getNodeRuntime();
  
  console.log(`[INIT] Server initialized. Vault path: ${process.env.SPILLED_VAULT_PATH || "NOT SET"}`);

  const statusHandler = async (_req: RequestLike, res: JsonResponse) => {
    sendJson(res, 200, await getNodeStatus());
  };

  const importSvetSerialuHandler = async (req: RequestLike, res: JsonResponse) => {
    if (req.method !== "POST") return sendJson(res, 405, { error: "Method not allowed." });
    try {
      const body = await readJsonBody<{ slug?: string }>(req);
      const slug = body.slug?.trim().toLowerCase();
      if (!slug || !/^[a-z0-9-]+$/.test(slug)) return sendJson(res, 400, { error: "Provide a valid show slug." });
      sendJson(res, 200, { show: await importShow("svetserialu", slug) });
    } catch (error) {
      sendJson(res, 500, { error: error instanceof Error ? error.message : "Failed to import show." });
    }
  };

  const importBombujHandler = async (req: RequestLike, res: JsonResponse) => {
    if (req.method !== "POST") return sendJson(res, 405, { error: "Method not allowed." });
    try {
      const body = await readJsonBody<{ slug?: string; mediaType?: "movie" | "serial" }>(req);
      const slug = body.slug?.trim().toLowerCase();
      if (!slug || !/^[a-z0-9-]+$/.test(slug)) return sendJson(res, 400, { error: "Provide a valid movie slug." });
      sendJson(res, 200, { show: await importShow("bombuj", slug, body.mediaType) });
    } catch (error) {
      sendJson(res, 500, { error: error instanceof Error ? error.message : "Failed to import movie from bombuj.si." });
    }
  };

  const searchHandler = async (req: RequestLike, res: JsonResponse) => {
    if (req.method !== "POST") return sendJson(res, 405, { error: "Method not allowed." });
    try {
      const body = await readJsonBody<{ query?: string }>(req);
      const query = body.query?.trim() ?? "";
      sendJson(res, 200, { results: query ? await searchNode(query) : [] });
    } catch (error) {
      sendJson(res, 500, { error: error instanceof Error ? error.message : "Failed to search." });
    }
  };

  const refreshArtworkHandler = async (req: RequestLike, res: JsonResponse) => {
    if (req.method !== "POST") return sendJson(res, 405, { error: "Method not allowed." });
    try {
      const body = await readJsonBody<{
        title: string;
        altTitle?: string | null;
        years?: string | null;
        yearHint?: string | null;
        description?: string | null;
        mediaType: "movie" | "tv";
        posterUrl?: string | null;
        backdropUrl?: string | null;
        clearLogoUrl?: string | null;
        artworkSources?: { tmdb?: boolean; fanart?: boolean; tvdb?: boolean };
      }>(req);
      sendJson(res, 200, {
        artwork: await refreshArtwork({
          mediaType: body.mediaType,
          title: body.title,
          altTitle: body.altTitle ?? null,
          yearHint: body.yearHint ?? parseYearHint(body.years),
          description: body.description ?? null,
          currentPosterUrl: body.posterUrl ?? null,
          currentBackdropUrl: body.backdropUrl ?? null,
          currentClearLogoUrl: body.clearLogoUrl ?? null,
          sources: body.artworkSources,
        }),
      });
    } catch (error) {
      sendJson(res, 500, { error: error instanceof Error ? error.message : "Failed to refresh artwork." });
    }
  };

  const searchArtworkHandler = async (req: RequestLike, res: JsonResponse) => {
    if (req.method !== "POST") return sendJson(res, 405, { error: "Method not allowed." });
    try {
      const body = await readJsonBody<{
        title: string;
        altTitle?: string | null;
        years?: string | null;
        yearHint?: string | null;
        description?: string | null;
        mediaType: "movie" | "tv";
        artworkSources?: { tmdb?: boolean; fanart?: boolean; tvdb?: boolean };
      }>(req);
      sendJson(res, 200, {
        assets: await searchArtwork({
          mediaType: body.mediaType,
          title: body.title,
          altTitle: body.altTitle ?? null,
          yearHint: body.yearHint ?? parseYearHint(body.years),
          description: body.description ?? null,
          sources: body.artworkSources,
        }),
      });
    } catch (error) {
      sendJson(res, 500, { error: error instanceof Error ? error.message : "Failed to search artwork." });
    }
  };

  const exploreFeedHandler = async (req: RequestLike, res: JsonResponse) => {
    if (req.method !== "POST") return sendJson(res, 405, { error: "Method not allowed." });
    try {
      sendJson(res, 200, await loadExploreFeed(await readJsonBody(req)));
    } catch (error) {
      sendJson(res, 500, { error: error instanceof Error ? error.message : "Failed to load Explore feed." });
    }
  };

  const explorePeopleHandler = async (req: RequestLike, res: JsonResponse) => {
    if (req.method !== "POST") return sendJson(res, 405, { error: "Method not allowed." });
    try {
      const body = await readJsonBody<{ query?: string; role?: "actor" | "director" | "any"; limit?: number }>(req);
      sendJson(res, 200, {
        suggestions: await searchPeopleSuggestions({
          query: body.query?.trim() ?? "",
          role: body.role ?? "any",
          limit: body.limit ?? 8,
        }),
      });
    } catch (error) {
      sendJson(res, 500, { error: error instanceof Error ? error.message : "Failed to load people suggestions." });
    }
  };

  const trendingFeedHandler = async (req: RequestLike, res: JsonResponse) => {
    if (req.method !== "POST") return sendJson(res, 405, { error: "Method not allowed." });
    try {
      sendJson(res, 200, await loadTrendingFeed(await readJsonBody(req)));
    } catch (error) {
      sendJson(res, 500, { error: error instanceof Error ? error.message : "Failed to load Trending feed." });
    }
  };

  const startDownloadHandler = async (req: RequestLike, res: JsonResponse) => {
    if (req.method !== "POST") return sendJson(res, 405, { error: "Method not allowed." });
    try {
      sendJson(res, 200, { job: await startDownload(await readJsonBody(req)) });
    } catch (error) {
      sendJson(res, 500, { error: error instanceof Error ? error.message : "Failed to start download." });
    }
  };

  const browserStartHandler = async (req: RequestLike, res: JsonResponse) => {
    if (req.method !== "POST") return sendJson(res, 405, { error: "Method not allowed." });
    try {
      sendJson(res, 200, await resolveBrowserDownloadViaNode(await readJsonBody(req)));
    } catch (error) {
      sendJson(res, 422, { error: error instanceof Error ? error.message : "Failed to resolve browser download." });
    }
  };

  const playerResolveHandler = async (req: RequestLike, res: JsonResponse) => {
    if (req.method !== "POST") return sendJson(res, 405, { error: "Method not allowed." });
    try {
      const body = await readJsonBody<{ embedUrl?: string; provider?: string }>(req);
      const embedUrl = body.embedUrl?.trim();
      if (!embedUrl) {
        return sendJson(res, 400, { error: "Missing embedUrl." });
      }

      if (!shouldResolvePlayerUrl(body.provider, embedUrl)) {
        return sendJson(res, 200, {
          embedUrl,
          resolved: false,
        });
      }

      const resolvedUrl = await resolvePlayerEmbedUrl({
        embedUrl,
        provider: body.provider,
      });

      return sendJson(res, 200, {
        embedUrl: resolvedUrl,
        resolved: resolvedUrl !== embedUrl,
      });
    } catch (error) {
      return sendJson(res, 422, {
        error: error instanceof Error ? error.message : "Failed to resolve player URL.",
      });
    }
  };

  const browserFileHandler = async (req: RequestLike, res: JsonResponse) => {
    if (req.method !== "GET" && req.method !== "HEAD") return sendJson(res, 405, { error: "Method not allowed." });
    try {
      const params = getQueryParams(req.url);
      const streamUrl = params.get("url");
      const fileName = getSafeFileName(params.get("name"));
      const referer = params.get("referer") || undefined;
      if (!streamUrl) return sendJson(res, 400, { error: "Missing stream URL." });

      const parsed = new URL(streamUrl);
      if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
        return sendJson(res, 400, { error: "Unsupported stream URL protocol." });
      }

      const upstream = await fetch(parsed.toString(), {
        method: req.method,
        headers: {
          "user-agent": USER_AGENT,
          accept: "*/*",
          ...(referer ? { referer } : {}),
          ...(typeof req.headers?.range === "string" ? { range: req.headers.range } : {}),
        },
        redirect: "follow",
      });

      if (!upstream.ok && upstream.status !== 206) {
        const detail = await upstream.text().catch(() => "");
        return sendJson(res, upstream.status || 502, {
          error: `Upstream stream request failed (${upstream.status}).`,
          detail: detail.slice(0, 300),
        });
      }

      res.statusCode = upstream.status;
      res.setHeader("Content-Type", upstream.headers.get("content-type") || "application/octet-stream");
      res.setHeader("Accept-Ranges", upstream.headers.get("accept-ranges") || "bytes");
      res.setHeader("Cache-Control", "no-store");
      res.setHeader("Content-Disposition", `attachment; filename*=UTF-8''${encodeURIComponent(fileName)}`);
      const contentLength = upstream.headers.get("content-length");
      const contentRange = upstream.headers.get("content-range");
      if (contentLength) res.setHeader("Content-Length", contentLength);
      if (contentRange) res.setHeader("Content-Range", contentRange);
      if (req.method === "HEAD" || !upstream.body) return res.end();
      Readable.fromWeb(upstream.body as ReadableStream).pipe(res as never);
    } catch (error) {
      sendJson(res, 500, { error: error instanceof Error ? error.message : "Failed to proxy download." });
    }
  };

  const downloadStatusHandler = async (req: RequestLike, res: JsonResponse) => {
    if (req.method !== "GET") return sendJson(res, 405, { error: "Method not allowed." });
    const jobId = getQueryParams(req.url).get("jobId");
    if (!jobId) return sendJson(res, 400, { error: "Missing jobId." });
    const job = getDownloadStatus(jobId);
    if (!job) return sendJson(res, 404, { error: "Job not found." });
    sendJson(res, 200, { job });
  };

  const downloadCheckHandler = async (req: RequestLike, res: JsonResponse) => {
    if (req.method !== "GET") return sendJson(res, 405, { error: "Method not allowed." });
    const episodeId = getQueryParams(req.url).get("episodeId");
    if (!episodeId) return sendJson(res, 400, { error: "Missing episodeId." });
    sendJson(res, 200, await checkDownload(episodeId));
  };

  const downloadListHandler = async (req: RequestLike, res: JsonResponse) => {
    if (req.method !== "GET") return sendJson(res, 405, { error: "Method not allowed." });
    sendJson(res, 200, await listDownloads());
  };

  const deleteDownloadHandler = async (req: RequestLike, res: JsonResponse) => {
    if (req.method !== "POST") return sendJson(res, 405, { error: "Method not allowed." });
    try {
      const body = await readJsonBody<{ episodeId?: string }>(req);
      if (!body.episodeId) return sendJson(res, 400, { error: "Missing episodeId." });
      await deleteDownload(body.episodeId);
      sendJson(res, 200, { deleted: true });
    } catch (error) {
      sendJson(res, 500, { error: error instanceof Error ? error.message : "Failed to delete download." });
    }
  };

  const cancelDownloadHandler = async (req: RequestLike, res: JsonResponse) => {
    if (req.method !== "POST") return sendJson(res, 405, { error: "Method not allowed." });
    try {
      const body = await readJsonBody<{ episodeId?: string }>(req);
      if (!body.episodeId) return sendJson(res, 400, { error: "Missing episodeId." });
      sendJson(res, 200, { canceled: true, job: await cancelDownload(body.episodeId) });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to cancel download.";
      sendJson(res, /no active download/i.test(message) ? 404 : 500, { error: message });
    }
  };

  const downloadFileHandler = async (req: RequestLike, res: JsonResponse) => {
    if (req.method !== "GET" && req.method !== "HEAD") return sendJson(res, 405, { error: "Method not allowed." });
    try {
      const params = getQueryParams(req.url);
      const episodeId = params.get("episodeId");
      const fileName = params.get("file");
      if (!episodeId) return sendJson(res, 400, { error: "Missing episodeId." });

      console.log(`[SERVE] Serving episode ${episodeId} (file: ${fileName || "any"})`);

      let filePath = fileName ? await findEpisodeDownloadByFileNameFast(fileName) : null;
      if (!filePath) filePath = await findEpisodeDownloadFast(episodeId);
      if (!filePath) {
        console.warn(`[SERVE] File not found for episode ${episodeId}`);
        return sendJson(res, 404, { error: "Downloaded file not found." });
      }

      console.log(`[SERVE] Found file: ${filePath}`);

      const isHead = req.method === "HEAD";
      const rangeHeader = typeof req.headers?.range === "string" ? req.headers.range : undefined;
      
      // We always want to ensure it's seekable (faststart) for browser playback.
      // ensureSeekableDownloadFile now handles concurrency and is fast if already repaired.
      const seekablePath = await ensureSeekableDownloadFile(episodeId, filePath);
      
      const fileInfo = await stat(seekablePath);
      const fileSize = fileInfo.size;

      res.setHeader("Accept-Ranges", "bytes");
      res.setHeader("Content-Type", "video/mp4");
      res.setHeader("Cache-Control", "no-store");

      if (rangeHeader) {
        const rangeMatch = rangeHeader.match(/bytes=(\d*)-(\d*)/i);
        if (!rangeMatch) {
          res.statusCode = 416;
          res.setHeader("Content-Range", `bytes */${fileSize}`);
          return res.end();
        }

        let start: number;
        let end: number;
        if (rangeMatch[1] && rangeMatch[2]) {
          start = Number.parseInt(rangeMatch[1], 10);
          end = Number.parseInt(rangeMatch[2], 10);
        } else if (rangeMatch[1]) {
          start = Number.parseInt(rangeMatch[1], 10);
          end = fileSize - 1;
        } else {
          const suffixLength = Number.parseInt(rangeMatch[2], 10);
          start = Math.max(fileSize - suffixLength, 0);
          end = fileSize - 1;
        }

        if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end >= fileSize || start > end) {
          res.statusCode = 416;
          res.setHeader("Content-Range", `bytes */${fileSize}`);
          return res.end();
        }

        res.statusCode = 206;
        res.setHeader("Content-Range", `bytes ${start}-${end}/${fileSize}`);
        res.setHeader("Content-Length", String(end - start + 1));
        if (isHead) return res.end();
        createReadStream(seekablePath, { start, end }).pipe(res as never);
        return;
      }

      res.statusCode = 200;
      res.setHeader("Content-Length", String(fileSize));
      if (isHead) return res.end();
      createReadStream(seekablePath).pipe(res as never);
    } catch (error) {
      console.error("[SERVE] Failed to serve download:", error);
      sendJson(res, 500, { error: error instanceof Error ? error.message : "Failed to serve download." });
    }
  };

  const subtitleListHandler = async (req: RequestLike, res: JsonResponse) => {
    if (req.method !== "GET") return sendJson(res, 405, { error: "Method not allowed." });
    const episodeId = getQueryParams(req.url).get("episodeId");
    if (!episodeId) return sendJson(res, 400, { error: "Missing episodeId." });
    sendJson(res, 200, { subtitles: await getDownloadedSubtitleList(episodeId) });
  };

  const subtitleFileHandler = async (req: RequestLike, res: JsonResponse) => {
    if (req.method !== "GET") return sendJson(res, 405, { error: "Method not allowed." });
    try {
      const params = getQueryParams(req.url);
      const episodeId = params.get("episodeId");
      const fileName = params.get("file");
      if (!episodeId || !fileName) return sendJson(res, 400, { error: "Missing episodeId or file." });
      const filePath = await findSubtitleFilePath(episodeId, fileName);
      if (!filePath) return sendJson(res, 404, { error: "Subtitle file not found." });
      res.statusCode = 200;
      res.setHeader("Content-Type", "text/vtt; charset=utf-8");
      res.setHeader("Cache-Control", "no-store");
      res.end(await readFile(filePath, "utf8"));
    } catch (error) {
      sendJson(res, 500, { error: error instanceof Error ? error.message : "Failed to serve subtitle." });
    }
  };

  const subtitleProxyHandler = async (req: RequestLike, res: JsonResponse) => {
    if (req.method !== "GET") return sendJson(res, 405, { error: "Method not allowed." });
    try {
      const target = getQueryParams(req.url).get("url");
      if (!target) return sendJson(res, 400, { error: "Missing subtitle url." });
      const parsed = new URL(target);
      if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return sendJson(res, 400, { error: "Unsupported protocol." });

      const response = await fetch(parsed.toString(), {
        redirect: "follow",
        headers: {
          "User-Agent": "Mozilla/5.0",
          Accept: "text/vtt,text/plain,application/json,*/*",
          Referer: "https://svetserialu.to/",
        },
      });
      if (!response.ok) return sendJson(res, response.status, { error: "Failed to fetch subtitle file." });

      const body = await response.text();
      const contentType = response.headers.get("content-type") || "text/vtt; charset=utf-8";
      res.statusCode = 200;
      res.setHeader("Content-Type", contentType.includes("text") ? contentType : "text/vtt; charset=utf-8");
      res.setHeader("Cache-Control", "no-store");
      res.end(body);
    } catch (error) {
      sendJson(res, 500, { error: error instanceof Error ? error.message : "Subtitle proxy failed." });
    }
  };

  const anonymousGrantHandler = async (req: RequestLike, res: JsonResponse) => {
    if (req.method !== "POST") return sendJson(res, 405, { error: "Method not allowed." });
    try {
      const body = await readJsonBody<{ capability?: "fetch" | "relay" | "stream" | "download" | "spillshare"; contentId?: string; action?: string }>(req);
      if (!body.capability) return sendJson(res, 400, { error: "Missing capability." });
      sendJson(res, 200, {
        grant: await runtime.createAnonymousGrant({
          capability: body.capability,
          contentId: body.contentId,
          action: body.action,
        }),
      });
    } catch (error) {
      sendJson(res, 500, { error: error instanceof Error ? error.message : "Failed to create anonymous session." });
    }
  };

  const pairingStartHandler = async (req: RequestLike, res: JsonResponse) => {
    if (req.method !== "POST") return sendJson(res, 405, { error: "Method not allowed." });
    try {
      const body = await readJsonBody<{ deviceName?: string }>(req);
      sendJson(res, 200, { pairing: await runtime.startPairing(body.deviceName?.trim() || "Dashboard Device") });
    } catch (error) {
      sendJson(res, 500, { error: error instanceof Error ? error.message : "Failed to start pairing." });
    }
  };

  const pairingApproveHandler = async (req: RequestLike, res: JsonResponse) => {
    if (req.method !== "POST") return sendJson(res, 405, { error: "Method not allowed." });
    try {
      const body = await readJsonBody<{ pairingId?: string; code?: string }>(req);
      if (!body.pairingId || !body.code) return sendJson(res, 400, { error: "Missing pairingId or code." });
      sendJson(res, 200, { approval: await runtime.approvePairing(body.pairingId, body.code) });
    } catch (error) {
      sendJson(res, 500, { error: error instanceof Error ? error.message : "Failed to approve pairing." });
    }
  };

  const privateSessionHandler = async (req: RequestLike, res: JsonResponse) => {
    if (req.method !== "POST") return sendJson(res, 405, { error: "Method not allowed." });
    try {
      const body = await readJsonBody<{ pairedDeviceId?: string; capability?: "library"; contentId?: string; action?: string }>(req);
      if (!body.pairedDeviceId || !body.capability) return sendJson(res, 400, { error: "Missing pairedDeviceId or capability." });
      sendJson(res, 200, {
        grant: await runtime.issuePrivateGrant(body.pairedDeviceId, {
          capability: body.capability,
          contentId: body.contentId,
          action: body.action,
        }),
      });
    } catch (error) {
      sendJson(res, 500, { error: error instanceof Error ? error.message : "Failed to issue private session." });
    }
  };

  const passkeyRegistrationHandler = async (_req: RequestLike, res: JsonResponse) => {
    sendJson(res, 200, { options: await runtime.getPasskeyRegistrationChallenge() });
  };

  const passkeyAuthenticationHandler = async (_req: RequestLike, res: JsonResponse) => {
    sendJson(res, 200, { options: await runtime.getPasskeyAuthenticationChallenge() });
  };

  const spillshareLookupHandler = async (req: RequestLike, res: JsonResponse) => {
    const contentId = getQueryParams(req.url).get("contentId");
    if (!contentId) return sendJson(res, 400, { error: "Missing contentId." });
    sendJson(res, 200, { sources: await runtime.findSpillshareSources(contentId) });
  };

  const meshAnnounceHandler = async (req: RequestLike, res: JsonResponse) => {
    if (req.method !== "POST") return sendJson(res, 405, { error: "Method not allowed." });
    try {
      const body = await readJsonBody<{ record?: Awaited<ReturnType<typeof runtime.getNodeRecord>>; spillshareSources?: SpillshareSource[] }>(req);
      if (!body.record) return sendJson(res, 400, { error: "Missing record." });
      await runtime.acceptRemoteNodeRecord(body.record);
      for (const source of body.spillshareSources ?? []) {
        await runtime.acceptRemoteSpillshareSource(source);
      }
      sendJson(res, 200, { accepted: true });
    } catch (error) {
      sendJson(res, 400, { error: error instanceof Error ? error.message : "Failed to accept mesh announce." });
    }
  };

  const meshSnapshotHandler = async (_req: RequestLike, res: JsonResponse) => {
    sendJson(res, 200, {
      self: await runtime.getNodeRecord(),
      records: await runtime.listKnownNodeRecords(),
      spillshareSources: await runtime.listPublishedSpillshareSources(),
    });
  };

  const meshNodesHandler = async (_req: RequestLike, res: JsonResponse) => {
    sendJson(res, 200, { records: await runtime.listKnownNodeRecords() });
  };

  return {
    runtime,
    statusHandler,
    importSvetSerialuHandler,
    importBombujHandler,
    searchHandler,
    refreshArtworkHandler,
    searchArtworkHandler,
    exploreFeedHandler,
    explorePeopleHandler,
    trendingFeedHandler,
    startDownloadHandler,
    browserStartHandler,
    playerResolveHandler,
    browserFileHandler,
    downloadStatusHandler,
    downloadCheckHandler,
    downloadListHandler,
    deleteDownloadHandler,
    cancelDownloadHandler,
    downloadFileHandler,
    subtitleListHandler,
    subtitleFileHandler,
    subtitleProxyHandler,
    anonymousGrantHandler,
    pairingStartHandler,
    pairingApproveHandler,
    privateSessionHandler,
    passkeyRegistrationHandler,
    passkeyAuthenticationHandler,
    spillshareLookupHandler,
    meshAnnounceHandler,
    meshSnapshotHandler,
    meshNodesHandler,
  };
}
