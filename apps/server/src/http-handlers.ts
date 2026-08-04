import { Buffer } from "node:buffer";
import { lookup } from "node:dns/promises";
import { createReadStream } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import { isIP } from "node:net";
import { Readable } from "node:stream";
import type { ReadableStream as NodeReadableStream } from "node:stream/web";
import type { SpillshareSource } from "../../../packages/node-protocol/src";
import {
  cancelDownload,
  checkDownload,
  deleteDownload,
  getDownloadedSubtitleList,
  getDownloadStatus,
  loadExploreFeed,
  loadProviderFeedItems,
  loadProviderModules,
  loadTrendingFeed,
  getNodeRuntime,
  getNodeStatus,
  importShow,
  importProviderItem,
  importTitleItem,
  listDownloads,
  loadIntegrationCatalog,
  checkVidkingAvailabilityItems,
  refreshArtwork,
  resolveTitleItem,
  resolveBrowserDownloadViaNode,
  resolveCleanPlaybackViaNode,
  resolvePlaybackViaNode,
  searchArtwork,
  searchNode,
  searchProviderModuleItems,
  searchTitleItems,
  startDownload,
  verifySvetSerialuCredentials,
} from "../../../packages/node-client/src/index";
import type { ImportedShow, ResolvedTitle } from "../../dashboard/src/lib/types";
import type { SvetSerialuCredentials } from "../../dashboard/src/server/svetserialu";
import { resolvePlayerEmbedUrl, shouldResolvePlayerUrl } from "./player-resolver";
import { composeHomepageBanner, fetchTmdbCast, fetchTmdbPersonCredits, fetchTmdbTitleMetadata, searchPeopleSuggestions } from "../../dashboard/src/server/artwork";
import { resolveArtworkApiKeys } from "../../dashboard/src/server/shared-artwork-api-keys";
import {
  findEpisodeDownloadByFileNameFast,
  findEpisodeDownloadFast,
  findSubtitleFilePath,
} from "../../dashboard/src/server/full-download";

const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";
const RATE_LIMITS = new Map<string, { count: number; resetAt: number }>();
const DEFAULT_PROVIDER_REPOSITORY_URL = "https://github.com/kao-offline/spilled-connectors";

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

async function readLocalEnvValue(name: string) {
  if (process.env[name]?.trim()) {
    return process.env[name]!.trim();
  }

  for (const file of [".env.local", "apps/dashboard/.env.local"]) {
    try {
      const content = await readFile(file, "utf8");
      const line = content.split(/\r?\n/).find((entry) => entry.trimStart().startsWith(`${name}=`));
      const value = line?.slice(line.indexOf("=") + 1).trim().replace(/^["']|["']$/g, "");
      if (value) {
        return value;
      }
    } catch {
      // Try the next env file.
    }
  }

  return "";
}

function getBearerToken(req: RequestLike) {
  const raw = req.headers?.authorization;
  const value = Array.isArray(raw) ? raw[0] : raw;
  const match = value?.match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim();
}

function getRequestOrigin(req: RequestLike) {
  const origin = req.headers?.origin;
  if (typeof origin === "string" && /^https?:\/\//i.test(origin)) {
    return origin;
  }
  const forwardedProto = Array.isArray(req.headers?.["x-forwarded-proto"]) ? req.headers?.["x-forwarded-proto"][0] : req.headers?.["x-forwarded-proto"];
  const host = Array.isArray(req.headers?.host) ? req.headers?.host[0] : req.headers?.host;
  return `${forwardedProto || "http"}://${host || "127.0.0.1"}`;
}

function getRequestAddress(req: RequestLike) {
  const forwardedFor = req.headers?.["x-forwarded-for"];
  const value = Array.isArray(forwardedFor) ? forwardedFor[0] : forwardedFor;
  return value?.split(",")[0]?.trim() || "local";
}

function checkRateLimit(req: RequestLike, action: string, limit = 8, windowMs = 10 * 60 * 1000) {
  const now = Date.now();
  const key = `${action}:${getRequestAddress(req)}`;
  const existing = RATE_LIMITS.get(key);
  if (!existing || existing.resetAt <= now) {
    RATE_LIMITS.set(key, { count: 1, resetAt: now + windowMs });
    return true;
  }
  if (existing.count >= limit) {
    return false;
  }
  existing.count += 1;
  return true;
}

function getQueryParams(url = "") {
  const query = url.includes("?") ? url.slice(url.indexOf("?") + 1) : "";
  return new URLSearchParams(query);
}

function getRepositoryUrlsOrDefault(urls: unknown) {
  return Array.isArray(urls) && urls.length > 0 ? urls.filter((url): url is string => typeof url === "string") : [DEFAULT_PROVIDER_REPOSITORY_URL];
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

type ArtworkSourcesInput = { tmdb?: boolean; fanart?: boolean; tvdb?: boolean };
type ArtworkApiKeysInput = { tmdbApiKey?: string; fanartApiKey?: string; tvdbApiKey?: string };
type ArtworkMediaType = "movie" | "tv";
type ArtworkBundle = {
  posterUrl?: string | null;
  backdropUrl?: string | null;
  bannerUrl?: string | null;
  clearLogoUrl?: string | null;
};

function inferArtworkMediaType(show: ImportedShow): ArtworkMediaType {
  return show.mediaType === "movie" || (show.episodes.length === 1 && show.episodes[0]?.episodeCode === "movie")
    ? "movie"
    : "tv";
}

function shouldRepairArtworkIdentity(show: ImportedShow) {
  return show.episodes.length === 1 && show.mediaType !== "movie";
}

function alternateArtworkMediaType(mediaType: ArtworkMediaType): ArtworkMediaType {
  return mediaType === "movie" ? "tv" : "movie";
}

function scoreArtworkBundle(artwork: ArtworkBundle, show: ImportedShow) {
  let score = 0;
  if (artwork.posterUrl && artwork.posterUrl !== show.posterUrl) score += 1;
  if (artwork.backdropUrl && artwork.backdropUrl !== show.backdropUrl) score += 1;
  if (artwork.bannerUrl && artwork.bannerUrl !== show.bannerUrl) score += 1;
  if (artwork.clearLogoUrl && artwork.clearLogoUrl !== show.clearLogoUrl) score += 1;
  return score;
}

async function refreshArtworkForImportedShow(input: {
  show: ImportedShow;
  sources?: ArtworkSourcesInput;
  apiKeys?: ArtworkApiKeysInput;
}) {
  const requestArtwork = (mediaType: ArtworkMediaType) => refreshArtwork({
    mediaType,
    title: input.show.title,
    altTitle: input.show.altTitle ?? null,
    yearHint: parseYearHint(input.show.years),
    description: input.show.description ?? null,
    currentPosterUrl: input.show.posterUrl ?? null,
    currentBackdropUrl: input.show.backdropUrl ?? null,
    currentBannerUrl: input.show.bannerUrl ?? null,
    currentClearLogoUrl: input.show.clearLogoUrl ?? null,
    externalIds: input.show.externalIds,
    sources: input.sources,
    apiKeys: input.apiKeys,
  });

  const primaryMediaType = inferArtworkMediaType(input.show);
  const primaryArtwork = await requestArtwork(primaryMediaType);
  let artwork = primaryArtwork;

  if (shouldRepairArtworkIdentity(input.show)) {
    const alternateArtwork = await requestArtwork(alternateArtworkMediaType(primaryMediaType));
    artwork = scoreArtworkBundle(alternateArtwork, input.show) > scoreArtworkBundle(primaryArtwork, input.show)
      ? alternateArtwork
      : primaryArtwork;
  }

  return {
    ...input.show,
    posterUrl: artwork.posterUrl ?? input.show.posterUrl ?? null,
    backdropUrl: artwork.backdropUrl ?? input.show.backdropUrl ?? null,
    bannerUrl: artwork.bannerUrl ?? input.show.bannerUrl ?? null,
    clearLogoUrl: artwork.clearLogoUrl ?? input.show.clearLogoUrl ?? null,
  };
}

async function enrichAndPersistImportedShow(input: {
  show: ImportedShow;
  sources?: ArtworkSourcesInput;
  apiKeys?: ArtworkApiKeysInput;
}) {
  try {
    const show = await refreshArtworkForImportedShow(input);
    await getNodeRuntime().persistImportedShow(show.slug, show.title, show);
    return show;
  } catch {
    return input.show;
  }
}

export function resolveDownloadByteRange(fileSize: number, rangeHeader: string | undefined) {
  if (!rangeHeader) {
    return {
      statusCode: 200,
      start: 0,
      end: fileSize - 1,
      contentLength: fileSize,
      contentRange: null,
    };
  }

  const rangeMatch = rangeHeader.match(/bytes=(\d*)-(\d*)/i);
  if (!rangeMatch) {
    return null;
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
    return null;
  }

  return {
    statusCode: 206,
    start,
    end,
    contentLength: end - start + 1,
    contentRange: `bytes ${start}-${end}/${fileSize}`,
  };
}

export function getUpstreamAcceptRanges(headers: Pick<Headers, "get">) {
  return headers.get("accept-ranges");
}

function isBlockedIpAddress(address: string) {
  const version = isIP(address);
  if (version === 4) {
    const octets = address.split(".").map((part) => Number.parseInt(part, 10));
    const [first, second] = octets;
    return (
      first === 0 ||
      first === 10 ||
      first === 127 ||
      first >= 224 ||
      (first === 100 && second >= 64 && second <= 127) ||
      (first === 169 && second === 254) ||
      (first === 172 && second >= 16 && second <= 31) ||
      (first === 192 && second === 168) ||
      (first === 198 && (second === 18 || second === 19))
    );
  }
  if (version === 6) {
    const normalized = address.toLowerCase();
    return (
      normalized === "::" ||
      normalized === "::1" ||
      normalized.startsWith("fc") ||
      normalized.startsWith("fd") ||
      normalized.startsWith("fe80:") ||
      normalized.startsWith("::ffff:127.") ||
      normalized.startsWith("::ffff:10.") ||
      normalized.startsWith("::ffff:192.168.")
    );
  }
  return true;
}

async function assertSafeProxyTarget(parsed: URL) {
  if (process.env.SPILLED_ALLOW_PRIVATE_PROXY === "1") {
    return;
  }

  const hostname = parsed.hostname.toLowerCase();
  if (hostname === "localhost" || hostname.endsWith(".localhost")) {
    throw new Error("Refusing to proxy a local host.");
  }

  if (isIP(hostname)) {
    if (isBlockedIpAddress(hostname)) {
      throw new Error("Refusing to proxy a private or reserved IP address.");
    }
    return;
  }

  const resolved = await lookup(hostname, { all: true, verbatim: true });
  if (resolved.length === 0 || resolved.some((entry) => isBlockedIpAddress(entry.address))) {
    throw new Error("Refusing to proxy a host that resolves to a private or reserved address.");
  }
}

function getProxyMaxBytes() {
  const configured = Number.parseInt(process.env.SPILLED_PROXY_MAX_BYTES || "", 10);
  return Number.isFinite(configured) && configured > 0 ? configured : 8 * 1024 * 1024 * 1024;
}

function isHlsPlaylistResponse(url: URL, contentType: string) {
  return /\.m3u8(?:$|[?#])/i.test(url.pathname + url.search) ||
    /\/hls3\/[^\s"'<>]+\.txt(?:$|[?#])/i.test(url.pathname + url.search) ||
    /(?:mpegurl|application\/vnd\.apple\.mpegurl|audio\/x-mpegurl)/i.test(contentType);
}

function isCacheableHlsAsset(url: URL, contentType: string) {
  return isHlsPlaylistResponse(url, contentType) ||
    /\.(?:ts|m4s|aac|vtt)(?:$|[?#])/i.test(url.pathname + url.search) ||
    /video\/mp2t|audio\/aac|text\/vtt/i.test(contentType);
}

function buildBrowserFileProxyPath(streamUrl: string, fileName: string, referer?: string, inlinePlayback = false) {
  const params = new URLSearchParams({
    url: streamUrl,
    name: fileName,
  });
  if (referer) {
    params.set("referer", referer);
  }
  if (inlinePlayback) {
    params.set("playback", "1");
  }
  return `/api/download-full/browser-file?${params.toString()}`;
}

function rewriteHlsTagUris(line: string, playlistUrl: URL, fileName: string, referer?: string, inlinePlayback = false) {
  return line.replace(/\bURI=(["'])([^"']+)\1/gi, (match, quote: string, rawUrl: string) => {
    try {
      const absolute = new URL(rawUrl, playlistUrl).toString();
      return `URI=${quote}${buildBrowserFileProxyPath(absolute, fileName, referer || playlistUrl.toString(), inlinePlayback)}${quote}`;
    } catch {
      return match;
    }
  });
}

function rewriteHlsPlaylistUrls(playlist: string, playlistUrl: URL, fileName: string, referer?: string, inlinePlayback = false) {
  const output: string[] = [];
  const pendingSegmentTags: string[] = [];
  const preserveImageNamedSegments = Boolean(getBrowserFileOriginHeader(referer));
  for (const line of playlist.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) {
      output.push(line);
      continue;
    }
    if (trimmed.startsWith("#EXTINF") || trimmed.startsWith("#EXT-X-BYTERANGE")) {
      pendingSegmentTags.push(rewriteHlsTagUris(line, playlistUrl, fileName, referer, inlinePlayback));
      continue;
    }
    if (trimmed.startsWith("#")) {
      output.push(...pendingSegmentTags.splice(0));
      output.push(rewriteHlsTagUris(line, playlistUrl, fileName, referer, inlinePlayback));
      continue;
    }

    try {
      const absolute = new URL(trimmed, playlistUrl).toString();
      const isKnownAd = /ad-site|\.image(?:[?#]|$)/i.test(absolute);
      const isImageNamed = /\.(?:png|jpe?g|webp|gif)(?:[?#]|$)/i.test(absolute);
      if (isKnownAd || (isImageNamed && !preserveImageNamedSegments)) {
        pendingSegmentTags.length = 0;
        continue;
      }
      output.push(...pendingSegmentTags.splice(0));
      output.push(buildBrowserFileProxyPath(absolute, fileName, referer || playlistUrl.toString(), inlinePlayback));
    } catch {
      output.push(...pendingSegmentTags.splice(0));
      output.push(line);
    }
  }
  output.push(...pendingSegmentTags);
  return output.join("\n");
}

function normalizeSubtitleText(body: string) {
  const trimmed = body.replace(/^\uFEFF/, "").trimStart();
  if (/^WEBVTT\b/i.test(trimmed)) {
    return trimmed;
  }

  const converted = trimmed
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .replace(/(\d{2}:\d{2}:\d{2}),(\d{3})/g, "$1.$2");
  return `WEBVTT\n\n${converted}`;
}

function getBrowserFileOriginHeader(referer: string | undefined) {
  if (!referer) return undefined;
  try {
    const parsed = new URL(referer);
    if (/(^|\.)vidking\.net$/i.test(parsed.hostname)) {
      return parsed.origin;
    }
  } catch {
    return undefined;
  }
  return undefined;
}

function rewriteFrameHtml(html: string, sourceUrl: URL) {
  const withQuery = sourceUrl.searchParams.has("play")
    ? html.replace(/"query":\{"params":/i, '"query":{"play":"true","params":')
    : html;
  const withoutCommonNoise = withQuery
    .replace(/<script\b[^>]*\bdisable-devtool-auto\b[^>]*><\/script>/gi, "")
    .replace(/<link\b[^>]+rel=["']manifest["'][^>]*>/gi, "")
    .replace(/\b(src|href)=["']\/\/([^"']*)["']/gi, (_match, attr, path) => `${attr}="https://${path}"`);

  if (/\.2embed\.(?:cc|skin)$/i.test(sourceUrl.hostname)) {
    return withoutCommonNoise
      .replace(/<a\b[^>]+href=["'][^"']*\/cdn-cgi\/content[^"']*["'][^>]*>\s*<\/a>/gi, "")
      .replace(/<script>\s*\(function\(\)\{\s*var r = document\.referrer[\s\S]*?\/refcheck\.php\?ingest=1[\s\S]*?\}\)\(\);\s*<\/script>/gi, "")
      .replace(/<script>\s*\(function\(\)\{function c\(\)[\s\S]*?challenge-platform\/scripts\/jsd\/main\.js[\s\S]*?<\/script>/gi, "")
      .replace(/\b(src|href)=["']\/(?!\/)([^"']*)["']/gi, (_match, attr, path) => `${attr}="${sourceUrl.origin}/${path}"`);
  }

  return withoutCommonNoise;
}

function isSupportedPlayerFrameHost(hostname: string) {
  return [
    "www.cineby.at",
    "cineby.at",
    "www.2embed.cc",
    "2embed.cc",
    "www.2embed.skin",
    "2embed.skin",
  ].includes(hostname);
}

function patchCinebyAsset(path: string, contentType: string, body: Buffer) {
  if (!/\.js(?:$|[?#])/.test(path) && !/javascript/i.test(contentType)) {
    return body;
  }

  const source = body.toString("utf8");
  const patched = source
    .replace(/r\(87737\)\(\{url:"about:blank"/g, 'false&&r(87737)({url:"about:blank"')
    .replace(/https:\/\/api\.videasy\.to/g, "/api/cineby-api");
  return patched === source ? body : Buffer.from(patched, "utf8");
}

async function fetchProxyTarget(input: {
  url: URL;
  method: string;
  headers: Record<string, string>;
}) {
  let currentUrl = input.url;
  for (let redirectCount = 0; redirectCount <= 5; redirectCount += 1) {
    await assertSafeProxyTarget(currentUrl);

    const controller = new AbortController();
    const timeout = setTimeout(
      () => controller.abort(),
      Number.parseInt(process.env.SPILLED_PROXY_FETCH_TIMEOUT_MS || "15000", 10),
    );
    try {
      const response = await fetch(currentUrl.toString(), {
        method: input.method,
        headers: input.headers,
        redirect: "manual",
        signal: controller.signal,
      });

      if ([301, 302, 303, 307, 308].includes(response.status)) {
        const location = response.headers.get("location");
        if (!location) {
          return response;
        }
        currentUrl = new URL(location, currentUrl);
        if (currentUrl.protocol !== "http:" && currentUrl.protocol !== "https:") {
          throw new Error("Refusing to follow a redirect to an unsupported protocol.");
        }
        continue;
      }

      const contentLength = Number.parseInt(response.headers.get("content-length") || "", 10);
      if (Number.isFinite(contentLength) && contentLength > getProxyMaxBytes()) {
        throw new Error("Refusing to proxy a response larger than the configured limit.");
      }

      return response;
    } finally {
      clearTimeout(timeout);
    }
  }

  throw new Error("Too many upstream redirects.");
}

export function createHttpHandlers() {
  const runtime = getNodeRuntime();
  
  console.log(`[INIT] Server initialized. Vault path: ${process.env.SPILLED_VAULT_PATH || "NOT SET"}`);

  const statusHandler = async (_req: RequestLike, res: JsonResponse) => {
    sendJson(res, 200, await getNodeStatus());
  };

  const controlPlaneProxyHandler = async (req: RequestLike, res: JsonResponse) => {
    if (req.method !== "GET" && req.method !== "POST") return sendJson(res, 405, { error: "Method not allowed." });
    const siteUrl = await readLocalEnvValue("CONVEX_SITE_URL");
    if (!siteUrl) return sendJson(res, 500, { error: "CONVEX_SITE_URL is not configured." });

    try {
      const incoming = new URL(req.url || "/api/server", "http://127.0.0.1");
      const path = incoming.searchParams.get("path")?.replace(/^\/+/, "");
      if (!path) return sendJson(res, 400, { error: "Missing control-plane path." });

      incoming.searchParams.delete("path");
      const target = new URL(`/server/${path}`, siteUrl.replace(/\/$/, ""));
      for (const [key, value] of incoming.searchParams.entries()) {
        target.searchParams.append(key, value);
      }

      const requestBody = req.method === "POST"
        ? JSON.stringify(await readJsonBody(req))
        : undefined;
      const response = await fetch(target.toString(), {
        method: req.method,
        headers: {
          Accept: "application/json",
          ...(requestBody ? { "Content-Type": "application/json" } : {}),
          ...(req.headers?.["x-spilled-control-plane-secret"]
            ? { "x-spilled-control-plane-secret": String(req.headers["x-spilled-control-plane-secret"]) }
            : {}),
        },
        body: requestBody,
      });
      const text = await response.text();
      try {
        sendJson(res, response.status, JSON.parse(text));
      } catch {
        res.statusCode = response.status;
        res.end(text);
      }
    } catch (error) {
      sendJson(res, 502, { error: error instanceof Error ? error.message : "Failed to reach control plane." });
    }
  };

  const importSvetSerialuHandler = async (req: RequestLike, res: JsonResponse) => {
    if (req.method !== "POST") return sendJson(res, 405, { error: "Method not allowed." });
    try {
      const body = await readJsonBody<{ slug?: string; svetserialuCredentials?: SvetSerialuCredentials | null }>(req);
      const slug = body.slug?.trim().toLowerCase();
      if (!slug || !/^[a-z0-9-]+$/.test(slug)) return sendJson(res, 400, { error: "Provide a valid show slug." });
      sendJson(res, 200, { show: await importShow("svetserialu", slug, undefined, { svetserialuCredentials: body.svetserialuCredentials }) });
    } catch (error) {
      sendJson(res, 500, { error: error instanceof Error ? error.message : "Failed to import show." });
    }
  };

  const svetSerialuAuthVerifyHandler = async (req: RequestLike, res: JsonResponse) => {
    if (req.method !== "POST") return sendJson(res, 405, { error: "Method not allowed." });
    try {
      const body = await readJsonBody<{ svetserialuCredentials?: SvetSerialuCredentials | null }>(req);
      await verifySvetSerialuCredentials(body.svetserialuCredentials);
      sendJson(res, 200, { ok: true });
    } catch (error) {
      sendJson(res, 400, { ok: false, error: error instanceof Error ? error.message : "SvetSerialu login failed." });
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
      const body = await readJsonBody<{ query?: string; svetserialuCredentials?: SvetSerialuCredentials | null }>(req);
      const query = body.query?.trim() ?? "";
      sendJson(res, 200, { results: query ? await searchNode(query, { svetserialuCredentials: body.svetserialuCredentials }) : [] });
    } catch (error) {
      sendJson(res, 500, { error: error instanceof Error ? error.message : "Failed to search." });
    }
  };

  const vidkingAvailabilityHandler = async (req: RequestLike, res: JsonResponse) => {
    if (req.method !== "POST") return sendJson(res, 405, { error: "Method not allowed." });
    try {
      const body = await readJsonBody<{
        items?: Array<{ importSlug?: string; mediaType?: "movie" | "serial" }>;
      }>(req);
      const items = (Array.isArray(body.items) ? body.items : [])
        .map((item) => ({
          importSlug: item.importSlug?.trim() ?? "",
          mediaType: item.mediaType,
        }))
        .filter((item) => item.importSlug.length > 0)
        .slice(0, 24);
      sendJson(res, 200, {
        results: await checkVidkingAvailabilityItems(items),
      });
    } catch (error) {
      sendJson(res, 500, { error: error instanceof Error ? error.message : "Failed to check VidKing availability." });
    }
  };

  const providerModulesHandler = async (req: RequestLike, res: JsonResponse) => {
    if (req.method !== "GET") return sendJson(res, 405, { error: "Method not allowed." });
    try {
      sendJson(res, 200, { modules: await loadProviderModules() });
    } catch (error) {
      sendJson(res, 500, { error: error instanceof Error ? error.message : "Failed to load provider modules." });
    }
  };

  const providerFeedHandler = async (req: RequestLike, res: JsonResponse) => {
    if (req.method !== "POST") return sendJson(res, 405, { error: "Method not allowed." });
    try {
      const body = await readJsonBody<{
        moduleId?: string;
        feedId?: string;
        cursor?: string | null;
        limit?: number;
        fresh?: boolean;
        repositoryUrls?: string[];
        svetserialuCredentials?: SvetSerialuCredentials | null;
      }>(req);
      const moduleId = body.moduleId?.trim();
      const feedId = body.feedId?.trim();
      if (!moduleId || !feedId) {
        return sendJson(res, 400, { error: "moduleId and feedId are required." });
      }
      sendJson(res, 200, await loadProviderFeedItems({
        moduleId,
        feedId,
        cursor: body.cursor ?? null,
        limit: body.limit,
        fresh: body.fresh === true,
        repositoryUrls: Array.isArray(body.repositoryUrls) ? body.repositoryUrls : [],
        svetserialuCredentials: body.svetserialuCredentials,
      }));
    } catch (error) {
      sendJson(res, 500, { error: error instanceof Error ? error.message : "Failed to load provider feed." });
    }
  };

  const providerSearchHandler = async (req: RequestLike, res: JsonResponse) => {
    if (req.method !== "POST") return sendJson(res, 405, { error: "Method not allowed." });
    try {
      const body = await readJsonBody<{
        moduleId?: string;
        query?: string;
        repositoryUrls?: string[];
        svetserialuCredentials?: SvetSerialuCredentials | null;
      }>(req);
      const moduleId = body.moduleId?.trim();
      const query = body.query?.trim() ?? "";
      if (!moduleId) {
        return sendJson(res, 400, { error: "moduleId is required." });
      }
      sendJson(res, 200, {
        results: query
          ? await searchProviderModuleItems({
              moduleId,
              query,
              repositoryUrls: Array.isArray(body.repositoryUrls) ? body.repositoryUrls : [],
              svetserialuCredentials: body.svetserialuCredentials,
            })
          : [],
      });
    } catch (error) {
      sendJson(res, 500, { error: error instanceof Error ? error.message : "Failed to search provider feed." });
    }
  };

  const providerImportHandler = async (req: RequestLike, res: JsonResponse) => {
    if (req.method !== "POST") return sendJson(res, 405, { error: "Method not allowed." });
    try {
      const body = await readJsonBody<{
        moduleId?: string;
        slug?: string;
        mediaType?: "movie" | "serial";
        repositoryUrls?: string[];
        svetserialuCredentials?: SvetSerialuCredentials | null;
        artworkSources?: ArtworkSourcesInput;
        artworkApiKeys?: ArtworkApiKeysInput;
      }>(req);
      const moduleId = body.moduleId?.trim();
      const slug = body.slug?.trim();
      if (!moduleId || !slug) {
        return sendJson(res, 400, { error: "moduleId and slug are required." });
      }
      const apiKeys = await resolveArtworkApiKeys(body.artworkApiKeys);
      const show = await importProviderItem({
        moduleId,
        slug,
        mediaType: body.mediaType,
        repositoryUrls: Array.isArray(body.repositoryUrls) ? body.repositoryUrls : [],
        svetserialuCredentials: body.svetserialuCredentials,
      });
      sendJson(res, 200, {
        show: await enrichAndPersistImportedShow({
          show,
          sources: body.artworkSources,
          apiKeys,
        }),
      });
    } catch (error) {
      sendJson(res, 500, { error: error instanceof Error ? error.message : "Failed to import provider item." });
    }
  };

  const integrationsCatalogHandler = async (req: RequestLike, res: JsonResponse) => {
    if (req.method !== "GET" && req.method !== "POST") return sendJson(res, 405, { error: "Method not allowed." });
    try {
      const body = req.method === "POST"
        ? await readJsonBody<{ repositoryUrls?: string[] }>(req)
        : { repositoryUrls: [] as string[] };
      sendJson(res, 200, {
        integrations: await loadIntegrationCatalog({
          repositoryUrls: getRepositoryUrlsOrDefault(body.repositoryUrls),
        }),
      });
    } catch (error) {
      sendJson(res, 500, { error: error instanceof Error ? error.message : "Failed to load integrations catalog." });
    }
  };

  const integrationsRefreshHandler = async (req: RequestLike, res: JsonResponse) => {
    if (req.method !== "POST") return sendJson(res, 405, { error: "Method not allowed." });
    try {
      const body = await readJsonBody<{ repositoryUrls?: string[] }>(req);
      sendJson(res, 200, {
        integrations: await loadIntegrationCatalog({
          repositoryUrls: getRepositoryUrlsOrDefault(body.repositoryUrls),
        }),
      });
    } catch (error) {
      sendJson(res, 500, { error: error instanceof Error ? error.message : "Failed to refresh integrations." });
    }
  };

  const titleSearchHandler = async (req: RequestLike, res: JsonResponse) => {
    if (req.method !== "POST") return sendJson(res, 405, { error: "Method not allowed." });
    try {
      const body = await readJsonBody<{
        query?: string;
        repositoryUrls?: string[];
        mediaType?: "movie" | "series";
      }>(req);
      sendJson(res, 200, await searchTitleItems({
        query: body.query?.trim() ?? "",
        mediaType: body.mediaType,
        repositoryUrls: getRepositoryUrlsOrDefault(body.repositoryUrls),
      }));
    } catch (error) {
      sendJson(res, 500, { error: error instanceof Error ? error.message : "Failed to search titles." });
    }
  };

  const titleResolveHandler = async (req: RequestLike, res: JsonResponse) => {
    if (req.method !== "POST") return sendJson(res, 405, { error: "Method not allowed." });
    try {
      const body = await readJsonBody<{
        title?: ResolvedTitle;
        repositoryUrls?: string[];
      }>(req);
      if (!body.title) {
        return sendJson(res, 400, { error: "title is required." });
      }
      sendJson(res, 200, {
        title: await resolveTitleItem({
          title: body.title,
          repositoryUrls: getRepositoryUrlsOrDefault(body.repositoryUrls),
        }),
      });
    } catch (error) {
      sendJson(res, 500, { error: error instanceof Error ? error.message : "Failed to resolve title." });
    }
  };

  const titleImportHandler = async (req: RequestLike, res: JsonResponse) => {
    if (req.method !== "POST") return sendJson(res, 405, { error: "Method not allowed." });
    try {
      const body = await readJsonBody<{
        title?: ResolvedTitle;
        repositoryUrls?: string[];
        artworkSources?: ArtworkSourcesInput;
        artworkApiKeys?: ArtworkApiKeysInput;
      }>(req);
      if (!body.title) {
        return sendJson(res, 400, { error: "title is required." });
      }
      const apiKeys = await resolveArtworkApiKeys(body.artworkApiKeys);
      const result = await importTitleItem({
        title: body.title,
        repositoryUrls: getRepositoryUrlsOrDefault(body.repositoryUrls),
      });
      const show = await enrichAndPersistImportedShow({
        show: result.show,
        sources: body.artworkSources,
        apiKeys,
      });
      sendJson(res, 200, {
        ...result,
        show,
      });
    } catch (error) {
      sendJson(res, 500, { error: error instanceof Error ? error.message : "Failed to import title." });
    }
  };

  const integrationsConfigHandler = async (req: RequestLike, res: JsonResponse) => {
    if (req.method !== "POST") return sendJson(res, 405, { error: "Method not allowed." });
    sendJson(res, 200, { ok: true });
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
        bannerUrl?: string | null;
        bannerWithLogoUrl?: string | null;
        clearLogoUrl?: string | null;
        externalIds?: { imdb?: string; tmdb?: string; tvdb?: string } | null;
        artworkSources?: { tmdb?: boolean; fanart?: boolean; tvdb?: boolean };
        artworkApiKeys?: { tmdbApiKey?: string; fanartApiKey?: string; tvdbApiKey?: string };
      }>(req);
      const apiKeys = await resolveArtworkApiKeys(body.artworkApiKeys);
      sendJson(res, 200, {
        artwork: await refreshArtwork({
          mediaType: body.mediaType,
          title: body.title,
          altTitle: body.altTitle ?? null,
          yearHint: body.yearHint ?? parseYearHint(body.years),
          description: body.description ?? null,
          currentPosterUrl: body.posterUrl ?? null,
          currentBackdropUrl: body.backdropUrl ?? null,
          currentBannerUrl: body.bannerUrl ?? null,
          currentBannerWithLogoUrl: body.bannerWithLogoUrl ?? null,
          currentClearLogoUrl: body.clearLogoUrl ?? null,
          externalIds: body.externalIds ?? undefined,
          sources: body.artworkSources,
          apiKeys,
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
        posterUrl?: string | null;
        backdropUrl?: string | null;
        bannerUrl?: string | null;
        bannerWithLogoUrl?: string | null;
        clearLogoUrl?: string | null;
        externalIds?: { imdb?: string; tmdb?: string; tvdb?: string } | null;
        artworkSources?: { tmdb?: boolean; fanart?: boolean; tvdb?: boolean };
        artworkApiKeys?: { tmdbApiKey?: string; fanartApiKey?: string; tvdbApiKey?: string };
      }>(req);
      const apiKeys = await resolveArtworkApiKeys(body.artworkApiKeys);
      sendJson(res, 200, {
        assets: await searchArtwork({
          mediaType: body.mediaType,
          title: body.title,
          altTitle: body.altTitle ?? null,
          yearHint: body.yearHint ?? parseYearHint(body.years),
          description: body.description ?? null,
          currentPosterUrl: body.posterUrl ?? null,
          currentBackdropUrl: body.backdropUrl ?? null,
          currentBannerUrl: body.bannerUrl ?? null,
          currentBannerWithLogoUrl: body.bannerWithLogoUrl ?? null,
          currentClearLogoUrl: body.clearLogoUrl ?? null,
          externalIds: body.externalIds ?? undefined,
          sources: body.artworkSources,
          apiKeys,
        }),
      });
    } catch (error) {
      sendJson(res, 500, { error: error instanceof Error ? error.message : "Failed to search artwork." });
    }
  };

  const castArtworkHandler = async (req: RequestLike, res: JsonResponse) => {
    if (req.method !== "POST") return sendJson(res, 405, { error: "Method not allowed." });
    try {
      const body = await readJsonBody<{
        title: string;
        altTitle?: string | null;
        yearHint?: string | null;
        description?: string | null;
        mediaType: "movie" | "tv";
        externalIds?: { imdb?: string; tmdb?: string; tvdb?: string } | null;
        artworkApiKeys?: { tmdbApiKey?: string; fanartApiKey?: string; tvdbApiKey?: string };
      }>(req);
      const apiKeys = await resolveArtworkApiKeys(body.artworkApiKeys);
      sendJson(res, 200, {
        actors: await fetchTmdbCast({
          mediaType: body.mediaType,
          title: body.title,
          altTitle: body.altTitle ?? null,
          yearHint: body.yearHint ?? undefined,
          description: body.description ?? null,
          externalIds: body.externalIds ?? undefined,
          apiKeys,
        }),
      });
    } catch (error) {
      sendJson(res, 500, { error: error instanceof Error ? error.message : "Failed to fetch cast." });
    }
  };

  const titleMetadataArtworkHandler = async (req: RequestLike, res: JsonResponse) => {
    if (req.method !== "POST") return sendJson(res, 405, { error: "Method not allowed." });
    try {
      const body = await readJsonBody<{
        title: string;
        altTitle?: string | null;
        yearHint?: string | null;
        description?: string | null;
        mediaType: "movie" | "tv";
        externalIds?: { imdb?: string; tmdb?: string; tvdb?: string } | null;
        seasonNumber?: number | null;
        episodeNumber?: number | null;
        artworkApiKeys?: { tmdbApiKey?: string; fanartApiKey?: string; tvdbApiKey?: string };
      }>(req);
      const apiKeys = await resolveArtworkApiKeys(body.artworkApiKeys);
      sendJson(res, 200, {
        metadata: await fetchTmdbTitleMetadata({
          mediaType: body.mediaType,
          title: body.title,
          altTitle: body.altTitle ?? null,
          yearHint: body.yearHint ?? undefined,
          description: body.description ?? null,
          externalIds: body.externalIds ?? undefined,
          seasonNumber: body.seasonNumber ?? null,
          episodeNumber: body.episodeNumber ?? null,
          apiKeys,
        }),
      });
    } catch (error) {
      sendJson(res, 500, { error: error instanceof Error ? error.message : "Failed to fetch title metadata." });
    }
  };

  const personCreditsArtworkHandler = async (req: RequestLike, res: JsonResponse) => {
    if (req.method !== "POST") return sendJson(res, 405, { error: "Method not allowed." });
    try {
      const body = await readJsonBody<{
        name: string;
        artworkApiKeys?: { tmdbApiKey?: string; fanartApiKey?: string; tvdbApiKey?: string };
      }>(req);
      const apiKeys = await resolveArtworkApiKeys(body.artworkApiKeys);
      sendJson(res, 200, {
        credits: await fetchTmdbPersonCredits({
          name: body.name,
          apiKeys,
        }),
      });
    } catch (error) {
      sendJson(res, 500, { error: error instanceof Error ? error.message : "Failed to fetch person credits." });
    }
  };

  const composeHomepageBannerHandler = async (req: RequestLike, res: JsonResponse) => {
    if (req.method !== "POST") return sendJson(res, 405, { error: "Method not allowed." });
    try {
      const body = await readJsonBody<{
        backdropUrl?: string | null;
        logoUrl?: string | null;
        title?: string | null;
      }>(req);
      if (!body.backdropUrl || !body.title?.trim()) {
        return sendJson(res, 400, { error: "backdropUrl and title are required." });
      }
      sendJson(res, 200, {
        bannerUrl: await composeHomepageBanner({
          backdropUrl: body.backdropUrl,
          logoUrl: body.logoUrl ?? null,
          title: body.title,
        }),
      });
    } catch (error) {
      sendJson(res, 500, { error: error instanceof Error ? error.message : "Failed to compose homepage banner." });
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

  const playerFrameHandler = async (req: RequestLike, res: JsonResponse) => {
    if (req.method !== "GET" && req.method !== "HEAD") return sendJson(res, 405, { error: "Method not allowed." });
    try {
      const params = getQueryParams(req.url);
      const rawUrl = params.get("url");
      if (!rawUrl) return sendJson(res, 400, { error: "Missing url." });

      const parsed = new URL(rawUrl);
      if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
        return sendJson(res, 400, { error: "Unsupported frame URL protocol." });
      }
      if (!isSupportedPlayerFrameHost(parsed.hostname)) {
        return sendJson(res, 400, { error: "Unsupported frame host." });
      }

      const upstream = await fetchProxyTarget({
        url: parsed,
        method: req.method ?? "GET",
        headers: {
          "User-Agent": USER_AGENT,
          Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
          "Accept-Language": "en-US,en;q=0.9",
          Referer: parsed.origin,
        },
      });

      res.statusCode = upstream.status;
      res.setHeader("Content-Type", upstream.headers.get("content-type") || "text/html; charset=utf-8");
      res.setHeader("Cache-Control", "no-store");
      res.setHeader("Referrer-Policy", "no-referrer");

      if (req.method === "HEAD") {
        res.end();
        return;
      }

      const html = await upstream.text();
      res.end(rewriteFrameHtml(html, parsed));
    } catch (error) {
      return sendJson(res, 422, {
        error: error instanceof Error ? error.message : "Failed to load player frame.",
      });
    }
  };

  const cinebyAssetHandler = async (req: RequestLike, res: JsonResponse) => {
    if (req.method !== "GET" && req.method !== "HEAD") return sendJson(res, 405, { error: "Method not allowed." });
    try {
      const path = req.url?.split("?")[0] || "";
      if (!path.startsWith("/_next/static/") && !path.startsWith("/scripts/")) {
        return sendJson(res, 404, { error: "Not found." });
      }

      const upstreamUrl = new URL(req.url || path, "https://www.cineby.at");
      const upstream = await fetchProxyTarget({
        url: upstreamUrl,
        method: req.method ?? "GET",
        headers: {
          "User-Agent": USER_AGENT,
          Accept: "*/*",
          "Accept-Language": "en-US,en;q=0.9",
          Referer: "https://www.cineby.at/",
        },
      });

      res.statusCode = upstream.status;
      res.setHeader("Content-Type", upstream.headers.get("content-type") || "application/octet-stream");
      res.setHeader("Cache-Control", "public, max-age=3600");
      res.setHeader("Access-Control-Allow-Origin", "*");
      if (req.method === "HEAD") {
        res.end();
        return;
      }
      const body = patchCinebyAsset(
        path,
        upstream.headers.get("content-type") || "",
        Buffer.from(await upstream.arrayBuffer()),
      );
      res.end(body as unknown as string);
    } catch (error) {
      return sendJson(res, 502, {
        error: error instanceof Error ? error.message : "Failed to load Cineby asset.",
      });
    }
  };

  const cinebyApiHandler = async (req: RequestLike, res: JsonResponse) => {
    if (req.method !== "GET" && req.method !== "POST" && req.method !== "HEAD") {
      return sendJson(res, 405, { error: "Method not allowed." });
    }
    try {
      const incoming = new URL(req.url || "/api/cineby-api", "http://spilled.local");
      const upstreamPath = incoming.pathname.replace(/^\/api\/cineby-api/, "") || "/";
      const upstreamUrl = new URL(`${upstreamPath}${incoming.search}`, "https://api.videasy.to");
      const upstream = await fetchProxyTarget({
        url: upstreamUrl,
        method: req.method ?? "GET",
        headers: {
          "User-Agent": USER_AGENT,
          Accept: "*/*",
          "Accept-Language": "en-US,en;q=0.9",
          Referer: "https://www.cineby.at/",
        },
      });

      res.statusCode = upstream.status;
      res.setHeader("Content-Type", upstream.headers.get("content-type") || "application/json; charset=utf-8");
      res.setHeader("Cache-Control", "no-store");
      res.setHeader("Access-Control-Allow-Origin", "*");
      if (req.method === "HEAD") {
        res.end();
        return;
      }
      const body = Buffer.from(await upstream.arrayBuffer());
      res.end(body as unknown as string);
    } catch (error) {
      return sendJson(res, 502, {
        error: error instanceof Error ? error.message : "Failed to load Cineby API.",
      });
    }
  };

  const quietBeaconHandler = async (_req: RequestLike, res: JsonResponse) => {
    res.statusCode = 204;
    res.setHeader("Cache-Control", "no-store");
    res.end();
  };

  const cleanPlayerResolveHandler = async (req: RequestLike, res: JsonResponse) => {
    if (req.method !== "POST") return sendJson(res, 405, { error: "Method not allowed." });
    try {
      sendJson(res, 200, await resolveCleanPlaybackViaNode(await readJsonBody(req)));
    } catch (error) {
      sendJson(res, 422, { error: error instanceof Error ? error.message : "Failed to resolve clean playback." });
    }
  };

  const playbackResolveHandler = async (req: RequestLike, res: JsonResponse) => {
    if (req.method !== "POST") return sendJson(res, 405, { error: "Method not allowed." });
    try {
      sendJson(res, 200, await resolvePlaybackViaNode(await readJsonBody(req)));
    } catch (error) {
      const failures = error && typeof error === "object" && "failures" in error ? (error as { failures?: unknown }).failures : undefined;
      sendJson(res, 422, {
        error: error instanceof Error ? error.message : "Failed to resolve playback.",
        failures: Array.isArray(failures) ? failures : [],
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
      const inlinePlayback = params.get("playback") === "1";
      if (!streamUrl) return sendJson(res, 400, { error: "Missing stream URL." });

      const parsed = new URL(streamUrl);
      if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
        return sendJson(res, 400, { error: "Unsupported stream URL protocol." });
      }
      const isVidkingRequest = Boolean(getBrowserFileOriginHeader(referer));
      const isXpassSegment = /play\.xpass\.top/i.test(referer ?? "") && /\/page-\d+\.html(?:$|[?#])/i.test(parsed.pathname + parsed.search);

      const upstream = await fetchProxyTarget({
        url: parsed,
        method: req.method,
        headers: {
          "user-agent": USER_AGENT,
          accept: "*/*",
          ...(referer ? { referer } : {}),
          ...(typeof req.headers?.range === "string" ? { range: req.headers.range } : {}),
        },
      });

      if (!upstream.ok && upstream.status !== 206) {
        const detail = await upstream.text().catch(() => "");
        return sendJson(res, upstream.status || 502, {
          error: `Upstream stream request failed (${upstream.status}).`,
          detail: detail.slice(0, 300),
        });
      }

      res.statusCode = upstream.status;
      const upstreamContentType = upstream.headers.get("content-type") || "application/octet-stream";
      const contentType = (isVidkingRequest && /\.jpe?g$/i.test(parsed.pathname)) || isXpassSegment ? "video/mp2t" : upstreamContentType;
      res.setHeader("Content-Type", contentType);
      const acceptRanges = getUpstreamAcceptRanges(upstream.headers);
      if (acceptRanges) res.setHeader("Accept-Ranges", acceptRanges);
      res.setHeader("Cache-Control", isCacheableHlsAsset(parsed, contentType) ? "private, max-age=600" : "no-store");
      res.setHeader("Content-Disposition", `${inlinePlayback ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(fileName)}`);
      if (req.method !== "HEAD" && upstream.body && isHlsPlaylistResponse(parsed, contentType)) {
        const playlist = await upstream.text();
        const rewritten = rewriteHlsPlaylistUrls(playlist, parsed, fileName, referer, inlinePlayback);
        res.setHeader("Content-Type", "application/vnd.apple.mpegurl");
        res.setHeader("Content-Length", Buffer.byteLength(rewritten).toString());
        return res.end(rewritten);
      }
      const contentLength = upstream.headers.get("content-length");
      const contentRange = upstream.headers.get("content-range");
      if (contentLength) res.setHeader("Content-Length", contentLength);
      if (contentRange) res.setHeader("Content-Range", contentRange);
      if (req.method === "HEAD" || !upstream.body) return res.end();
      Readable.fromWeb(upstream.body as unknown as NodeReadableStream).pipe(res as never);
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
      
      const fileInfo = await stat(filePath);
      const fileSize = fileInfo.size;

      res.setHeader("Accept-Ranges", "bytes");
      res.setHeader("Content-Type", "video/mp4");
      res.setHeader("Cache-Control", "no-store");

      const resolvedRange = resolveDownloadByteRange(fileSize, rangeHeader);
      if (!resolvedRange) {
        res.statusCode = 416;
        res.setHeader("Content-Range", `bytes */${fileSize}`);
        return res.end();
      }

      if (resolvedRange.statusCode === 206) {
        res.statusCode = resolvedRange.statusCode;
        res.setHeader("Content-Range", resolvedRange.contentRange ?? "");
        res.setHeader("Content-Length", String(resolvedRange.contentLength));
        if (isHead) return res.end();
        createReadStream(filePath, { start: resolvedRange.start, end: resolvedRange.end }).pipe(res as never);
        return;
      }

      res.statusCode = 200;
      res.setHeader("Content-Length", String(resolvedRange.contentLength));
      if (isHead) return res.end();
      createReadStream(filePath).pipe(res as never);
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
      res.setHeader("Access-Control-Allow-Origin", "*");
      res.end(normalizeSubtitleText(await readFile(filePath, "utf8")));
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

      const headers: Record<string, string> = {
        "User-Agent": "Mozilla/5.0",
        Accept: "text/vtt,text/plain,application/json,*/*",
        Referer: "https://svetserialu.to/",
      };

      const fetchBody = async (url: string): Promise<{ status: number; body: string }> => {
        const response = await fetch(url, { redirect: "follow", headers });
        if (!response.ok) return { status: response.status, body: "" };
        const contentType = (response.headers.get("content-type") || "").toLowerCase();
        if (contentType.includes("application/json") || contentType.includes("text/json")) {
          const payload = await response.json().catch(() => null);
          if (Array.isArray(payload)) {
            const entry = payload.find((item) => item && item.default) ?? payload[0];
            if (entry && typeof entry.file === "string") {
              const safeFile = (() => {
                try {
                  return new URL(entry.file).toString();
                } catch {
                  return null;
                }
              })();
              if (safeFile) {
                const vtt = await fetch(safeFile, { redirect: "follow", headers });
                return { status: vtt.ok ? vtt.status : 502, body: vtt.ok ? await vtt.text() : "" };
              }
            }
          }
        }
        return { status: response.status, body: await response.text() };
      };

      const { status, body } = await fetchBody(parsed.toString());
      if (status !== 200) return sendJson(res, status, { error: "Failed to fetch subtitle file." });

      const normalized = normalizeSubtitleText(body);
      res.statusCode = 200;
      res.setHeader("Content-Type", "text/vtt; charset=utf-8");
      res.setHeader("Cache-Control", "no-store");
      res.setHeader("Access-Control-Allow-Origin", "*");
      res.end(normalized);
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

  const privateSetupStatusHandler = async (req: RequestLike, res: JsonResponse) => {
    if (req.method !== "GET") return sendJson(res, 405, { error: "Method not allowed." });
    const status = await runtime.getSetupBootstrapStatus();
    sendJson(res, 200, {
      enabled: status.enabled,
      setupRequired: status.setupRequired,
      reason: status.reason,
      setupCode: null,
      configPath: status.configPath,
      nodeUrl: status.nodeUrl,
      publicEndpointUrl: status.publicEndpointUrl,
      codeRequired: status.codeRequired,
    });
  };

  const privateSetupCompleteHandler = async (req: RequestLike, res: JsonResponse) => {
    if (req.method !== "POST") return sendJson(res, 405, { error: "Method not allowed." });
    try {
      if (!checkRateLimit(req, "private-setup-complete", 8)) {
        return sendJson(res, 429, { error: "Too many setup attempts. Try again later." });
      }
      const body = await readJsonBody<{
        setupCode?: string;
        dashboardOrigin?: string;
        nodeName?: string;
        admin?: { adminId?: string; displayName?: string; password?: string };
        accountId?: string;
        displayName?: string;
        password?: string;
        quotaBytes?: number;
        profiles?: Array<{ profileId?: string; displayName?: string; avatar?: string }>;
        initialWatchers?: Array<{
          watcherId?: string;
          displayName?: string;
          password?: string;
          quotaBytes?: number;
          profiles?: Array<{ profileId?: string; displayName?: string; avatar?: string }>;
        }>;
        publicCapabilities?: Record<string, boolean>;
        allowPublicFetch?: boolean;
      }>(req);
      if (!body.setupCode || !(body.admin?.password || body.password)) {
        return sendJson(res, 400, { error: "Missing setup code or admin password." });
      }
      const profiles = (body.profiles ?? [])
        .filter((profile) => profile.displayName?.trim())
        .map((profile, index) => ({
          profileId: profile.profileId || `prof_${index + 1}`,
          displayName: profile.displayName || `Profile ${index + 1}`,
          avatar: profile.avatar,
        }));
      sendJson(res, 200, await runtime.completePrivateSetup({
        setupCode: body.setupCode,
        dashboardOrigin: body.dashboardOrigin || getRequestOrigin(req),
        nodeName: body.nodeName || "Private Node",
        admin: body.admin?.adminId && body.admin.password ? {
          adminId: body.admin.adminId,
          displayName: body.admin.displayName || body.admin.adminId,
          password: body.admin.password,
        } : undefined,
        accountId: body.accountId,
        displayName: body.displayName,
        password: body.password,
        quotaBytes: typeof body.quotaBytes === "number" ? body.quotaBytes : 500 * 1024 * 1024 * 1024,
        profiles,
        initialWatchers: body.initialWatchers?.map((watcher, index) => ({
          watcherId: watcher.watcherId || `watcher_${index + 1}`,
          displayName: watcher.displayName || `Watcher ${index + 1}`,
          password: watcher.password,
          quotaBytes: typeof watcher.quotaBytes === "number" ? watcher.quotaBytes : 500 * 1024 * 1024 * 1024,
          profiles: (watcher.profiles ?? []).map((profile, profileIndex) => ({
            profileId: profile.profileId || `prof_${profileIndex + 1}`,
            displayName: profile.displayName || `Profile ${profileIndex + 1}`,
            avatar: profile.avatar,
          })),
        })),
        publicCapabilities: body.publicCapabilities,
        allowPublicFetch: body.allowPublicFetch !== false,
      }));
    } catch (error) {
      sendJson(res, 400, { error: error instanceof Error ? error.message : "Private node setup failed." });
    }
  };

  const adminAuthHandler = async (req: RequestLike, res: JsonResponse) => {
    try {
      if (req.method === "GET") {
        sendJson(res, 200, await runtime.getAdminMe(getBearerToken(req)));
        return;
      }
      if (req.method === "POST") {
        const pathname = req.url?.split("?")[0] ?? "";
        if (pathname.endsWith("/logout")) {
          sendJson(res, 200, await runtime.logoutAdminSession(getBearerToken(req)));
          return;
        }
        if (!checkRateLimit(req, "admin-password-login", 8)) {
          return sendJson(res, 429, { error: "Too many login attempts. Try again later." });
        }
        const body = await readJsonBody<{ adminId?: string; password?: string }>(req);
        if (!body.adminId || !body.password) {
          return sendJson(res, 400, { error: "Missing username or password." });
        }
        sendJson(res, 200, await runtime.loginAdminPassword({ adminId: body.adminId, password: body.password }));
        return;
      }
      sendJson(res, 405, { error: "Method not allowed." });
    } catch {
      sendJson(res, 401, { error: "Invalid username or password." });
    }
  };

  const watcherAuthHandler = async (req: RequestLike, res: JsonResponse) => {
    try {
      if (req.method === "GET") {
        sendJson(res, 200, await runtime.getPrivateMe(getBearerToken(req)));
        return;
      }
      if (req.method === "POST") {
        const pathname = req.url?.split("?")[0] ?? "";
        if (pathname.endsWith("/logout")) {
          sendJson(res, 200, await runtime.logoutPrivateSession(getBearerToken(req)));
          return;
        }
        if (!checkRateLimit(req, "watcher-password-login", 10)) {
          return sendJson(res, 429, { error: "Too many login attempts. Try again later." });
        }
        const body = await readJsonBody<{ watcherId?: string; password?: string; profileId?: string }>(req);
        if (!body.watcherId || !body.password) {
          return sendJson(res, 400, { error: "Missing username or password." });
        }
        sendJson(res, 200, await runtime.loginWatcherPassword({ watcherId: body.watcherId, password: body.password, profileId: body.profileId }));
        return;
      }
      sendJson(res, 405, { error: "Method not allowed." });
    } catch {
      sendJson(res, 401, { error: "Invalid username or password." });
    }
  };

  const adminStatusHandler = async (req: RequestLike, res: JsonResponse) => {
    if (req.method !== "GET") return sendJson(res, 405, { error: "Method not allowed." });
    try {
      sendJson(res, 200, await runtime.getAdminStatus(getBearerToken(req)));
    } catch (error) {
      sendJson(res, 401, { error: error instanceof Error ? error.message : "Unauthorized." });
    }
  };

  const adminCapabilitiesHandler = async (req: RequestLike, res: JsonResponse) => {
    if (req.method !== "PUT") return sendJson(res, 405, { error: "Method not allowed." });
    try {
      const body = await readJsonBody<Record<string, boolean>>(req);
      sendJson(res, 200, await runtime.updatePublicCapabilities(getBearerToken(req), body));
    } catch (error) {
      sendJson(res, 401, { error: error instanceof Error ? error.message : "Unauthorized." });
    }
  };

  const adminWatchersHandler = async (req: RequestLike, res: JsonResponse) => {
    try {
      if (req.method === "GET") {
        const status = await runtime.getAdminStatus(getBearerToken(req));
        sendJson(res, 200, { watchers: status.watchers });
        return;
      }
      if (req.method === "POST") {
        const body = await readJsonBody<{
          watcherId?: string;
          displayName?: string;
          password?: string;
          quotaBytes?: number;
          profiles?: Array<{ profileId?: string; displayName?: string; avatar?: string }>;
        }>(req);
        if (!body.watcherId || !body.displayName) {
          return sendJson(res, 400, { error: "Missing watcher id or display name." });
        }
        sendJson(res, 200, {
          watcher: await runtime.createWatcherAccount(getBearerToken(req), {
            watcherId: body.watcherId,
            displayName: body.displayName,
            password: body.password,
            quotaBytes: body.quotaBytes ?? 200 * 1024 * 1024 * 1024,
            profiles: body.profiles?.map((profile, index) => ({
              profileId: profile.profileId || `prof_${index + 1}`,
              displayName: profile.displayName || `Profile ${index + 1}`,
              avatar: profile.avatar,
            })),
          }),
        });
        return;
      }
      sendJson(res, 405, { error: "Method not allowed." });
    } catch (error) {
      sendJson(res, 401, { error: error instanceof Error ? error.message : "Unauthorized." });
    }
  };

  const privateAccountsHandler = async (req: RequestLike, res: JsonResponse) => {
    if (req.method !== "GET") return sendJson(res, 405, { error: "Method not allowed." });
    try {
      sendJson(res, 200, { accounts: await runtime.listPrivateAccounts() });
    } catch (error) {
      sendJson(res, 500, { error: error instanceof Error ? error.message : "Failed to list private accounts." });
    }
  };

  const privateMeHandler = async (req: RequestLike, res: JsonResponse) => {
    if (req.method === "GET") {
      try {
        sendJson(res, 200, await runtime.getPrivateMe(getBearerToken(req)));
      } catch (error) {
        sendJson(res, 401, { error: error instanceof Error ? error.message : "Unauthorized." });
      }
      return;
    }
    if (req.method === "POST") {
      try {
        sendJson(res, 200, await runtime.logoutPrivateSession(getBearerToken(req)));
      } catch (error) {
        sendJson(res, 500, { error: error instanceof Error ? error.message : "Failed to log out." });
      }
      return;
    }
    return sendJson(res, 405, { error: "Method not allowed." });
  };

  const passkeyRegisterOptionsHandler = async (req: RequestLike, res: JsonResponse) => {
    if (req.method !== "POST") return sendJson(res, 405, { error: "Method not allowed." });
    try {
      if (!checkRateLimit(req, "passkey-register-options", 6)) {
        return sendJson(res, 429, { error: "Too many passkey enrollment attempts. Try again later." });
      }
      const body = await readJsonBody<{ accountId?: string; setupSecret?: string; origin?: string }>(req);
      if (!body.accountId || !body.setupSecret) return sendJson(res, 400, { error: "Missing accountId or setupSecret." });
      sendJson(res, 200, await runtime.createPasskeyRegistrationOptions({
        accountId: body.accountId,
        setupSecret: body.setupSecret,
        origin: body.origin || getRequestOrigin(req),
      }));
    } catch (error) {
      sendJson(res, 400, { error: error instanceof Error ? error.message : "Failed to create passkey registration options." });
    }
  };

  const passkeyRegisterVerifyHandler = async (req: RequestLike, res: JsonResponse) => {
    if (req.method !== "POST") return sendJson(res, 405, { error: "Method not allowed." });
    try {
      if (!checkRateLimit(req, "passkey-register-verify", 10)) {
        return sendJson(res, 429, { error: "Too many passkey verification attempts. Try again later." });
      }
      const body = await readJsonBody<{ accountId?: string; response?: unknown; origin?: string }>(req);
      if (!body.accountId || !body.response) return sendJson(res, 400, { error: "Missing accountId or response." });
      sendJson(res, 200, await runtime.verifyPasskeyRegistration({
        accountId: body.accountId,
        response: body.response as never,
        origin: body.origin || getRequestOrigin(req),
      }));
    } catch (error) {
      sendJson(res, 400, { error: error instanceof Error ? error.message : "Failed to verify passkey registration." });
    }
  };

  const passkeyLoginOptionsHandler = async (req: RequestLike, res: JsonResponse) => {
    if (req.method !== "POST") return sendJson(res, 405, { error: "Method not allowed." });
    try {
      if (!checkRateLimit(req, "passkey-login-options", 12)) {
        return sendJson(res, 429, { error: "Too many passkey login attempts. Try again later." });
      }
      const body = await readJsonBody<{ accountId?: string; origin?: string }>(req);
      if (!body.accountId) return sendJson(res, 400, { error: "Missing accountId." });
      sendJson(res, 200, await runtime.createPasskeyLoginOptions({
        accountId: body.accountId,
        origin: body.origin || getRequestOrigin(req),
      }));
    } catch (error) {
      sendJson(res, 400, { error: error instanceof Error ? error.message : "Failed to create passkey login options." });
    }
  };

  const passkeyLoginVerifyHandler = async (req: RequestLike, res: JsonResponse) => {
    if (req.method !== "POST") return sendJson(res, 405, { error: "Method not allowed." });
    try {
      if (!checkRateLimit(req, "passkey-login-verify", 12)) {
        return sendJson(res, 429, { error: "Too many passkey login attempts. Try again later." });
      }
      const body = await readJsonBody<{ accountId?: string; response?: unknown; origin?: string; profileId?: string }>(req);
      if (!body.accountId || !body.response) return sendJson(res, 400, { error: "Missing accountId or response." });
      sendJson(res, 200, await runtime.verifyPasskeyLogin({
        accountId: body.accountId,
        response: body.response as never,
        origin: body.origin || getRequestOrigin(req),
        profileId: body.profileId,
      }));
    } catch (error) {
      sendJson(res, 400, { error: error instanceof Error ? error.message : "Failed to verify passkey login." });
    }
  };

  const oidcProvidersHandler = async (req: RequestLike, res: JsonResponse) => {
    if (req.method !== "GET") return sendJson(res, 405, { error: "Method not allowed." });
    try {
      sendJson(res, 200, { providers: await runtime.listOidcProviders() });
    } catch (error) {
      sendJson(res, 500, { error: error instanceof Error ? error.message : "Failed to list OIDC providers." });
    }
  };

  const oidcStartHandler = async (_req: RequestLike, res: JsonResponse) => {
    sendJson(res, 501, { error: "OIDC provider discovery is implemented; browser redirect login is not wired yet." });
  };

  const oidcFinishHandler = async (_req: RequestLike, res: JsonResponse) => {
    sendJson(res, 501, { error: "OIDC callback validation is not wired yet." });
  };

  const privateProfilesHandler = async (req: RequestLike, res: JsonResponse) => {
    if (req.method !== "GET") return sendJson(res, 405, { error: "Method not allowed." });
    try {
      sendJson(res, 200, { profiles: await runtime.listPrivateProfiles(getBearerToken(req)) });
    } catch (error) {
      sendJson(res, 401, { error: error instanceof Error ? error.message : "Unauthorized." });
    }
  };

  const privateProfileSelectHandler = async (req: RequestLike, res: JsonResponse) => {
    if (req.method !== "POST") return sendJson(res, 405, { error: "Method not allowed." });
    try {
      const body = await readJsonBody<{ profileId?: string }>(req);
      if (!body.profileId) return sendJson(res, 400, { error: "Missing profileId." });
      sendJson(res, 200, await runtime.selectPrivateProfile(getBearerToken(req), body.profileId));
    } catch (error) {
      sendJson(res, 401, { error: error instanceof Error ? error.message : "Unauthorized." });
    }
  };

  const privateLibraryHandler = async (req: RequestLike, res: JsonResponse) => {
    const profileId = getQueryParams(req.url).get("profileId");
    if (!profileId) return sendJson(res, 400, { error: "Missing profileId." });
    try {
      if (req.method === "GET") {
        sendJson(res, 200, { profile: await runtime.getPrivateLibrary(getBearerToken(req), profileId) });
        return;
      }
      if (req.method === "PUT") {
        const body = await readJsonBody<Record<string, unknown>>(req);
        sendJson(res, 200, { profile: await runtime.putPrivateLibrary(getBearerToken(req), profileId, body as never) });
        return;
      }
      return sendJson(res, 405, { error: "Method not allowed." });
    } catch (error) {
      sendJson(res, 401, { error: error instanceof Error ? error.message : "Unauthorized." });
    }
  };

  const privateStorageHandler = async (req: RequestLike, res: JsonResponse) => {
    if (req.method !== "GET") return sendJson(res, 405, { error: "Method not allowed." });
    try {
      sendJson(res, 200, await runtime.getPrivateStorageSummary(getBearerToken(req)));
    } catch (error) {
      sendJson(res, 401, { error: error instanceof Error ? error.message : "Unauthorized." });
    }
  };

  const privateDownloadsHandler = async (req: RequestLike, res: JsonResponse) => {
    try {
      if (req.method === "GET") {
        sendJson(res, 200, { downloads: await runtime.listPrivateDownloads(getBearerToken(req), getQueryParams(req.url).get("profileId") ?? undefined) });
        return;
      }
      if (req.method === "DELETE") {
        const downloadId = getQueryParams(req.url).get("downloadId");
        if (!downloadId) return sendJson(res, 400, { error: "Missing downloadId." });
        sendJson(res, 200, { download: await runtime.deletePrivateDownload(getBearerToken(req), downloadId) });
        return;
      }
      if (req.method === "POST") {
        const body = await readJsonBody<{
          downloadId?: string;
          profileId?: string;
          episodeId?: string;
          contentId?: string;
          fileName?: string;
          filePath?: string;
          sizeBytes?: number;
          mimeType?: string;
          sha256?: string;
          spillshareEnabled?: boolean;
        }>(req);
        if (!body.downloadId || !body.profileId || !body.contentId || !body.fileName || !body.filePath || typeof body.sizeBytes !== "number") {
          return sendJson(res, 400, { error: "Missing download metadata." });
        }
        sendJson(res, 200, {
          download: await runtime.registerPrivateDownload(getBearerToken(req), {
            downloadId: body.downloadId,
            profileId: body.profileId,
            episodeId: body.episodeId,
            contentId: body.contentId,
            fileName: body.fileName,
            filePath: body.filePath,
            sizeBytes: body.sizeBytes,
            mimeType: body.mimeType || "video/mp4",
            sha256: body.sha256,
            spillshareEnabled: body.spillshareEnabled === true,
          }),
        });
        return;
      }
      return sendJson(res, 405, { error: "Method not allowed." });
    } catch (error) {
      sendJson(res, /quota/i.test(error instanceof Error ? error.message : "") ? 409 : 401, { error: error instanceof Error ? error.message : "Unauthorized." });
    }
  };

  const privateDownloadFileHandler = async (req: RequestLike, res: JsonResponse) => {
    if (req.method !== "GET" && req.method !== "HEAD") return sendJson(res, 405, { error: "Method not allowed." });
    try {
      const downloadId = getQueryParams(req.url).get("downloadId");
      if (!downloadId) return sendJson(res, 400, { error: "Missing downloadId." });
      const download = await runtime.getPrivateDownloadFile(getBearerToken(req), downloadId);
      const fileStats = await stat(download.filePath);
      const rangeHeader = Array.isArray(req.headers?.range) ? req.headers?.range[0] : req.headers?.range;
      const byteRange = resolveDownloadByteRange(fileStats.size, rangeHeader);
      if (!byteRange) {
        res.statusCode = 416;
        res.setHeader("Content-Range", `bytes */${fileStats.size}`);
        res.end();
        return;
      }
      res.statusCode = byteRange.statusCode;
      res.setHeader("Accept-Ranges", "bytes");
      res.setHeader("Content-Type", download.mimeType || "application/octet-stream");
      res.setHeader("Content-Length", String(byteRange.contentLength));
      res.setHeader("Content-Disposition", `inline; filename="${download.fileName.replace(/"/g, "")}"`);
      if (byteRange.contentRange) {
        res.setHeader("Content-Range", byteRange.contentRange);
      }
      if (req.method === "HEAD") {
        res.end();
        return;
      }
      createReadStream(download.filePath, { start: byteRange.start, end: byteRange.end }).pipe(res as unknown as NodeJS.WritableStream);
    } catch (error) {
      sendJson(res, 401, { error: error instanceof Error ? error.message : "Unauthorized." });
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
    controlPlaneProxyHandler,
    importSvetSerialuHandler,
    svetSerialuAuthVerifyHandler,
    importBombujHandler,
    searchHandler,
    vidkingAvailabilityHandler,
    providerModulesHandler,
    providerFeedHandler,
    providerSearchHandler,
    providerImportHandler,
    integrationsCatalogHandler,
    integrationsRefreshHandler,
    titleSearchHandler,
    titleResolveHandler,
    titleImportHandler,
    integrationsConfigHandler,
    refreshArtworkHandler,
    searchArtworkHandler,
    titleMetadataArtworkHandler,
    castArtworkHandler,
    personCreditsArtworkHandler,
    composeHomepageBannerHandler,
    exploreFeedHandler,
    explorePeopleHandler,
    trendingFeedHandler,
    startDownloadHandler,
    browserStartHandler,
    playerResolveHandler,
    playerFrameHandler,
    cinebyAssetHandler,
    cinebyApiHandler,
    quietBeaconHandler,
    cleanPlayerResolveHandler,
    playbackResolveHandler,
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
    privateSetupStatusHandler,
    privateSetupCompleteHandler,
    adminAuthHandler,
    watcherAuthHandler,
    adminStatusHandler,
    adminCapabilitiesHandler,
    adminWatchersHandler,
    privateAccountsHandler,
    privateMeHandler,
    passkeyRegisterOptionsHandler,
    passkeyRegisterVerifyHandler,
    passkeyLoginOptionsHandler,
    passkeyLoginVerifyHandler,
    oidcProvidersHandler,
    oidcStartHandler,
    oidcFinishHandler,
    privateProfilesHandler,
    privateProfileSelectHandler,
    privateLibraryHandler,
    privateStorageHandler,
    privateDownloadsHandler,
    privateDownloadFileHandler,
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
