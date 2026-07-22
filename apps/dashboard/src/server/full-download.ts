import { createDecipheriv, webcrypto } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readdir, readFile, rename, stat, unlink, writeFile, rm } from "node:fs/promises";
import { basename, dirname, resolve, sep } from "node:path";
import { execFile, type ChildProcess } from "node:child_process";
import { request as httpsRequest } from "node:https";
import { resolvePlayerEmbedUrl, shouldResolvePlayerUrl } from "../../../server/src/player-resolver";

const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";
const PLAYBACK_FETCH_PROXY_TEMPLATE = process.env.PLAYBACK_FETCH_PROXY_TEMPLATE || process.env.IMPORT_FETCH_PROXY_TEMPLATE || "";
const PUBLIC_DNS_CACHE = new Map<string, { addresses: string[]; expiresAt: number }>();

export type FullDownloadState = "queued" | "resolving" | "downloading" | "completed" | "failed";

export type FullDownloadJob = {
  id: string;
  episodeId: string;
  state: FullDownloadState;
  percent: number;
  message: string;
  outputPath?: string;
  error?: string;
  createdAt: number;
  updatedAt: number;
};

export type CreateDownloadInput = {
  episodeId: string;
  showTitle: string;
  episodeTitle?: string | null;
  seasonNumber: number;
  episodeNumber: number | null;
  embedUrl: string;
  subtitlesUrl?: string;
  streamCandidates?: Array<{
    provider?: string;
    embedUrl: string;
    sourcePageUrl?: string;
    subtitlesUrl?: string;
    streamUrl?: string;
    resolvedUrl?: string;
  }>;
};

export type BrowserResolvedDownload = {
  downloadUrl: string;
  resolvedUrl: string;
  refererUrl: string;
};

export type CleanPlaybackResolveInput = CreateDownloadInput;

export type CleanPlaybackResolveResult = BrowserResolvedDownload;

export type PlaybackResolveInput = {
  episodeId: string;
  showTitle?: string;
  episodeTitle?: string | null;
  seasonNumber?: number;
  episodeNumber?: number | null;
  activePlayerAlias: string;
  players: Array<{
    alias: string;
    provider: string;
    label?: string;
    language?: string;
    sourcePageUrl?: string;
    embedUrl: string;
    subtitlesUrl?: string;
    streamUrl?: string;
    resolvedUrl?: string;
    streamType?: "hls" | "mp4" | "dash" | "embed" | "unknown";
    streamRefererUrl?: string;
    resolvedAt?: number;
  }>;
};

export type PlaybackResolveFailure = {
  playerAlias: string;
  provider: string;
  reason: string;
};

export type PlaybackResolveResult = {
  playerAlias: string;
  playbackUrl: string;
  resolvedUrl: string;
  refererUrl: string;
  streamType: "hls" | "mp4" | "dash" | "embed" | "unknown";
  subtitlesUrl?: string;
};

type PlaybackStreamType = PlaybackResolveResult["streamType"];

type ResolvedStreamTarget = {
  streamUrl: string;
  refererUrl: string;
};

type BrowserStreamCandidate = NonNullable<CreateDownloadInput["streamCandidates"]>[number];

function inferStreamType(value: string): PlaybackStreamType {
  if (/\/api\/download-full\/browser-file\?/i.test(value)) {
    try {
      const parsed = new URL(value, "http://localhost");
      const proxiedUrl = parsed.searchParams.get("url") ?? "";
      const name = parsed.searchParams.get("name") ?? "";
      if (/\.mp4(?:$|[?#])|\/get_video\?/i.test(proxiedUrl) || /\.mp4$/i.test(name)) return "mp4";
      if (/\.m3u8(?:$|[?#])|\/hls3\//i.test(proxiedUrl) || /\.m3u8$/i.test(name)) return "hls";
    } catch {
      return "unknown";
    }
  }
  if (/\.m3u8(?:$|[?#])|\/hls3\//i.test(value)) return "hls";
  if (/\.mp4(?:$|[?#])|\/get_video\?/i.test(value)) return "mp4";
  if (/\.mpd(?:$|[?#])/i.test(value)) return "dash";
  return "unknown";
}

function buildPlaybackProxyPath(streamUrl: string, refererUrl: string, episodeId: string, streamType = inferStreamType(streamUrl)) {
  const extension = streamType === "mp4" ? "mp4" : streamType === "dash" ? "mpd" : "m3u8";
  const name = `${sanitizeFilename(episodeId || "playback")}.${extension}`;
  const params = new URLSearchParams({
    url: streamUrl,
    name,
    referer: refererUrl,
    playback: "1",
  });
  return `/api/download-full/browser-file?${params.toString()}`;
}

function extractSubtitleUrlFromPlayerUrl(value: string | undefined) {
  if (!value) return undefined;
  try {
    const parsed = new URL(value);
    const candidates = [
      parsed.searchParams.get("sub"),
      parsed.searchParams.get("sub2"),
      parsed.searchParams.get("c1_file"),
      parsed.searchParams.get("c2_file"),
    ];
    for (const candidate of candidates) {
      if (!candidate?.trim()) continue;
      const subtitleUrl = new URL(candidate, parsed).toString();
      if (/^https?:\/\//i.test(subtitleUrl)) {
        return subtitleUrl;
      }
    }
  } catch {
    return undefined;
  }
  return undefined;
}

async function resolveSubtitleUrlFromPlayer(player: { subtitlesUrl?: string; embedUrl?: string; sourcePageUrl?: string }) {
  if (player.subtitlesUrl) {
    return player.subtitlesUrl;
  }

  const fromUrl = extractSubtitleUrlFromPlayerUrl(player.embedUrl);
  if (fromUrl) {
    return fromUrl;
  }

  if (!player.embedUrl || !isHqqUrl(player.embedUrl)) {
    return undefined;
  }

  const fetched = await fetchTextForResolution(player.embedUrl, player.sourcePageUrl, "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8").catch(() => null);
  if (!fetched) {
    return undefined;
  }

  const match = fetched.text.match(/src\s*:\s*["']([^"']+\.vtt[^"']*)["']/i) ??
    fetched.text.match(/["'](https?:\/\/[^"']+\.vtt[^"']*)["']/i);
  if (!match?.[1]) {
    return undefined;
  }

  try {
    return new URL(match[1], fetched.finalUrl || player.embedUrl).toString();
  } catch {
    return undefined;
  }
}

function buildFetchProxyUrl(targetUrl: string) {
  const template = PLAYBACK_FETCH_PROXY_TEMPLATE.trim();
  if (!template) {
    return null;
  }
  if (template.includes("{url}")) {
    return template.replace("{url}", encodeURIComponent(targetUrl));
  }
  const separator = template.includes("?") ? "&" : "?";
  return `${template}${separator}url=${encodeURIComponent(targetUrl)}`;
}

function shouldUsePublicDnsForResolution(value: string) {
  try {
    const host = new URL(value).hostname.toLowerCase();
    return (
      host === "vidmoly.net" ||
      host === "vidmoly.biz" ||
      host === "vidmoly.me" ||
      host.endsWith(".vidmoly.net") ||
      host.endsWith(".vidmoly.biz") ||
      host.endsWith(".vidmoly.me") ||
      host === "mixdrop.ag" ||
      host === "mixdrop.co" ||
      host === "mixdrop.to" ||
      host === "mixdrop.sx" ||
      host === "mixdrop.ps" ||
      host === "mixdrop.my" ||
      host === "miixdrop.net" ||
      host.endsWith(".miixdrop.net")
    );
  } catch {
    return false;
  }
}

async function resolvePublicDnsA(hostname: string) {
  const cached = PUBLIC_DNS_CACHE.get(hostname);
  if (cached && cached.expiresAt > Date.now() && cached.addresses.length > 0) {
    return cached.addresses;
  }

  const response = await fetch(`https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(hostname)}&type=A`, {
    headers: {
      accept: "application/dns-json",
      "user-agent": USER_AGENT,
    },
  });
  if (!response.ok) {
    throw new Error(`Public DNS lookup failed for ${hostname} (${response.status}).`);
  }
  const body = await response.json().catch(() => null) as {
    Answer?: Array<{ type?: number; TTL?: number; data?: string }>;
  } | null;
  const answers = (body?.Answer ?? [])
    .filter((answer) => answer.type === 1 && typeof answer.data === "string" && /^\d{1,3}(?:\.\d{1,3}){3}$/.test(answer.data))
    .map((answer) => ({
      address: answer.data as string,
      ttl: typeof answer.TTL === "number" && answer.TTL > 0 ? answer.TTL : 60,
    }));
  if (answers.length === 0) {
    throw new Error(`Public DNS did not return A records for ${hostname}.`);
  }
  PUBLIC_DNS_CACHE.set(hostname, {
    addresses: answers.map((answer) => answer.address),
    expiresAt: Date.now() + Math.min(...answers.map((answer) => answer.ttl)) * 1000,
  });
  return answers.map((answer) => answer.address);
}

async function fetchTextWithPublicDns(
  targetUrl: string,
  refererUrl: string | undefined,
  accept: string,
  depth = 0,
): Promise<{ text: string; finalUrl: string } | null> {
  if (depth > 5) {
    return null;
  }

  const parsed = new URL(targetUrl);
  if (parsed.protocol !== "https:") {
    return null;
  }

  const addresses = shouldUsePublicDnsForResolution(targetUrl) ? await resolvePublicDnsA(parsed.hostname) : [];
  let addressIndex = 0;

  return new Promise((resolvePromise) => {
    const req = httpsRequest(
      parsed,
      {
        method: "GET",
        headers: {
          "user-agent": USER_AGENT,
          accept,
          referer: refererUrl ?? targetUrl,
        },
        timeout: 15_000,
        lookup: addresses.length
          ? (_hostname, options, callback) => {
              if (options?.all) {
                callback(null, addresses.map((address) => ({ address, family: 4 })));
                return;
              }
              const address = addresses[addressIndex % addresses.length];
              addressIndex += 1;
              callback(null, address, 4);
            }
          : undefined,
      },
      (response) => {
        const statusCode = response.statusCode ?? 0;
        const location = response.headers.location;
        if (statusCode >= 300 && statusCode < 400 && location) {
          response.resume();
          const redirectedUrl = new URL(Array.isArray(location) ? location[0] : location, targetUrl).toString();
          void fetchTextWithPublicDns(redirectedUrl, targetUrl, accept, depth + 1).then(resolvePromise);
          return;
        }

        const chunks: Buffer[] = [];
        let total = 0;
        response.on("data", (chunk: Buffer) => {
          total += chunk.length;
          if (total <= 5 * 1024 * 1024) {
            chunks.push(chunk);
          } else {
            req.destroy(new Error("Vidmoly page response is too large."));
          }
        });
        response.on("end", () => {
          if (statusCode < 200 || statusCode >= 300) {
            resolvePromise(null);
            return;
          }
          resolvePromise({
            text: Buffer.concat(chunks).toString("utf8"),
            finalUrl: targetUrl,
          });
        });
      },
    );
    req.on("timeout", () => req.destroy(new Error("Vidmoly page request timed out.")));
    req.on("error", () => resolvePromise(null));
    req.end();
  });
}

async function readFetchProxyText(targetUrl: string, refererUrl?: string) {
  const proxyUrl = buildFetchProxyUrl(targetUrl);
  if (!proxyUrl) {
    return null;
  }

  const response = await fetch(proxyUrl, {
    headers: {
      "user-agent": USER_AGENT,
      accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8,application/json;q=0.6",
      referer: refererUrl ?? targetUrl,
      "x-target-url": targetUrl,
    },
    redirect: "follow",
  });

  if (!response.ok) {
    return null;
  }

  const contentType = response.headers.get("content-type") || "";
  if (/application\/json/i.test(contentType)) {
    const payload = await response.json().catch(() => null) as {
      html?: unknown;
      content?: unknown;
      body?: unknown;
      data?: { html?: unknown; content?: unknown; body?: unknown };
    } | null;
    const text = payload?.html ?? payload?.content ?? payload?.body ?? payload?.data?.html ?? payload?.data?.content ?? payload?.data?.body;
    return typeof text === "string" && text.trim() ? text : null;
  }

  return response.text();
}

async function fetchTextForResolution(url: string, refererUrl: string | undefined, accept: string) {
  if (shouldUsePublicDnsForResolution(url)) {
    const publicDnsText = await fetchTextWithPublicDns(url, refererUrl, accept).catch(() => null);
    if (publicDnsText) {
      return publicDnsText;
    }
  }

  const response = await fetch(url, {
    headers: {
      "user-agent": USER_AGENT,
      accept,
      referer: refererUrl ?? "https://www.bombuj.si/",
    },
    redirect: "follow",
  }).catch(() => null);

  if (response?.ok) {
    return {
      text: await response.text(),
      finalUrl: response.url || url,
    };
  }

  const proxyText = await readFetchProxyText(url, refererUrl);
  return proxyText ? { text: proxyText, finalUrl: url } : null;
}

function isHttpUrl(value: string) {
  try {
    const parsed = new URL(value);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

async function canUseEmbedFallback(embedUrl: string, refererUrl?: string) {
  if (!isHttpUrl(embedUrl) || /\.(?:m3u8|mp4|mpd)(?:$|[?#])/i.test(embedUrl)) {
    return false;
  }
  try {
    const response = await fetch(embedUrl, {
      method: "GET",
      redirect: "follow",
      headers: {
        "user-agent": USER_AGENT,
        accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        referer: refererUrl ?? embedUrl,
      },
    });
    if (!response.ok) {
      return false;
    }
    const contentType = response.headers.get("content-type") || "";
    return !contentType || /text\/html|application\/xhtml\+xml/i.test(contentType);
  } catch {
    return false;
  }
}

function getDirectStreamUrl(candidate: BrowserStreamCandidate) {
  const directUrl = candidate.streamUrl ?? candidate.resolvedUrl;
  if (typeof directUrl !== "string") {
    return null;
  }

  const trimmed = directUrl.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function isFreshSignedStreamUrl(value: string, minimumFreshSeconds = 90) {
  try {
    const parsed = new URL(value);
    const isStreamtapeSignedUrl = /(?:^|\.)streamtape\./i.test(parsed.hostname) && parsed.pathname === "/get_video";
    if (!isStreamtapeSignedUrl) {
      return true;
    }

    const expires = Number(parsed.searchParams.get("expires"));
    if (!Number.isFinite(expires) || expires <= 0) {
      return false;
    }

    return expires - Math.floor(Date.now() / 1000) > minimumFreshSeconds;
  } catch {
    return false;
  }
}

function isVolatileProviderStream(player: PlaybackResolveInput["players"][number], candidateEmbedUrl: string) {
  const signature = [
    player.provider,
    player.sourcePageUrl,
    player.embedUrl,
    candidateEmbedUrl,
  ].filter(Boolean).join(" ").toLowerCase();
  return /svetserialu|filemoon|vidmoly|streamtape|mixdrop|miixdrop|dood|voe|hqq|sb\d+|bombuj|2embed|xpass|multiembed|moviesclub|primewire|videasy|vidsrc/i.test(signature);
}

function canReuseDirectStreamUrl(player: PlaybackResolveInput["players"][number], candidateEmbedUrl: string, directUrl: string) {
  if (!isFreshSignedStreamUrl(directUrl)) {
    return false;
  }

  if (isVidkingPlayer(player.provider, candidateEmbedUrl)) {
    return false;
  }

  if (isVolatileProviderStream(player, candidateEmbedUrl)) {
    const signature = `${player.provider ?? ""} ${player.embedUrl} ${candidateEmbedUrl}`.toLowerCase();
    return /streamtape/.test(signature) && Boolean(player.resolvedAt && Date.now() - player.resolvedAt < 10 * 60 * 1000);
  }

  return true;
}

async function resolveCandidateEmbedUrl(candidate: {
  provider?: string;
  embedUrl: string;
  sourcePageUrl?: string;
}) {
  const embedUrl = candidate.embedUrl.trim();
  if (!embedUrl) {
    return null;
  }

  const sourcePageUrl = candidate.sourcePageUrl?.trim();
  if (sourcePageUrl && /streamtape/i.test(candidate.provider ?? embedUrl)) {
    try {
      const sourceResponse = await fetchTextForResolution(sourcePageUrl, sourcePageUrl, "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8");
      if (sourceResponse) {
        const refreshedEmbedUrl = extractSvetSerialuEmbedUrl(sourceResponse.text, sourceResponse.finalUrl || sourcePageUrl);
        if (refreshedEmbedUrl && /streamtape\./i.test(refreshedEmbedUrl)) {
          return refreshedEmbedUrl;
        }
      }
    } catch {
      // Fall back to the imported embed URL below.
    }
  }

  const aggregatorFallbackUrl = await getTwoEmbedFallbackUrlFromAggregator(candidate.provider, embedUrl);
  if (aggregatorFallbackUrl) {
    return aggregatorFallbackUrl;
  }

  if (!shouldResolvePlayerUrl(candidate.provider, embedUrl)) {
    return embedUrl;
  }

  try {
    return await resolvePlayerEmbedUrl({
      embedUrl,
      provider: candidate.provider,
    });
  } catch {
    return embedUrl;
  }
}

const tmdbImdbIdCache = new Map<string, { imdbId: string | null; expiresAt: number }>();

function parseMovieTmdbIdFromAggregatorUrl(embedUrl: string) {
  try {
    const parsed = new URL(embedUrl);
    const tmdbParam = parsed.searchParams.get("tmdb");
    if (tmdbParam && /^\d+$/.test(tmdbParam)) {
      return tmdbParam;
    }
    const match = parsed.pathname.match(/\/movie\/(\d+)(?:\/|$)/i);
    return match?.[1] ?? null;
  } catch {
    return null;
  }
}

async function fetchImdbIdForMovieTmdbId(tmdbId: string) {
  const cached = tmdbImdbIdCache.get(tmdbId);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.imdbId;
  }

  let imdbId: string | null = null;
  try {
    const response = await fetch(`https://db.videasy.to/3/movie/${encodeURIComponent(tmdbId)}?append_to_response=external_ids`, {
      headers: {
        "user-agent": USER_AGENT,
        accept: "application/json,*/*",
        referer: "https://player.videasy.to/",
      },
      redirect: "follow",
    });
    if (response.ok) {
      const payload = await response.json().catch(() => null) as { imdb_id?: unknown; external_ids?: { imdb_id?: unknown } } | null;
      const rawImdbId = payload?.imdb_id ?? payload?.external_ids?.imdb_id;
      imdbId = typeof rawImdbId === "string" && /^tt\d{5,10}$/i.test(rawImdbId) ? rawImdbId : null;
    }
  } catch {
    imdbId = null;
  }

  tmdbImdbIdCache.set(tmdbId, {
    imdbId,
    expiresAt: Date.now() + 12 * 60 * 60 * 1000,
  });
  return imdbId;
}

async function getTwoEmbedFallbackUrlFromAggregator(provider: string | undefined, embedUrl: string) {
  const signature = `${provider ?? ""} ${embedUrl}`.toLowerCase();
  if (!/(?:vidsrc|vidstream|vidlink|multiembed|moviesclub|primewire|embed\.su|^embed\b)/i.test(signature) || isTwoEmbedUrl(embedUrl)) {
    return null;
  }

  const imdbId = embedUrl.match(/\btt\d{5,10}\b/i)?.[0];
  if (imdbId) {
    return `https://www.2embed.cc/embed/${imdbId}`;
  }

  const tmdbId = parseMovieTmdbIdFromAggregatorUrl(embedUrl);
  if (!tmdbId) {
    return null;
  }

  const imdbIdFromTmdb = await fetchImdbIdForMovieTmdbId(tmdbId);
  return imdbIdFromTmdb ? `https://www.2embed.cc/embed/${imdbIdFromTmdb}` : null;
}

function toValidatedHttpUrl(value: string) {
  const parsed = new URL(value);
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("Resolved stream has unsupported protocol.");
  }

  return parsed.toString();
}

const jobs = new Map<string, FullDownloadJob>();
const activeFfmpegProcesses = new Map<string, ChildProcess>();
const activeOutputPaths = new Map<string, { outputPath: string; temporaryOutputPath: string; episodeId: string }>();
const cancelRequestedJobs = new Set<string>();
const seekableRepairLocks = new Map<string, Promise<string>>();
const seekableRepairCache = new Map<string, string>();
const DOWNLOAD_INDEX_FILE = "index.json";
const SUBTITLE_INDEX_FILE = "subtitles.json";

type DownloadIndex = Record<string, string>;
type SubtitleEntry = {
  fileName: string;
  label: string;
  language?: string;
};
type SubtitleIndex = Record<string, SubtitleEntry[]>;

function now() {
  return Date.now();
}

function createJob(episodeId: string): FullDownloadJob {
  const id = `${episodeId}:${now()}:${Math.random().toString(16).slice(2, 8)}`;
  const job: FullDownloadJob = {
    id,
    episodeId,
    state: "queued",
    percent: 0,
    message: "Queued",
    createdAt: now(),
    updatedAt: now(),
  };
  jobs.set(id, job);
  return job;
}

function updateJob(job: FullDownloadJob, patch: Partial<FullDownloadJob>) {
  const next = { ...job, ...patch, updatedAt: now() };
  jobs.set(job.id, next);
  return next;
}

function isActiveDownloadState(state: FullDownloadState) {
  return state === "queued" || state === "resolving" || state === "downloading";
}

function isCancelRequested(jobId: string) {
  return cancelRequestedJobs.has(jobId);
}

function ensureNotCanceled(jobId: string) {
  if (isCancelRequested(jobId)) {
    throw new Error("Download canceled by user.");
  }
}

function sanitizeFilename(value: string) {
  return value
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 150);
}

function getDownloadsFolder() {
  const envPath = process.env.SPILLED_VAULT_PATH;
  if (envPath) {
    const resolved = resolve(envPath);
    console.log(`[VAULT] Using SPILLED_VAULT_PATH: ${resolved}`);
    return resolved;
  }

  const localFolder = resolve(process.cwd(), "downloads");
  const parentFolder = resolve(process.cwd(), "..", "downloads");
  const repoFolder = resolve(process.cwd(), "..", "..", "downloads");

  if (existsSync(localFolder)) {
    return localFolder;
  }
  if (existsSync(parentFolder)) {
    return parentFolder;
  }
  if (existsSync(repoFolder)) {
    return repoFolder;
  }
  return repoFolder;
}

function getDownloadIndexPath() {
  return resolve(getDownloadsFolder(), DOWNLOAD_INDEX_FILE);
}

function getSubtitlesFolder() {
  return resolve(getDownloadsFolder(), "subtitles");
}

function getSubtitleIndexPath() {
  return resolve(getSubtitlesFolder(), SUBTITLE_INDEX_FILE);
}

function sanitizeEpisodeId(value: string) {
  return value.replace(/[^a-zA-Z0-9_-]+/g, "_").slice(0, 80);
}

function sanitizeSubtitleLabel(value: string) {
  return value.replace(/[^a-zA-Z0-9_-]+/g, "_").slice(0, 40).toLowerCase() || "subtitle";
}

async function readDownloadIndex(): Promise<DownloadIndex> {
  try {
    const text = await readFile(getDownloadIndexPath(), "utf8");
    const parsed = JSON.parse(text) as DownloadIndex;
    if (!parsed || typeof parsed !== "object") {
      return {};
    }
    return parsed;
  } catch {
    return {};
  }
}

async function writeDownloadIndex(index: DownloadIndex) {
  await mkdir(getDownloadsFolder(), { recursive: true });
  await writeFile(getDownloadIndexPath(), JSON.stringify(index, null, 2), "utf8");
}

async function readSubtitleIndex(): Promise<SubtitleIndex> {
  try {
    const text = await readFile(getSubtitleIndexPath(), "utf8");
    const parsed = JSON.parse(text) as SubtitleIndex;
    if (!parsed || typeof parsed !== "object") {
      return {};
    }
    return parsed;
  } catch {
    return {};
  }
}

async function writeSubtitleIndex(index: SubtitleIndex) {
  await mkdir(getSubtitlesFolder(), { recursive: true });
  await writeFile(getSubtitleIndexPath(), JSON.stringify(index, null, 2), "utf8");
}

function base64UrlToBuffer(value: string) {
  const pad = "===".slice((value.length + 3) % 4);
  return Buffer.from(value.replace(/-/g, "+").replace(/_/g, "/") + pad, "base64");
}

function bufferToBase64Url(value: ArrayBuffer | Uint8Array) {
  return Buffer.from(value instanceof Uint8Array ? value : new Uint8Array(value))
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function decryptAesGcmPayload(ivB64u: string, payloadB64u: string, key: Buffer) {
  const iv = base64UrlToBuffer(ivB64u);
  const payload = base64UrlToBuffer(payloadB64u);
  const tag = payload.subarray(payload.length - 16);
  const ciphertext = payload.subarray(0, payload.length - 16);

  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  const plain = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  return JSON.parse(plain.toString("utf8")) as { sources?: Array<{ url?: string; file?: string }> };
}

function resolveByseKeyParts(payload: { key_parts?: string[]; version?: string }) {
  const keyParts = Array.isArray(payload.key_parts) ? payload.key_parts : [];
  const version = typeof payload.version === "string" ? Number.parseInt(payload.version.trim(), 10) : Number.NaN;
  if (Number.isInteger(version) && version >= 1 && version <= 20) {
    const indexes = [version, 31 - version];
    const selected = indexes
      .map((index) => keyParts[index - 1])
      .filter((value): value is string => typeof value === "string" && value.length > 0);
    if (selected.length > 0) {
      const selectedKey = Buffer.concat(selected.map((value) => base64UrlToBuffer(value)));
      if (selectedKey.length === 16 || selectedKey.length === 24 || selectedKey.length === 32) {
        return selectedKey;
      }
    }
  }

  const key = Buffer.concat(keyParts.map((value) => base64UrlToBuffer(value)));
  return key.length === 16 || key.length === 24 || key.length === 32 ? key : null;
}

function splitByPlus(expression: string) {
  const chunks: string[] = [];
  let current = "";
  let quote: "'" | '"' | null = null;
  let escapeNext = false;
  let parenDepth = 0;

  for (const ch of expression) {
    if (escapeNext) {
      current += ch;
      escapeNext = false;
      continue;
    }

    if (ch === "\\") {
      current += ch;
      escapeNext = true;
      continue;
    }

    if (quote) {
      current += ch;
      if (ch === quote) quote = null;
      continue;
    }

    if (ch === "'" || ch === '"') {
      current += ch;
      quote = ch;
      continue;
    }

    if (ch === "(") {
      parenDepth += 1;
      current += ch;
      continue;
    }

    if (ch === ")") {
      parenDepth = Math.max(0, parenDepth - 1);
      current += ch;
      continue;
    }

    if (ch === "+" && parenDepth === 0) {
      chunks.push(current.trim());
      current = "";
      continue;
    }

    current += ch;
  }

  if (current.trim()) chunks.push(current.trim());
  return chunks;
}

function unquoteStringLiteral(value: string) {
  const trimmed = value.trim();
  if (trimmed.length < 2) return null;
  const first = trimmed[0];
  const last = trimmed.at(-1);
  if (!((first === "'" && last === "'") || (first === '"' && last === '"'))) {
    return null;
  }

  const inner = trimmed.slice(1, -1);
  return inner
    .replace(/\\\\/g, "\\")
    .replace(/\\'/g, "'")
    .replace(/\\"/g, '"')
    .replace(/\\n/g, "\n")
    .replace(/\\r/g, "\r")
    .replace(/\\t/g, "\t");
}

function evalStringPart(part: string) {
  const direct = unquoteStringLiteral(part);
  if (direct !== null) return direct;

  const normalized = part.trim();
  const complexMatch = normalized.match(/^\((['"])((?:\\.|(?!\1).)*)\1\)((?:\.substring\(\d+\))+)$/);
  if (!complexMatch) return null;

  const [, quoteChar, rawInner, substringChain] = complexMatch;
  const unescaped = unquoteStringLiteral(`${quoteChar}${rawInner}${quoteChar}`);
  if (unescaped === null) return null;

  let out = unescaped;
  for (const sub of substringChain.matchAll(/\.substring\((\d+)\)/g)) {
    const index = Number(sub[1]);
    out = out.substring(index);
  }
  return out;
}

function evaluateConcatExpression(expression: string) {
  const parts = splitByPlus(expression);
  if (!parts.length) return null;

  let out = "";
  for (const part of parts) {
    const evaluated = evalStringPart(part);
    if (evaluated === null) return null;
    out += evaluated;
  }

  return out;
}

function normalizeStreamtapeMediaUrl(value: string) {
  const trimmed = value.trim();
  if (!trimmed.includes("/get_video?")) return null;

  if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) return trimmed;
  if (trimmed.startsWith("//")) return `https:${trimmed}`;
  if (trimmed.startsWith("/get_video?")) return `https://streamtape.com${trimmed}`;
  if (trimmed.startsWith("/")) return `https:/${trimmed}`;
  return `https://${trimmed}`;
}

function unpackDeanEdwardsPacker(source: string) {
  const match =
    source.match(
      /eval\(function\(p,a,c,k,e,d\)\{[\s\S]*?\}\('([\s\S]*?)',\s*(\d+),\s*(\d+),\s*'([\s\S]*?)'\.split\('\|'\)/,
    ) ??
    source.match(
      /eval\s*\(\s*function\s*\(\s*p\s*,\s*a\s*,\s*c\s*,\s*k\s*,\s*e\s*,\s*d\s*\)\s*\{[\s\S]*?\}\s*\(\s*['"]([\s\S]*?)['"]\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*['"]([\s\S]*?)['"]\s*\.split\s*\(\s*['"]\|['"]\s*\)/,
    );
  if (!match) {
    return null;
  }

  const [, packedPayload, baseRaw, countRaw, dictionaryRaw] = match;
  const base = Number.parseInt(baseRaw, 10);
  const count = Number.parseInt(countRaw, 10);
  const dictionary = dictionaryRaw.split("|");
  if (!Number.isFinite(base) || !Number.isFinite(count) || dictionary.length === 0) {
    return null;
  }

  let unpacked = packedPayload
    .replace(/\\\\/g, "\\")
    .replace(/\\'/g, "'")
    .replace(/\\"/g, '"');

  for (let index = count - 1; index >= 0; index -= 1) {
    const replacement = dictionary[index];
    if (!replacement) {
      continue;
    }
    const token = index.toString(base);
    unpacked = unpacked.replace(new RegExp(`\\b${token}\\b`, "g"), replacement);
  }

  return unpacked;
}

function findMediaUrlInText(text: string, baseUrl?: string) {
  const normalizedText = text
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\\\//g, "/")
    .replace(/\\u0026/g, "&")
    .replace(/&amp;/g, "&");

  const lookMovieHlsTextMatch = normalizedText.match(/https?:\/\/[^\s"'<>]+\/hls3\/[^\s"'<>]+\/master\.txt[^\s"'<>]*/i);
  if (lookMovieHlsTextMatch?.[0]) {
    return normalizeKnownStreamUrl(lookMovieHlsTextMatch[0], baseUrl);
  }

  const protocolRelativeMediaMatch = normalizedText.match(/\/\/[^\s"'<>]+\.(?:m3u8|mp4|mpd)(?:[?#][^\s"'<>]*)?/i);
  if (protocolRelativeMediaMatch?.[0]) {
    return normalizeKnownStreamUrl(protocolRelativeMediaMatch[0], baseUrl);
  }

  const sameSiteStreamMatch = normalizedText.match(/["']?(\/stream\/[^"'\s<>]+\.m3u8[^"'\s<>]*)["']?/i);
  if (sameSiteStreamMatch?.[1]) {
    return normalizeKnownStreamUrl(sameSiteStreamMatch[1], baseUrl);
  }

  const sameSiteMediaMatch = normalizedText.match(/["'](\/[^"']+\.(?:m3u8|mp4|mpd)(?:[?#][^"']*)?)["']/i);
  if (sameSiteMediaMatch?.[1]) {
    return normalizeKnownStreamUrl(sameSiteMediaMatch[1], baseUrl);
  }

  const directMp4Match = normalizedText.match(/https?:\/\/[^\s"'<>]+\.mp4[^\s"'<>]*/i);
  if (directMp4Match?.[0]) {
    return normalizeKnownStreamUrl(directMp4Match[0], baseUrl);
  }

  const filePropertyMatch =
    normalizedText.match(/\b(?:file|src|url|wurl|videoUrl|hls|dash)\b\s*[:=]\s*['"]([^'"]+\.(?:m3u8|mp4|mpd)[^'"]*)['"]/i) ??
    normalizedText.match(/["'](?:file|src|url|wurl|videoUrl|hls|dash)["']\s*:\s*["']([^"']+\.(?:m3u8|mp4|mpd)[^"']*)["']/i);
  if (filePropertyMatch?.[1]) {
    return normalizeKnownStreamUrl(filePropertyMatch[1], baseUrl);
  }

  const sourcesBlockMatch = normalizedText.match(/sources\s*:\s*\[([\s\S]*?)\]/i);
  if (sourcesBlockMatch?.[1]) {
    const sourceMatch = sourcesBlockMatch[1].match(/(?:file|src|url)\s*:\s*['"]([^'"]+\.(?:m3u8|mp4|mpd)[^'"]*)['"]/i);
    if (sourceMatch?.[1]) {
      return normalizeKnownStreamUrl(sourceMatch[1], baseUrl);
    }
  }

  const mediaUrlMatch = normalizedText.match(/https?:\/\/[^\s"'<>]+\.(?:m3u8|mp4|mpd)(?:[?#][^\s"'<>]*)?/i);
  if (mediaUrlMatch?.[0]) {
    return normalizeKnownStreamUrl(mediaUrlMatch[0], baseUrl);
  }

  return null;
}

function decodeObfuscatedMediaText(text: string) {
  const candidates = new Set<string>();
  candidates.add(text);

  for (const match of text.matchAll(/\\x([0-9a-f]{2})/gi)) {
    if (match[0]) {
      candidates.add(text.replace(/\\x([0-9a-f]{2})/gi, (_all, hex) => String.fromCharCode(Number.parseInt(hex, 16))));
      break;
    }
  }

  for (const match of text.matchAll(/(?:atob|Base64\.decode)\(\s*['"]([A-Za-z0-9+/=]{24,})['"]\s*\)/g)) {
    try {
      candidates.add(Buffer.from(match[1], "base64").toString("utf8"));
    } catch {
      // Ignore malformed base64 blobs.
    }
  }

  for (const match of text.matchAll(/['"]([A-Za-z0-9+/=]{48,})['"]/g)) {
    try {
      const decoded = Buffer.from(match[1], "base64").toString("utf8");
      if (/\.(?:m3u8|mp4|mpd)|sources|file|wurl/i.test(decoded)) {
        candidates.add(decoded);
      }
    } catch {
      // Ignore non-base64 strings.
    }
  }

  return Array.from(candidates);
}

function rot13(value: string) {
  return value.replace(/[a-z]/gi, (character) => {
    const code = character.charCodeAt(0);
    const base = code <= 90 ? 65 : 97;
    return String.fromCharCode(base + ((code - base + 13) % 26));
  });
}

function decodeVoeConfig(value: string): { source?: unknown } | null {
  try {
    const markerFree = ["@$", "^^", "~@", "%?", "*~", "!!", "#&"]
      .reduce((decoded, marker) => decoded.replaceAll(marker, ""), rot13(value));
    const firstLayer = Buffer.from(markerFree, "base64");
    if (firstLayer.length === 0 || firstLayer.some((byte) => byte < 3)) {
      return null;
    }

    const reversedBase64 = Buffer.from(
      Uint8Array.from(firstLayer, (byte) => byte - 3).reverse(),
    ).toString("utf8");
    const decodedJson = Buffer.from(reversedBase64, "base64").toString("utf8");
    const parsed = JSON.parse(decodedJson) as unknown;
    return parsed && typeof parsed === "object" ? parsed as { source?: unknown } : null;
  } catch {
    return null;
  }
}

function extractVoeObfuscatedStream(html: string) {
  const scripts = html.matchAll(
    /<script\b(?=[^>]*\btype\s*=\s*["']application\/json["'])[^>]*>([\s\S]*?)<\/script>/gi,
  );
  for (const match of scripts) {
    try {
      const values = JSON.parse(match[1]) as unknown;
      if (!Array.isArray(values)) continue;
      for (const value of values) {
        if (typeof value !== "string") continue;
        const config = decodeVoeConfig(value);
        if (typeof config?.source === "string" && isHttpUrl(config.source)) {
          return config.source;
        }
      }
    } catch {
      // Continue with the other application/json blocks.
    }
  }
  return null;
}

function findMediaUrlInDecodedText(text: string, baseUrl?: string) {
  for (const candidate of decodeObfuscatedMediaText(text)) {
    const mediaUrl = findMediaUrlInText(candidate, baseUrl);
    if (mediaUrl) {
      return mediaUrl;
    }
  }
  return null;
}

function normalizeKnownStreamUrl(value: string, baseUrl?: string) {
  let normalized = value
    .trim()
    .replace(/&amp;/g, "&");

  if (normalized.startsWith("//")) {
    normalized = `https:${normalized}`;
  } else if (baseUrl && normalized.startsWith("/")) {
    try {
      normalized = new URL(normalized, baseUrl).toString();
    } catch {
      return normalized;
    }
  }

  return normalized.replace(/https?:\/\/([a-z0-9-]+)\.\{v\d+\}/gi, "https://$1.cloudnestra.com");
}

function isKnownPlaceholderStream(url: string) {
  return /test-videos\.co\.uk|big_buck_bunny|127\.0\.0\.1\/no_video|localhost\/no_video/i.test(url);
}

async function resolvePreferredHlsVariant(streamUrl: string, refererUrl: string, preferVariant = true) {
  if (!preferVariant || !/\.m3u8(?:$|[?#])|\/hls3\/[^\s"'<>]+\.txt(?:$|[?#])/i.test(streamUrl)) {
    return streamUrl;
  }

  try {
    const response = await fetch(streamUrl, {
      headers: {
        "user-agent": USER_AGENT,
        accept: "*/*",
        referer: refererUrl,
      },
      redirect: "follow",
    });

    if (!response.ok) {
      return streamUrl;
    }

    const body = await response.text();
    if (!body.startsWith("#EXTM3U") || !body.includes("#EXT-X-STREAM-INF")) {
      return streamUrl;
    }

    const lines = body
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);

    const variants: Array<{ bandwidth: number; url: string }> = [];
    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index];
      if (!line.startsWith("#EXT-X-STREAM-INF")) {
        continue;
      }

      const bandwidth = Number.parseInt(line.match(/BANDWIDTH=(\d+)/i)?.[1] ?? "0", 10);
      const nextLine = lines[index + 1];
      if (!nextLine || nextLine.startsWith("#")) {
        continue;
      }

      try {
        const variantUrl = new URL(nextLine, response.url || streamUrl).toString();
        if (/ad-site|\.image(?:[?#]|$)|\.(?:png|jpe?g|webp|gif)(?:[?#]|$)/i.test(variantUrl)) {
          continue;
        }
        variants.push({
          bandwidth: Number.isFinite(bandwidth) ? bandwidth : 0,
          url: variantUrl,
        });
      } catch {
        continue;
      }
    }

    if (variants.length === 0) {
      return streamUrl;
    }

    variants.sort((left, right) => right.bandwidth - left.bandwidth);
    return variants[0].url;
  } catch {
    return streamUrl;
  }
}

function streamTypeFromContentType(contentType: string): PlaybackStreamType {
  if (/mpegurl|application\/vnd\.apple\.mpegurl|application\/x-mpegurl/i.test(contentType)) return "hls";
  if (/dash\+xml/i.test(contentType)) return "dash";
  if (/video\/mp4|application\/mp4/i.test(contentType)) return "mp4";
  return "unknown";
}

function isClearlyNonMediaStreamUrl(value: string) {
  try {
    const parsed = new URL(value);
    return /\.(?:avif|bmp|gif|ico|jpe?g|png|svg|webp)(?:$|[?#])/i.test(parsed.pathname);
  } catch {
    return true;
  }
}

type StreamValidationResult =
  | { ok: true; streamType: PlaybackStreamType }
  | { ok: false; reason: string };

function firstHlsResourceUrl(playlist: string, playlistUrl: string) {
  const resource = playlist
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => line && !line.startsWith("#"));
  if (!resource) return null;
  try {
    return new URL(resource, playlistUrl).toString();
  } catch {
    return null;
  }
}

async function validateHlsResources(
  response: Response,
  target: ResolvedStreamTarget,
  signal: AbortSignal,
): Promise<StreamValidationResult> {
  let playlistResponse = response;
  let playlistUrl = response.url || target.streamUrl;

  for (let depth = 0; depth < 2; depth += 1) {
    const playlist = await playlistResponse.text();
    if (!/^\s*#EXTM3U/i.test(playlist)) {
      return { ok: false, reason: `Resolved HLS URL on ${new URL(playlistUrl).hostname} did not return an HLS playlist.` };
    }

    const resourceUrl = firstHlsResourceUrl(playlist, playlistUrl);
    if (!resourceUrl) return { ok: true, streamType: "hls" };
    const resourceResponse = await fetch(resourceUrl, {
      method: "GET",
      headers: {
        "user-agent": USER_AGENT,
        accept: "*/*",
        referer: target.refererUrl,
      },
      redirect: "follow",
      signal,
    });
    const resourceHost = new URL(resourceUrl).hostname;
    if (!resourceResponse.ok && resourceResponse.status !== 206) {
      await resourceResponse.body?.cancel().catch(() => undefined);
      return { ok: false, reason: `Resolved HLS media resource on ${resourceHost} returned HTTP ${resourceResponse.status}.` };
    }

    if (/#EXT-X-STREAM-INF/i.test(playlist)) {
      playlistResponse = resourceResponse;
      playlistUrl = resourceResponse.url || resourceUrl;
      continue;
    }

    const contentType = resourceResponse.headers.get("content-type") ?? "";
    await resourceResponse.body?.cancel().catch(() => undefined);
    const xpassDisguisedSegment = /play\.xpass\.top/i.test(target.refererUrl)
      && /\/page-\d+\.html(?:$|[?#])/i.test(resourceUrl);
    if (/^(?:image|font)\//i.test(contentType) || (!xpassDisguisedSegment && /text\/html|application\/(?:xhtml\+xml|json)/i.test(contentType))) {
      return { ok: false, reason: `Resolved HLS media resource on ${resourceHost} returned ${contentType || "non-media content"}.` };
    }
    return { ok: true, streamType: "hls" };
  }

  return { ok: true, streamType: "hls" };
}

async function validateResolvedStream(target: ResolvedStreamTarget): Promise<StreamValidationResult> {
  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    Number.parseInt(process.env.SPILLED_STREAM_VALIDATE_TIMEOUT_MS || "7000", 10),
  );
  const host = new URL(target.streamUrl).hostname;

  try {
    if (isClearlyNonMediaStreamUrl(target.streamUrl)) {
      return { ok: false, reason: `Resolved URL on ${host} points to artwork instead of playable media.` };
    }
    const streamType = inferStreamType(target.streamUrl);
    const response = await fetch(target.streamUrl, {
      method: "GET",
      headers: {
        "user-agent": USER_AGENT,
        accept: streamType === "hls" ? "application/vnd.apple.mpegurl,application/x-mpegURL,text/plain,*/*" : "*/*",
        referer: target.refererUrl,
        ...(streamType === "mp4" || streamType === "unknown" ? { range: "bytes=0-4095" } : {}),
      },
      redirect: "follow",
      signal: controller.signal,
    });
    if (response.ok || response.status === 206) {
      const contentType = response.headers.get("content-type") ?? "";
      if (/^(?:image|font)\//i.test(contentType) || /text\/html|application\/(?:xhtml\+xml|json)/i.test(contentType)) {
        await response.body?.cancel().catch(() => undefined);
        return { ok: false, reason: `Resolved URL on ${host} returned ${contentType || "non-media content"} instead of playable media.` };
      }
      const detectedType = streamTypeFromContentType(contentType);
      if (streamType === "hls" || detectedType === "hls") {
        return await validateHlsResources(response, target, controller.signal);
      }
      await response.body?.cancel().catch(() => undefined);
      return { ok: true, streamType: detectedType !== "unknown" ? detectedType : streamType };
    }
    await response.body?.cancel().catch(() => undefined);
    return { ok: false, reason: `Resolved stream host ${host} returned HTTP ${response.status}.` };
  } catch (error) {
    const cause = error instanceof Error && "cause" in error ? error.cause : null;
    const code = cause && typeof cause === "object" && "code" in cause ? String(cause.code) : null;
    return {
      ok: false,
      reason: `Resolved stream host ${host} is not reachable by the playback proxy${code ? ` (${code})` : ""}.`,
    };
  } finally {
    clearTimeout(timeout);
  }
}

function extractScriptRedirectUrl(text: string, baseUrl: string) {
  const redirectMatch =
    text.match(/window\.location(?:\.href)?\s*=\s*['"]([^'"]+)['"]/i) ??
    text.match(/location\.replace\(\s*['"]([^'"]+)['"]\s*\)/i);

  if (!redirectMatch?.[1]) {
    return null;
  }

  try {
    return new URL(redirectMatch[1], baseUrl).toString();
  } catch {
    return null;
  }
}

function extractIframeUrl(text: string, baseUrl: string) {
  const iframeMatch =
    text.match(/<iframe[^>]+\bdata-src=["']([^"']+)["']/i) ??
    text.match(/<iframe[^>]+(?:src|data-src)=["']([^"']+)["']/i) ??
    text.match(/\b(?:src|data-src)=["']([^"']+)["'][^>]*>\s*<\/iframe>/i);
  if (!iframeMatch?.[1]) {
    return null;
  }

  if (/^(?:about:blank|javascript:)/i.test(iframeMatch[1])) {
    return null;
  }

  try {
    return new URL(iframeMatch[1], baseUrl).toString();
  } catch {
    return null;
  }
}

function isTwoEmbedUrl(value: string) {
  try {
    const host = new URL(value).hostname.toLowerCase();
    return /(^|\.)2embed\./i.test(host) || host === "streamsrcs.2embed.cc" || host.endsWith(".streamsrcs.2embed.cc");
  } catch {
    return false;
  }
}

function isHqqUrl(value: string) {
  try {
    const host = new URL(value).hostname.toLowerCase();
    return host === "hqq.to" || host.endsWith(".hqq.to");
  } catch {
    return false;
  }
}

function extractTwoEmbedChildUrls(text: string, baseUrl: string) {
  const urls = new Set<string>();
  const patterns = [
    /\bdata-src=["']([^"']+)["']/gi,
    /\bgo\(\s*["']([^"']+)["']\s*\)/gi,
  ];

  for (const pattern of patterns) {
    for (const match of text.matchAll(pattern)) {
      const value = match[1]?.trim();
      if (!value) continue;
      try {
        urls.add(new URL(value, baseUrl).toString());
      } catch {
        // Ignore malformed child URLs.
      }
    }
  }

  return Array.from(urls).sort((left, right) => {
    const score = (url: string) => {
      if (/\/xps\?/i.test(url)) return 0;
      if (/\/vesy\?/i.test(url)) return 1;
      if (/\/vsrc\?/i.test(url)) return 2;
      return 3;
    };
    return score(left) - score(right);
  });
}

function extractTwoEmbedScriptTarget(scriptText: string, iframeUrl: string, scriptUrl: string) {
  const prefixMatch =
    scriptText.match(/["'](https:\/\/play\.xpass\.top\/e\/movie\/)["']\s*\+\s*myUrl/i) ??
    scriptText.match(/["'](https:\/\/player\.videasy\.to\/movie\/)["']\s*\+\s*myUrl/i) ??
    scriptText.match(/["'](https:\/\/vidsrc-embed\.ru\/embed\/movie\/)["']\s*\+\s*myUrl/i) ??
    scriptText.match(/["'](https:\/\/lookmovie2\.skin\/e\/)["']\s*\+\s*myUrl/i);

  if (!prefixMatch?.[1]) {
    return null;
  }

  try {
    const resolvedIframeUrl = new URL(iframeUrl, scriptUrl).toString();
    const iframePath = `${new URL(resolvedIframeUrl).pathname.replace(/^\/+/, "")}${new URL(resolvedIframeUrl).search}`;
    return `${prefixMatch[1]}${iframePath}`;
  } catch {
    return null;
  }
}

function extractXpassPlaylistUrls(text: string, baseUrl: string) {
  const urls = new Set<string>();
  for (const match of text.matchAll(/["'](?:playlist|url)["']\s*:\s*["']([^"']+playlist\.json[^"']*)["']/gi)) {
    const value = match[1]?.trim();
    if (!value) continue;
    try {
      urls.add(new URL(value, baseUrl).toString());
    } catch {
      // Ignore malformed playlist URLs.
    }
  }
  for (const match of text.matchAll(/\bplaylist\s*:\s*["']([^"']+playlist\.json[^"']*)["']/gi)) {
    const value = match[1]?.trim();
    if (!value) continue;
    try {
      urls.add(new URL(value, baseUrl).toString());
    } catch {
      // Ignore malformed playlist URLs.
    }
  }
  return Array.from(urls).sort((left, right) => {
    const score = (value: string) => /\/vip\//i.test(value) ? 0 : /\/mdata\//i.test(value) ? 2 : 1;
    return score(left) - score(right);
  });
}

async function resolveXpassPlaylistStream(embedUrl: string, html: string, finalUrl: string): Promise<ResolvedStreamTarget | null> {
  for (const playlistUrl of extractXpassPlaylistUrls(html, finalUrl)) {
    const playlistResponse = await fetch(playlistUrl, {
      headers: {
        "user-agent": USER_AGENT,
        accept: "application/json,text/plain,*/*",
        referer: finalUrl,
      },
      redirect: "follow",
    }).catch(() => null);
    if (!playlistResponse?.ok) {
      continue;
    }

    const playlistText = await playlistResponse.text();
    const playlistFinalUrl = playlistResponse.url || playlistUrl;
    const streamUrl = findMediaUrlInDecodedText(playlistText, playlistFinalUrl);
    if (streamUrl && !isKnownPlaceholderStream(streamUrl)) {
      return {
        // Keep adaptive Xpass masters intact so phones can start at a lower
        // rendition instead of being pinned to the largest video stream.
        streamUrl,
        refererUrl: embedUrl,
      };
    }
  }

  return null;
}

async function resolveTwoEmbedStream(embedUrl: string, depth = 0, visited = new Set<string>()): Promise<ResolvedStreamTarget | null> {
  if (!isTwoEmbedUrl(embedUrl) || visited.has(embedUrl) || depth > 5) {
    return null;
  }
  visited.add(embedUrl);

  const fetched = await fetchTextForResolution(embedUrl, "https://www.2embed.cc/", "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8");
  if (!fetched) {
    return null;
  }

  const html = fetched.text;
  const finalUrl = fetched.finalUrl || embedUrl;
  const direct = findMediaUrlInDecodedText(html, finalUrl);
  if (direct && !isKnownPlaceholderStream(direct)) {
    return { streamUrl: await resolvePreferredHlsVariant(direct, finalUrl), refererUrl: finalUrl };
  }

  if (/play\.xpass\.top/i.test(finalUrl)) {
    const xpass = await resolveXpassPlaylistStream(finalUrl, html, finalUrl);
    if (xpass) {
      return xpass;
    }
  }

  for (const childUrl of extractTwoEmbedChildUrls(html, finalUrl)) {
    const nested = await resolveTwoEmbedStream(childUrl, depth + 1, visited);
    if (nested) {
      return nested;
    }
  }

  const iframeUrl = extractIframeUrl(html, finalUrl);
  for (const scriptUrl of extractScriptUrls(html, finalUrl)) {
    const scriptResponse = await fetchTextForResolution(scriptUrl, finalUrl, "application/javascript,text/javascript,*/*;q=0.8");
    if (!scriptResponse) {
      continue;
    }

    const targetUrl = iframeUrl ? extractTwoEmbedScriptTarget(scriptResponse.text, iframeUrl, scriptResponse.finalUrl || scriptUrl) : null;
    if (!targetUrl || visited.has(targetUrl)) {
      continue;
    }

    if (/play\.xpass\.top/i.test(targetUrl)) {
      const targetResponse = await fetchTextForResolution(targetUrl, finalUrl, "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8");
      if (targetResponse) {
        const xpass = await resolveXpassPlaylistStream(targetUrl, targetResponse.text, targetResponse.finalUrl || targetUrl);
        if (xpass) {
          return xpass;
        }
      }
    }

    const nested = await resolveStreamTarget(targetUrl, depth + 1, visited, finalUrl);
    if (nested) {
      return nested;
    }
  }

  return null;
}

function getAlternateProviderUrls(embedUrl: string) {
  const urls: string[] = [];
  try {
    const parsed = new URL(embedUrl);
    const host = parsed.hostname.toLowerCase();
    if (/(^|\.)mixdrop\./i.test(host)) {
      for (const domain of ["mixdrop.co", "mixdrop.to", "mixdrop.sx", "mixdrop.ps", "mixdrop.my"]) {
        if (host === domain) {
          continue;
        }
        const alternate = new URL(embedUrl);
        alternate.hostname = domain;
        urls.push(alternate.toString());
      }
    }
    if (/(^|\.)filemoon\./i.test(host)) {
      for (const domain of ["filemoon.sx", "filemoon.to", "filemoon.in", "filemoon.nl"]) {
        if (host === domain) {
          continue;
        }
        const alternate = new URL(embedUrl);
        alternate.hostname = domain;
        urls.push(alternate.toString());
      }
    }
    if (/(^|\.)f16px\.com$|(^|\.)bysekoze\.com$|(^|\.)rupertisdivingintoocean\.com$|(^|\.)filemoon\./i.test(host)) {
      const alternate = new URL(embedUrl);
      alternate.hostname = "sb1254w9megshle.org";
      urls.push(alternate.toString());
    }
  } catch {
    return urls;
  }
  return urls;
}

const VIDKING_DB_BASE_URL = "https://db.speedracelight.com/3";
const VIDKING_SOURCE_BASE_URL = "https://api.speedracelight.com";
const VIDKING_SOURCE_SERVERS = [
  "cdn/sources-with-title",
  "tejo/sources-with-title",
  "neon2/sources-with-title",
  "downloader2/sources-with-title",
  "1movies/sources-with-title",
] as const;
const VIDKING_PAYLOAD_MAGIC = new Uint8Array([109, 118, 109, 49]);
const VIDKING_HASH_WORDS = [
  1116352408, 1899447441, 3049323471, 3921009573,
  961987163, 1508970993, 2453635748, 2870763221,
  3624381080, 310598401, 607225278, 1426881987,
  1925078388, 2162078206, 2614888103, 3248222580,
] as const;

type VidkingRoute = {
  mediaType: "movie" | "tv";
  tmdbId: string;
  seasonId: string;
  episodeId: string;
  embedUrl: string;
};

type VidkingMetadata = {
  title?: string;
  name?: string;
  release_date?: string;
  first_air_date?: string;
  external_ids?: {
    imdb_id?: string | null;
  };
};

type VidkingSourcePayload = {
  sources?: Array<{
    url?: string;
    quality?: string | number;
  }>;
};

const vidkingMetadataCache = new Map<string, { expiresAt: number; metadata: Awaited<ReturnType<typeof fetchVidkingMetadataUncached>> }>();
const vidkingResolvedStreamCache = new Map<string, { expiresAt: number; target: ResolvedStreamTarget }>();
const vidkingSeedCache = new Map<string, { expiresAt: number; seed: string }>();

function isVidkingPlayer(provider: string | undefined, embedUrl: string) {
  const signature = `${provider ?? ""} ${embedUrl}`.toLowerCase();
  return /(?:^|[^a-z])vidking(?:[^a-z]|$)|vidking\.net/i.test(signature);
}

function parseVidkingRoute(value: string): VidkingRoute | null {
  try {
    const parsed = new URL(value);
    if (!/(^|\.)vidking\.net$/i.test(parsed.hostname)) {
      return null;
    }

    const parts = parsed.pathname.split("/").filter(Boolean);
    const embedIndex = parts.indexOf("embed");
    const mediaType = parts[embedIndex + 1];
    const tmdbId = parts[embedIndex + 2];
    if (embedIndex < 0 || (mediaType !== "movie" && mediaType !== "tv") || !/^\d+$/.test(tmdbId ?? "")) {
      return null;
    }

    return {
      mediaType,
      tmdbId,
      seasonId: mediaType === "tv" && /^\d+$/.test(parts[embedIndex + 3] ?? "") ? parts[embedIndex + 3] : "1",
      episodeId: mediaType === "tv" && /^\d+$/.test(parts[embedIndex + 4] ?? "") ? parts[embedIndex + 4] : "1",
      embedUrl: parsed.toString(),
    };
  } catch {
    return null;
  }
}

function mixVidkingWord(value: number) {
  value >>>= 0;
  value ^= value >>> 16;
  value = Math.imul(value, 2246822507) >>> 0;
  value ^= value >>> 13;
  value = Math.imul(value, 3266489909) >>> 0;
  value ^= value >>> 16;
  return value >>> 0;
}

function rotateVidkingWord(value: number, amount: number) {
  value >>>= 0;
  amount &= 31;
  return amount === 0 ? value : ((value << amount) | (value >>> (32 - amount))) >>> 0;
}

function vidkingStringHash(value: string) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash = Math.imul(hash ^ value.charCodeAt(index), 16777619) >>> 0;
  }
  return mixVidkingWord(hash);
}

function createVidkingCipherState(seed: string, mediaId: number) {
  if (((seed.length * (seed.length + 1)) & 1) === 1) {
    const state = Array.from({ length: 256 }, (_, index) => index);
    let cursor = 0;
    for (let index = 0; index < state.length; index += 1) {
      cursor = (cursor + state[index] + seed.charCodeAt(index % seed.length)) & 255;
      [state[index], state[cursor]] = [state[cursor], state[index]];
    }
    let accumulator = 1732584193;
    for (let index = 0; index < seed.length; index += 1) {
      accumulator = rotateVidkingWord(
        (accumulator ^ Math.imul(seed.charCodeAt(index), VIDKING_HASH_WORDS[index & 15])) >>> 0,
        5,
      );
    }
    return { state, accumulator: mixVidkingWord(accumulator) };
  }

  const state = new Array<number>(61);
  let accumulator = mixVidkingWord(vidkingStringHash(seed) ^ mixVidkingWord((mediaId >>> 0) ^ 2654435769));
  for (let round = 0; round < 8; round += 1) {
    if (((round * (round + 1)) & 1) === 0) {
      const position = accumulator % 61;
      accumulator = rotateVidkingWord((accumulator + 2654435769) >>> 0, 7 + (round & 7));
      state[position] = (accumulator ^ mixVidkingWord(accumulator)) >>> 0;
      accumulator = mixVidkingWord((accumulator + position) >>> 0);
    } else {
      state[round] = VIDKING_HASH_WORDS[round & 15];
    }
  }
  return { state, accumulator: mixVidkingWord(accumulator ^ 2779096485) };
}

function nextVidkingCipherWord(cipher: ReturnType<typeof createVidkingCipherState>, index: number) {
  const position = cipher.accumulator % 61;
  const existsMask = -(Number(position in cipher.state));
  const stateWord = cipher.state[position] >>> 0;
  const indexWord = Math.imul(2654435769, index + 1) >>> 0;
  const mixedWord = (stateWord ^ indexWord) >>> 0;
  let value = ((cipher.accumulator ^ mixedWord) | (cipher.accumulator & mixedWord & existsMask)) >>> 0;
  value = (
    rotateVidkingWord((value + cipher.accumulator) >>> 0, position & 31) ^
    rotateVidkingWord(cipher.accumulator, Math.imul(position, 7) & 31)
  ) >>> 0;
  cipher.accumulator = mixVidkingWord((value + 2654435769) >>> 0);
  cipher.state[position] = cipher.accumulator;
  return cipher.accumulator;
}

function decryptVidkingPayload(encrypted: string, seed: string, mediaId: number) {
  const input = Buffer.from(encrypted.replace(/-/g, "+").replace(/_/g, "/"), "base64");
  const cipher = createVidkingCipherState(seed, mediaId);
  const output = new Uint8Array(input.length);
  for (let offset = 0, wordIndex = 0; offset < input.length; wordIndex += 1) {
    const word = nextVidkingCipherWord(cipher, wordIndex);
    for (let byte = 0; byte < 4 && offset < input.length; byte += 1, offset += 1) {
      output[offset] = input[offset] ^ ((word >>> (byte * 8)) & 255);
    }
  }
  if (VIDKING_PAYLOAD_MAGIC.some((byte, index) => output[index] !== byte)) {
    throw new Error("VidKing source payload seed was rejected.");
  }
  return JSON.parse(new TextDecoder().decode(output.subarray(VIDKING_PAYLOAD_MAGIC.length))) as VidkingSourcePayload;
}

async function fetchVidkingSeed(mediaId: string, forceRefresh = false) {
  const cached = vidkingSeedCache.get(mediaId);
  if (!forceRefresh && cached && cached.expiresAt - 5000 > Date.now()) return cached.seed;

  const response = await fetch(`${VIDKING_SOURCE_BASE_URL}/seed?mediaId=${encodeURIComponent(mediaId)}`, {
    headers: {
      "user-agent": USER_AGENT,
      accept: "application/json,*/*",
      origin: "https://www.vidking.net",
      referer: "https://www.vidking.net/",
    },
  });
  if (!response.ok) throw new Error(`VidKing seed request failed: ${response.status}.`);
  const payload = await response.json() as { seed?: unknown; ttlMs?: unknown };
  if (typeof payload.seed !== "string" || !payload.seed) throw new Error("VidKing seed response was invalid.");
  const ttlMs = typeof payload.ttlMs === "number" && Number.isFinite(payload.ttlMs) ? payload.ttlMs : 30_000;
  vidkingSeedCache.set(mediaId, { seed: payload.seed, expiresAt: Date.now() + ttlMs });
  return payload.seed;
}

function parseVidkingYear(value: string | undefined) {
  const match = value?.match(/\b(19|20)\d{2}\b/);
  return match?.[0] ?? "";
}

async function fetchVidkingMetadataUncached(route: VidkingRoute) {
  const response = await fetch(`${VIDKING_DB_BASE_URL}/${route.mediaType}/${route.tmdbId}?append_to_response=external_ids`, {
    headers: {
      "user-agent": USER_AGENT,
      accept: "application/json,*/*",
      referer: route.embedUrl,
    },
  });
  if (!response.ok) {
    throw new Error(`VidKing metadata request failed: ${response.status}.`);
  }

  const metadata = await response.json() as VidkingMetadata;
  const title = route.mediaType === "movie" ? metadata.title : metadata.name;
  const year = parseVidkingYear(route.mediaType === "movie" ? metadata.release_date : metadata.first_air_date);
  if (!title) {
    throw new Error("VidKing metadata did not include a title.");
  }

  return {
    title,
    year,
    imdbId: metadata.external_ids?.imdb_id ?? "",
  };
}

async function fetchVidkingMetadata(route: VidkingRoute) {
  const key = `${route.mediaType}:${route.tmdbId}`;
  const cached = vidkingMetadataCache.get(key);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.metadata;
  }

  const metadata = await fetchVidkingMetadataUncached(route);
  vidkingMetadataCache.set(key, {
    expiresAt: Date.now() + 12 * 60 * 60 * 1000,
    metadata,
  });
  return metadata;
}

function qualityScore(value: string | number | undefined) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  const numeric = String(value ?? "").match(/\d{3,4}/)?.[0];
  return numeric ? Number.parseInt(numeric, 10) : 0;
}

function selectVidkingSource(payload: VidkingSourcePayload) {
  const candidates = (payload.sources ?? [])
    .map((source) => ({
      url: typeof source.url === "string" ? source.url.trim() : "",
      quality: source.quality,
    }))
    .filter((source) => isHttpUrl(source.url));

  candidates.sort((left, right) => {
    const rightIsHls = /\.m3u8(?:$|[?#])/i.test(right.url) ? 1 : 0;
    const leftIsHls = /\.m3u8(?:$|[?#])/i.test(left.url) ? 1 : 0;
    return (rightIsHls - leftIsHls) || (qualityScore(right.quality) - qualityScore(left.quality));
  });

  return candidates[0]?.url ?? null;
}

async function fetchVidkingSources(route: VidkingRoute, metadata: Awaited<ReturnType<typeof fetchVidkingMetadata>>) {
  const errors: string[] = [];
  for (const endpoint of VIDKING_SOURCE_SERVERS) {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const seed = await fetchVidkingSeed(route.tmdbId, attempt > 0);
      const params = new URLSearchParams({
        title: metadata.title,
        mediaType: route.mediaType,
        year: metadata.year,
        episodeId: route.episodeId,
        seasonId: route.seasonId,
        tmdbId: route.tmdbId,
        imdbId: metadata.imdbId,
        enc: "2",
        seed,
        _t: String(Date.now()),
      });
      const response = await fetch(`${VIDKING_SOURCE_BASE_URL}/${endpoint}?${params.toString()}`, {
        headers: {
          "user-agent": USER_AGENT,
          accept: "application/json,text/plain,*/*",
          referer: route.embedUrl,
          origin: "https://www.vidking.net",
          "cache-control": "no-cache, no-store, must-revalidate",
          pragma: "no-cache",
          expires: "0",
        },
      }).catch((error) => {
        errors.push(`${endpoint}: ${error instanceof Error ? error.message : String(error)}`);
        return null;
      });

      if (!response) break;
      if (response.status === 401 && attempt === 0) {
        vidkingSeedCache.delete(route.tmdbId);
        continue;
      }
      if (!response.ok) {
        errors.push(`${endpoint}: ${response.status}`);
        break;
      }

      try {
        const payload = decryptVidkingPayload(await response.text(), seed, Number.parseInt(route.tmdbId, 10));
        if ((payload.sources?.length ?? 0) > 0) return payload;
        errors.push(`${endpoint}: no playable sources`);
      } catch (error) {
        errors.push(`${endpoint}: ${error instanceof Error ? error.message : String(error)}`);
      }
      break;
    }
  }

  throw new Error(errors.length ? `VidKing source API failed. ${errors.join(" | ")}` : "VidKing source API returned no sources.");
}

async function resolveVidkingStream(provider: string | undefined, embedUrl: string): Promise<ResolvedStreamTarget | null> {
  if (!isVidkingPlayer(provider, embedUrl)) {
    return null;
  }

  const route = parseVidkingRoute(embedUrl);
  if (!route) {
    throw new Error("VidKing player URL could not be parsed.");
  }

  const cacheKey = `${route.mediaType}:${route.tmdbId}:${route.seasonId}:${route.episodeId}`;
  const cached = vidkingResolvedStreamCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    const validation = await validateResolvedStream(cached.target).catch((error): StreamValidationResult => ({
      ok: false,
      reason: error instanceof Error ? error.message : String(error),
    }));
    if (validation.ok) {
      return cached.target;
    }
    vidkingResolvedStreamCache.delete(cacheKey);
  }

  const metadata = await fetchVidkingMetadata(route);
  const streamUrl = selectVidkingSource(await fetchVidkingSources(route, metadata));
  if (!streamUrl) {
    throw new Error("VidKing source payload did not contain a direct stream.");
  }

  const target = {
    streamUrl,
    refererUrl: route.embedUrl,
  };
  vidkingResolvedStreamCache.set(cacheKey, {
    expiresAt: Date.now() + 30 * 1000,
    target,
  });
  return target;
}

function extractScriptUrls(text: string, baseUrl: string) {
  const urls = new Set<string>();
  for (const match of text.matchAll(/<script[^>]+\bsrc=["']([^"']+)["']/gi)) {
    const value = match[1]?.trim();
    if (!value) {
      continue;
    }
    try {
      urls.add(new URL(value, baseUrl).toString());
    } catch {
      // Ignore malformed script URLs.
    }
  }
  return Array.from(urls);
}

function extractJavascriptPlayerUrls(text: string, baseUrl: string) {
  const urls = new Set<string>();
  const normalizedText = text
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/\/\*[\s\S]*?\*\//g, "");
  const patterns = [
    /go\(\s*['"]([^'"]+)['"]\s*\)/gi,
    /(?:src|file|url)\s*[:=]\s*['"]([^'"]+)['"]/gi,
  ];

  for (const pattern of patterns) {
    for (const match of normalizedText.matchAll(pattern)) {
      const value = match[1]?.trim();
      if (!value || !/^https?:\/\//i.test(value)) {
        continue;
      }
      try {
        urls.add(new URL(value, baseUrl).toString());
      } catch {
        // Ignore malformed player candidates.
      }
    }
  }

  return Array.from(urls);
}

function extractCloudnestraPlayerUrls(text: string, baseUrl: string) {
  const urls = new Set<string>();
  for (const match of text.matchAll(/["'](\/(?:prorcp|rcp)\/[^"']+)["']/gi)) {
    const value = match[1]?.trim();
    if (!value) {
      continue;
    }
    try {
      urls.add(new URL(value, baseUrl).toString());
    } catch {
      // Ignore malformed player candidates.
    }
  }
  return Array.from(urls);
}

function isSvetSerialuUrl(value: string) {
  try {
    const host = new URL(value).hostname.toLowerCase();
    return host === "svetserialu.to" || host === "svetserialu.io" || host === "svetserialov.to";
  } catch {
    return false;
  }
}

function extractSvetSerialuSourceUrls(text: string, baseUrl: string) {
  const urls: string[] = [];

  for (const match of text.matchAll(/<[^>]*\bclass=["'][^"']*\bsource_link\b[^"']*["'][^>]*>/gi)) {
    const tag = match[0] ?? "";
    const encoded = tag.match(/\bdata-iframe=["']([^"']+)["']/i)?.[1];
    if (!encoded) {
      continue;
    }

    try {
      const decoded = Buffer.from(encoded, "base64").toString("utf8");
      urls.push(new URL(decoded, baseUrl).toString());
    } catch {
      // Ignore malformed source buttons.
    }
  }

  return Array.from(new Set(urls));
}

function extractSvetSerialuEmbedUrl(text: string, baseUrl: string) {
  const iframeSrc = text.match(/<iframe[^>]+src=["']([^"']+)["']/i)?.[1];
  if (iframeSrc) {
    const embedUrl = new URL(iframeSrc, baseUrl).toString();
    if (!embedUrl.includes("/sources/")) {
      return embedUrl;
    }
  }

  const redirectUrl = text.match(/window\.location\.href\s*=\s*["']([^"']+)["']/i)?.[1];
  if (redirectUrl) {
    const embedUrl = new URL(redirectUrl, baseUrl).toString();
    if (!embedUrl.includes("/sources/")) {
      return embedUrl;
    }
  }

  return null;
}

function extractByseLikeVideoCode(embedUrl: string) {
  try {
    const parsed = new URL(embedUrl);
    const host = parsed.hostname.toLowerCase();
    if (
      !/(^|\.)f16px\.com$|(^|\.)bysekoze\.com$|(^|\.)rupertisdivingintoocean\.com$/i.test(host) &&
      !/^sb[a-z0-9]+\.org$/i.test(host)
    ) {
      return null;
    }

    const parts = parsed.pathname.split("/").filter(Boolean);
    const code = parts[0] === "e" ? parts[1] : parts.at(-1);
    if (!code || !/^[a-z0-9_-]{6,80}$/i.test(code)) {
      return null;
    }

    return {
      origin: parsed.origin,
      code,
    };
  } catch {
    return null;
  }
}

type ByseFingerprint = {
  token: string;
  viewer_id: string;
  device_id: string;
};

type ByseParsedEmbed = NonNullable<ReturnType<typeof extractByseLikeVideoCode>>;

const byseFingerprintCache = new Map<string, { fingerprint: ByseFingerprint; expiresAt: number }>();

function getByseEmbedHeaders(parsed: ByseParsedEmbed, embedUrl: string, captchaToken?: string, requestReferer?: string) {
  let embedOrigin = "www.bombuj.si";
  let embedReferer = "https://www.bombuj.si/";
  try {
    const url = new URL(embedUrl);
    const subInfo = url.searchParams.get("sub.info") ?? url.searchParams.get("sub");
    if (subInfo) {
      const subUrl = new URL(subInfo, embedUrl);
      if (isSvetSerialuUrl(subUrl.toString())) {
        embedOrigin = subUrl.hostname;
        embedReferer = `${subUrl.protocol}//${subUrl.hostname}/`;
      }
    }
  } catch {
    // Keep the Bombuj-compatible default.
  }

  return {
    "user-agent": USER_AGENT,
    accept: "application/json,text/plain,*/*",
    "content-type": "application/json",
    referer: requestReferer ?? embedUrl,
    origin: parsed.origin,
    "x-embed-origin": embedOrigin,
    "x-embed-referer": embedReferer,
    ...(captchaToken ? { "x-captcha-token": captchaToken } : {}),
  };
}

async function readByseJson<T>(url: string, init: RequestInit): Promise<{ ok: boolean; status: number; data: T | null }> {
  const response = await fetch(url, init);
  const data = await response.json().catch(() => null) as T | null;
  return {
    ok: response.ok,
    status: response.status,
    data,
  };
}

async function createByseFingerprint(parsed: ByseParsedEmbed, embedUrl: string, requestReferer?: string): Promise<ByseFingerprint> {
  const cacheKey = parsed.origin;
  const cached = byseFingerprintCache.get(cacheKey);
  if (cached && cached.expiresAt - 30_000 > Date.now()) {
    return cached.fingerprint;
  }

  const headers = getByseEmbedHeaders(parsed, embedUrl, undefined, requestReferer);
  const challenge = await readByseJson<{
    challenge_id?: string;
    nonce?: string;
  }>(`${parsed.origin}/api/videos/access/challenge`, {
    method: "POST",
    headers,
    body: "{}",
  });
  if (!challenge.ok || !challenge.data?.challenge_id || !challenge.data.nonce) {
    throw new Error(`Byse access challenge failed (${challenge.status}).`);
  }

  const key = await webcrypto.subtle.generateKey(
    { name: "ECDSA", namedCurve: "P-256" },
    true,
    ["sign", "verify"],
  );
  const publicKey = await webcrypto.subtle.exportKey("jwk", key.publicKey);
  const signature = await webcrypto.subtle.sign(
    { name: "ECDSA", hash: { name: "SHA-256" } },
    key.privateKey,
    new TextEncoder().encode(challenge.data.nonce),
  );

  const attest = await readByseJson<{
    token?: string;
    viewer_id?: string;
    device_id?: string;
    expires_at?: string;
  }>(`${parsed.origin}/api/videos/access/attest`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      viewer_id: "",
      device_id: "",
      challenge_id: challenge.data.challenge_id,
      nonce: challenge.data.nonce,
      signature: bufferToBase64Url(signature),
      public_key: publicKey,
      client: {
        user_agent: USER_AGENT,
        language: "en-US",
        languages: ["en-US", "en"],
        platform: "Win32",
        hardware_concurrency: 8,
        device_memory: 8,
        timezone: "Europe/Prague",
        screen: {
          width: 1920,
          height: 1080,
          colorDepth: 24,
          pixelDepth: 24,
        },
        webdriver: false,
      },
      storage: {},
      attributes: {
        entropy: "medium",
      },
    }),
  });

  if (!attest.ok || !attest.data?.token || !attest.data.viewer_id || !attest.data.device_id) {
    throw new Error(`Byse access attestation failed (${attest.status}).`);
  }

  const expiresAt = Date.parse(attest.data.expires_at ?? "");
  const fingerprint = {
    token: attest.data.token,
    viewer_id: attest.data.viewer_id,
    device_id: attest.data.device_id,
  };
  byseFingerprintCache.set(cacheKey, {
    fingerprint,
    expiresAt: Number.isFinite(expiresAt) ? expiresAt : Date.now() + 5 * 60 * 1000,
  });
  return fingerprint;
}

const BYSE_POW_BUFFER_SIZE = 512;
const BYSE_POW_BUFFER_MASK = BYSE_POW_BUFFER_SIZE - 1;
const BYSE_POW_MIX_ROUNDS = 2;
const BYSE_POW_PRIME_1 = 2654435761;
const BYSE_POW_PRIME_2 = 2246822519;

function rotateLeft32(value: number, bits: number) {
  return ((value << bits) | (value >>> (32 - bits))) >>> 0;
}

function multiply32(value: number, factor: number) {
  return Math.imul(value, factor) >>> 0;
}

function byseQuarterRound(state: Uint32Array) {
  state[0] = (state[0] + state[1]) >>> 0;
  state[3] = rotateLeft32(state[3] ^ state[0], 16);
  state[2] = (state[2] + state[3]) >>> 0;
  state[1] = rotateLeft32(state[1] ^ state[2], 12);
  state[0] = (state[0] + state[1]) >>> 0;
  state[3] = rotateLeft32(state[3] ^ state[0], 8);
  state[2] = (state[2] + state[3]) >>> 0;
  state[1] = rotateLeft32(state[1] ^ state[2], 7);
}

function asciiBytes(value: string) {
  const bytes = new Uint8Array(value.length);
  for (let index = 0; index < value.length; index += 1) {
    bytes[index] = value.charCodeAt(index) & 255;
  }
  return bytes;
}

function bysePowHash(bytes: Uint8Array) {
  const state = new Uint32Array([1779033703, 3144134277, 1013904242, 2773480762]);
  for (let index = 0; index < bytes.length; index += 1) {
    state[0] = (state[0] + bytes[index]) >>> 0;
    state[0] = rotateLeft32(state[0], 7);
    byseQuarterRound(state);
  }
  for (let index = 0; index < 8; index += 1) byseQuarterRound(state);

  const buffer = new Uint32Array(BYSE_POW_BUFFER_SIZE);
  for (let index = 0; index < BYSE_POW_BUFFER_SIZE; index += 1) {
    byseQuarterRound(state);
    buffer[index] = (state[0] ^ state[2]) >>> 0;
  }

  for (let round = 0; round < BYSE_POW_MIX_ROUNDS; round += 1) {
    for (let index = 0; index < BYSE_POW_BUFFER_SIZE; index += 1) {
      const targetIndex = buffer[index] & BYSE_POW_BUFFER_MASK;
      let mixed = (buffer[index] + buffer[targetIndex]) >>> 0;
      mixed = rotateLeft32(mixed, 13);
      mixed = (mixed ^ multiply32(buffer[(index + 1) & BYSE_POW_BUFFER_MASK], BYSE_POW_PRIME_1)) >>> 0;
      buffer[index] = mixed;
      state[0] = (state[0] ^ mixed) >>> 0;
      byseQuarterRound(state);
    }
  }

  const digest = new Uint32Array(8);
  const stride = BYSE_POW_BUFFER_SIZE / 8;
  for (let index = 0; index < 8; index += 1) {
    byseQuarterRound(state);
    let mixed = state[0];
    const offset = index * stride;
    for (let cursor = 0; cursor < stride; cursor += 1) {
      const value = buffer[offset + cursor];
      mixed = (mixed + value) >>> 0;
      mixed = rotateLeft32(mixed, 5);
      mixed = (mixed ^ multiply32(value, BYSE_POW_PRIME_2)) >>> 0;
    }
    digest[index] = (mixed ^ state[2]) >>> 0;
  }
  return digest;
}

function countLeadingZeroBits(words: Uint32Array) {
  let count = 0;
  for (const word of words) {
    if (word === 0) {
      count += 32;
      continue;
    }
    return count + Math.clz32(word);
  }
  return count;
}

async function solveBysePow(nonce: string, difficulty: number, timeoutMs = 20_000) {
  if (difficulty <= 0) {
    return "0";
  }
  const prefix = `${nonce}:`;
  const startedAt = Date.now();
  for (let solution = 0; ; solution += 1) {
    if (countLeadingZeroBits(bysePowHash(asciiBytes(`${prefix}${solution}`))) >= difficulty) {
      return String(solution);
    }
    if (solution > 0 && solution % 1024 === 0) {
      if (Date.now() - startedAt > timeoutMs) {
        throw new Error("Byse proof-of-work challenge timed out.");
      }
      await new Promise((resolvePromise) => setTimeout(resolvePromise, 0));
    }
  }
}

async function createByseCaptchaToken(parsed: ByseParsedEmbed, embedUrl: string, fingerprint: ByseFingerprint, requestReferer?: string) {
  const headers = getByseEmbedHeaders(parsed, embedUrl, undefined, requestReferer);
  const captcha = await readByseJson<{
    pow_nonce?: string;
    pow_difficulty?: number;
    pow_token?: string;
  }>(`${parsed.origin}/api/videos/${encodeURIComponent(parsed.code)}/embed/captcha`, {
    method: "POST",
    headers,
    body: JSON.stringify({ fingerprint }),
  });
  if (!captcha.ok || !captcha.data?.pow_nonce || !captcha.data.pow_token || typeof captcha.data.pow_difficulty !== "number") {
    throw new Error(`Byse captcha challenge failed (${captcha.status}).`);
  }

  const solution = await solveBysePow(captcha.data.pow_nonce, captcha.data.pow_difficulty);
  const verified = await readByseJson<{
    status?: string;
    token?: string;
    reason?: string;
  }>(`${parsed.origin}/api/videos/${encodeURIComponent(parsed.code)}/embed/captcha/verify`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      pow_token: captcha.data.pow_token,
      solution,
      fingerprint,
    }),
  });
  if (!verified.ok || verified.data?.status !== "ok" || !verified.data.token) {
    throw new Error(`Byse captcha verification failed${verified.data?.reason ? `: ${verified.data.reason}` : ` (${verified.status})`}.`);
  }
  return verified.data.token;
}

async function resolveEncryptedPlaybackStream(embedUrl: string, refererUrl?: string): Promise<string | null> {
  const parsed = extractByseLikeVideoCode(embedUrl);
  if (!parsed) {
    return null;
  }

  const playbackUrl = `${parsed.origin}/api/videos/${encodeURIComponent(parsed.code)}/embed/playback`;
  let fingerprint: ByseFingerprint = {
    token: "",
    viewer_id: "",
    device_id: "",
  };
  let response = await fetch(playbackUrl, {
    method: "POST",
    headers: getByseEmbedHeaders(parsed, embedUrl, undefined, refererUrl),
    body: JSON.stringify({ fingerprint }),
  });

  if (response.status === 428) {
    fingerprint = await createByseFingerprint(parsed, embedUrl, refererUrl);
    const captchaToken = await createByseCaptchaToken(parsed, embedUrl, fingerprint, refererUrl);
    response = await fetch(playbackUrl, {
      method: "POST",
      headers: getByseEmbedHeaders(parsed, embedUrl, captchaToken, refererUrl),
      body: JSON.stringify({ fingerprint }),
    });
  }

  if (!response.ok) {
    if (response.status === 405) {
      const downloadsUrl = `${parsed.origin}/api/videos/${encodeURIComponent(parsed.code)}/downloads`;
      const downloadsResponse = await fetch(downloadsUrl, {
        headers: {
          "user-agent": USER_AGENT,
          accept: "application/json,text/plain,*/*",
          referer: refererUrl ?? embedUrl,
        },
      }).catch(() => null);
      if (downloadsResponse?.ok) {
        const downloads = (await downloadsResponse.json().catch(() => null)) as {
          recaptcha_required?: boolean;
          countdown_seconds?: number;
          options?: Array<{ quality?: string; label?: string; size_bytes?: number }>;
        } | null;
        if (downloads?.recaptcha_required) {
          throw new Error("Byse exposes this file only through its download gate with reCAPTCHA, so the fetch server cannot resolve a direct stream URL.");
        }
      }
    }
    return null;
  }

  const body = (await response.json().catch(() => null)) as {
    playback?: {
      iv?: string;
      payload?: string;
      key_parts?: string[];
      version?: string;
      iv2?: string;
      payload2?: string;
      decrypt_keys?: { edge_1?: string; edge_2?: string };
    };
  } | null;

  const pb = body?.playback;
  if (!pb) {
    return null;
  }

  const sources: string[] = [];

  if (pb.iv && pb.payload && Array.isArray(pb.key_parts) && pb.key_parts.length > 0) {
    const key = resolveByseKeyParts(pb);
    if (key) {
      const decoded = decryptAesGcmPayload(pb.iv, pb.payload, key);
      sources.push(...extractSources(decoded));
    }
  }

  if (pb.iv2 && pb.payload2 && pb.decrypt_keys?.edge_1 && pb.decrypt_keys?.edge_2) {
    const key2 = Buffer.concat([base64UrlToBuffer(pb.decrypt_keys.edge_1), base64UrlToBuffer(pb.decrypt_keys.edge_2)]);
    const decoded2 = decryptAesGcmPayload(pb.iv2, pb.payload2, key2);
    sources.push(...extractSources(decoded2));
  }

  const unique = Array.from(new Set(sources));
  return unique.find((entry) => entry.includes(".m3u8")) ?? unique[0] ?? null;
}

async function resolveStreamtapeUrl(embedUrl: string): Promise<string | null> {
  const response = await fetch(embedUrl, {
    headers: {
      "user-agent": USER_AGENT,
      accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "accept-language": "en-US,en;q=0.9",
      referer: "https://www.bombuj.si/",
    },
  });

  if (!response.ok) {
    return null;
  }

  const html = await response.text();

  const assignmentMatch = html.match(/document\.getElementById\(['"]robotlink['"]\)\.innerHTML\s*=\s*([^;]+);/i);
  if (assignmentMatch?.[1]) {
    const evaluated = evaluateConcatExpression(assignmentMatch[1]);
    if (evaluated) {
      const normalized = normalizeStreamtapeMediaUrl(evaluated);
      if (normalized) return normalized;
    }
  }

  const robotDivMatch = html.match(/<div\s+id=["']robotlink["'][^>]*>([^<]+)<\/div>/i);
  if (robotDivMatch?.[1]) {
    const normalized = normalizeStreamtapeMediaUrl(robotDivMatch[1]);
    if (normalized) return normalized;
  }

  const snippetMatches = [...html.matchAll(/\/get_video\?id=[^"'\s<]+/gi)].map((m) => m[0]);
  if (snippetMatches.length > 0) {
    const counts = new Map<string, number>();
    for (const snippet of snippetMatches) {
      counts.set(snippet, (counts.get(snippet) ?? 0) + 1);
    }
    const best = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
    if (best) return `https://streamtape.com${best}`;
  }

  return null;
}

function extractSources(payload: unknown): string[] {
  if (!payload || typeof payload !== "object") {
    return [];
  }
  const maybeSources = (payload as { sources?: Array<{ url?: string; file?: string }> }).sources;
  if (!Array.isArray(maybeSources)) {
    return [];
  }

  return maybeSources
    .map((entry) => entry.url ?? entry.file ?? "")
    .filter((value) => typeof value === "string" && value.length > 0);
}

function parseDurationSeconds(value: string) {
  const match = value.match(/(\d+):(\d+):(\d+(?:\.\d+)?)/);
  if (!match) {
    return null;
  }
  const hours = Number.parseInt(match[1], 10);
  const minutes = Number.parseInt(match[2], 10);
  const seconds = Number.parseFloat(match[3]);
  if (!Number.isFinite(hours) || !Number.isFinite(minutes) || !Number.isFinite(seconds)) {
    return null;
  }
  return hours * 3600 + minutes * 60 + seconds;
}

function parseSizeKilobytes(value: string) {
  const match = value.match(/([\d.]+)([kmg]?i?b)?/i);
  if (!match) {
    return null;
  }

  const amount = Number.parseFloat(match[1]);
  if (!Number.isFinite(amount)) {
    return null;
  }

  const unit = (match[2] ?? "kB").toLowerCase();
  if (unit === "kb") return amount;
  if (unit === "mb") return amount * 1024;
  if (unit === "gb") return amount * 1024 * 1024;
  return amount;
}

function formatMegabytesFromKilobytes(kilobytes: number | null) {
  if (kilobytes === null || !Number.isFinite(kilobytes)) {
    return null;
  }
  return `${(kilobytes / 1024).toFixed(1)} MB`;
}

function runCommand(command: string, args: string[], timeoutMs = 10_000): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = execFile(command, args, { windowsHide: true }, (error, stdout, stderr) => {
      if (timeout) {
        clearTimeout(timeout);
      }

      if (error) {
        rejectPromise(error);
        return;
      }

      resolvePromise({
        stdout,
        stderr,
      });
    });

    const timeout = setTimeout(() => {
      child.kill("SIGKILL");
      rejectPromise(new Error(`${command} timed out.`));
    }, timeoutMs);
  });
}

async function getToolVersion(command: "ffmpeg" | "ffprobe") {
  try {
    const { stdout, stderr } = await runCommand(command, ["-version"], 5_000);
    const firstLine = (stdout || stderr).split(/\r?\n/).find(Boolean) ?? `${command} available`;
    return {
      available: true,
      version: firstLine,
    };
  } catch (error) {
    return {
      available: false,
      error: error instanceof Error ? error.message : `${command} unavailable`,
    };
  }
}

export async function getMediaToolStatus() {
  const [ffmpeg, ffprobe] = await Promise.all([getToolVersion("ffmpeg"), getToolVersion("ffprobe")]);
  return {
    ffmpeg,
    ffprobe,
    canDownload: ffmpeg.available,
    canValidate: ffprobe.available || ffmpeg.available,
    canRepairSeekableMp4: ffmpeg.available,
  };
}

function probeVideoFile(filePath: string): Promise<boolean> {
  return new Promise((resolvePromise) => {
    const ffmpeg = execFile("ffprobe", ["-v", "error", "-show_format", "-show_streams", filePath], {
      windowsHide: true,
    });

    ffmpeg.on("error", () => {
      const fallback = execFile("ffmpeg", ["-v", "error", "-i", filePath, "-f", "null", "-"], {
        windowsHide: true,
      });
      fallback.on("error", () => resolvePromise(false));
      fallback.on("close", (code) => resolvePromise(code === 0));
    });
    ffmpeg.on("close", (code) => resolvePromise(code === 0));
  });
}

async function isPlayableFile(filePath: string): Promise<boolean> {
  return probeVideoFile(filePath);
}

async function removeFileIfExists(filePath: string) {
  try {
    await unlink(filePath);
  } catch {
    // no-op
  }
}

async function removeFolderIfExists(folderPath: string) {
  try {
    await rm(folderPath, { recursive: true, force: true });
  } catch {
    // no-op
  }
}

async function cleanupDownloadArtifacts(episodeId: string, filePath: string) {
  await removeFileIfExists(filePath);
  await removeFileIfExists(`${filePath}.part`);

  const index = await readDownloadIndex();
  if (index[episodeId]) {
    delete index[episodeId];
    await writeDownloadIndex(index);
  }

  const subtitleIndex = await readSubtitleIndex();
  if (subtitleIndex[episodeId]) {
    delete subtitleIndex[episodeId];
    await writeSubtitleIndex(subtitleIndex);
  }

  await removeFolderIfExists(resolve(getSubtitlesFolder(), sanitizeEpisodeId(episodeId)));
}

async function getSeekableCacheKey(filePath: string) {
  const fileInfo = await stat(filePath);
  return `${filePath}:${fileInfo.size}:${fileInfo.mtimeMs}`;
}

async function repairSeekableDownloadFile(episodeId: string, filePath: string): Promise<string> {
  const cacheKey = await getSeekableCacheKey(filePath);
  if (seekableRepairCache.get(filePath) === cacheKey) {
    return filePath;
  }

  const temporaryOutputPath = `${filePath}.faststart.tmp`;
  const backupPath = `${filePath}.faststart.bak`;
  await removeFileIfExists(temporaryOutputPath);
  await removeFileIfExists(backupPath);

  try {
    await runCommand(
      "ffmpeg",
      [
        "-y",
        "-v",
        "error",
        "-i",
        filePath,
        "-map",
        "0",
        "-c",
        "copy",
        "-movflags",
        "+faststart",
        temporaryOutputPath,
      ],
      120_000,
    );

    if (!(await probeVideoFile(temporaryOutputPath))) {
      throw new Error("Faststart repair produced an invalid video file.");
    }

    await rename(filePath, backupPath);
    try {
      await rename(temporaryOutputPath, filePath);
    } catch (error) {
      await rename(backupPath, filePath).catch(() => undefined);
      throw error;
    }
    await removeFileIfExists(backupPath);

    seekableRepairCache.set(filePath, await getSeekableCacheKey(filePath));
    return filePath;
  } catch (error) {
    await removeFileIfExists(temporaryOutputPath);
    await removeFileIfExists(backupPath);
    if (await probeVideoFile(filePath)) {
      return filePath;
    }
    await cleanupDownloadArtifacts(episodeId, filePath);
    throw error;
  }
}

export async function ensureSeekableDownloadFile(episodeId: string, filePath: string): Promise<string> {
  const existing = seekableRepairLocks.get(filePath);
  if (existing) {
    return existing;
  }

  const repair = repairSeekableDownloadFile(episodeId, filePath).finally(() => {
    seekableRepairLocks.delete(filePath);
  });
  seekableRepairLocks.set(filePath, repair);
  return repair;
}

async function isValidDownloadFile(episodeId: string, filePath: string) {
  const exists = await probeVideoFile(filePath);
  if (!exists) {
    await cleanupDownloadArtifacts(episodeId, filePath);
    return false;
  }

  return true;
}

async function resolveStreamTarget(
  embedUrl: string,
  depth = 0,
  visited = new Set<string>(),
  refererUrl?: string,
  preferHlsVariant = true,
): Promise<ResolvedStreamTarget | null> {
  if (visited.has(embedUrl) || depth > 4) {
    return null;
  }
  visited.add(embedUrl);

  const encryptedPlaybackStream = await resolveEncryptedPlaybackStream(embedUrl, refererUrl);
  if (encryptedPlaybackStream) {
    return { streamUrl: encryptedPlaybackStream, refererUrl: embedUrl };
  }

  if (/streamtape\./i.test(embedUrl)) {
    const streamUrl = await resolveStreamtapeUrl(embedUrl);
    return streamUrl ? { streamUrl, refererUrl: embedUrl } : null;
  }

  if (isTwoEmbedUrl(embedUrl)) {
    const twoEmbedStream = await resolveTwoEmbedStream(embedUrl, 0, new Set<string>());
    if (twoEmbedStream) {
      return twoEmbedStream;
    }
  }

  if (embedUrl.includes(".m3u8") || embedUrl.includes(".mp4")) {
    const preferredUrl = await resolvePreferredHlsVariant(embedUrl, embedUrl, preferHlsVariant);
    return { streamUrl: preferredUrl, refererUrl: embedUrl };
  }

  try {
    const fetched = await fetchTextForResolution(embedUrl, refererUrl, "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8");
    if (!fetched) {
      return null;
    }
    const html = fetched.text;
    const finalUrl = fetched.finalUrl;
    const mediaRefererUrl = refererUrl ?? finalUrl;

    if (/play\.xpass\.top/i.test(finalUrl)) {
      const xpass = await resolveXpassPlaylistStream(finalUrl, html, finalUrl);
      if (xpass) {
        return xpass;
      }
    }

    const voeStream = extractVoeObfuscatedStream(html);
    if (voeStream && !isKnownPlaceholderStream(voeStream)) {
      return {
        streamUrl: await resolvePreferredHlsVariant(voeStream, finalUrl, preferHlsVariant),
        refererUrl: finalUrl,
      };
    }

    const direct = findMediaUrlInDecodedText(html, finalUrl);
    if (direct && !isKnownPlaceholderStream(direct)) {
      return { streamUrl: await resolvePreferredHlsVariant(direct, mediaRefererUrl, preferHlsVariant), refererUrl: mediaRefererUrl };
    }

    const unpacked = unpackDeanEdwardsPacker(html);
    if (unpacked) {
      const fromPacked = findMediaUrlInDecodedText(unpacked, finalUrl);
      if (fromPacked && !isKnownPlaceholderStream(fromPacked)) {
        return { streamUrl: await resolvePreferredHlsVariant(fromPacked, mediaRefererUrl, preferHlsVariant), refererUrl: mediaRefererUrl };
      }
    }

    if (isHqqUrl(finalUrl)) {
      return null;
    }

    const redirectUrl = extractScriptRedirectUrl(html, finalUrl);
    if (redirectUrl && redirectUrl !== embedUrl) {
      const redirected = await resolveStreamTarget(redirectUrl, depth + 1, visited, finalUrl, preferHlsVariant);
      if (redirected) {
        return redirected;
      }
    }

    const iframeUrl = extractIframeUrl(html, finalUrl);
    if (iframeUrl && iframeUrl !== embedUrl) {
      const nested = await resolveStreamTarget(iframeUrl, depth + 1, visited, finalUrl, preferHlsVariant);
      if (nested) {
        return nested;
      }
    }

    if (isSvetSerialuUrl(finalUrl)) {
      const sourceUrls = finalUrl.includes("/sources/")
        ? [finalUrl]
        : extractSvetSerialuSourceUrls(html, finalUrl);

      for (const sourceUrl of sourceUrls) {
        if (visited.has(sourceUrl)) {
          continue;
        }

        const sourceResponse = await fetchTextForResolution(sourceUrl, finalUrl, "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8");
        if (!sourceResponse) {
          continue;
        }

        const sourceHtml = sourceResponse.text;
        const sourceEmbedUrl = extractSvetSerialuEmbedUrl(sourceHtml, sourceResponse.finalUrl || sourceUrl);
        if (!sourceEmbedUrl || visited.has(sourceEmbedUrl)) {
          continue;
        }

        const nested = await resolveStreamTarget(sourceEmbedUrl, depth + 1, visited, sourceResponse.finalUrl || sourceUrl, preferHlsVariant);
        if (nested) {
          return nested;
        }
      }
    }

    for (const playerUrl of extractCloudnestraPlayerUrls(html, finalUrl)) {
      if (visited.has(playerUrl)) {
        continue;
      }
      const nested = await resolveStreamTarget(playerUrl, depth + 1, visited, finalUrl, preferHlsVariant);
      if (nested) {
        return nested;
      }
    }

    for (const scriptUrl of extractScriptUrls(html, finalUrl)) {
      if (visited.has(scriptUrl)) {
        continue;
      }
      const scriptResponse = await fetchTextForResolution(scriptUrl, finalUrl, "application/javascript,text/javascript,*/*;q=0.8");
      if (!scriptResponse) {
        continue;
      }
      const scriptText = scriptResponse.text;
      const directFromScript = findMediaUrlInDecodedText(scriptText, scriptResponse.finalUrl || scriptUrl);
      if (directFromScript && !isKnownPlaceholderStream(directFromScript)) {
        return { streamUrl: await resolvePreferredHlsVariant(directFromScript, mediaRefererUrl, preferHlsVariant), refererUrl: mediaRefererUrl };
      }
      const unpackedScript = unpackDeanEdwardsPacker(scriptText);
      if (unpackedScript) {
        const directFromPackedScript = findMediaUrlInDecodedText(unpackedScript, scriptResponse.finalUrl || scriptUrl);
        if (directFromPackedScript && !isKnownPlaceholderStream(directFromPackedScript)) {
          return { streamUrl: await resolvePreferredHlsVariant(directFromPackedScript, mediaRefererUrl, preferHlsVariant), refererUrl: mediaRefererUrl };
        }
      }
    }

    for (const playerUrl of extractJavascriptPlayerUrls(html, finalUrl)) {
      if (visited.has(playerUrl)) {
        continue;
      }
      const nested = await resolveStreamTarget(playerUrl, depth + 1, visited, finalUrl, preferHlsVariant);
      if (nested) {
        return nested;
      }
    }
  } catch {
    return null;
  }

  return null;
}

function createOutputPath(input: CreateDownloadInput) {
  const show = sanitizeFilename(input.showTitle || "Show");
  const epCode = input.episodeNumber ? `E${String(input.episodeNumber).padStart(2, "0")}` : "E00";
  const season = `S${String(input.seasonNumber).padStart(2, "0")}`;
  const episodeTitle = sanitizeFilename(input.episodeTitle || "Episode");
  const episodeId = sanitizeEpisodeId(input.episodeId);
  const fileName = `${show} - ${season}${epCode} - ${episodeTitle} [${episodeId}].mp4`;
  return resolve(getDownloadsFolder(), fileName);
}

function createTemporaryOutputPath(outputPath: string) {
  return outputPath.replace(/\.mp4$/i, ".part.mp4");
}

function runFfmpeg(job: FullDownloadJob, streamUrl: string, outputPath: string, refererUrl?: string): Promise<void> {
  return new Promise((resolvePromise, rejectPromise) => {
    let totalDuration: number | null = null;
    let lastError = "";
    let lastPercent = 0;

    const args: string[] = [
      "-y",
      "-user_agent",
      USER_AGENT,
      "-protocol_whitelist",
      "file,http,https,tcp,tls,crypto,data",
      "-allowed_extensions",
      "ALL",
      "-extension_picky",
      "0",
      ...(refererUrl ? ["-referer", refererUrl] : []),
      "-i",
      streamUrl,
      "-map",
      "0:v:0?",
      "-map",
      "0:a:0?",
      "-c",
      "copy",
      "-bsf:a",
      "aac_adtstoasc",
      "-movflags",
      "+faststart",
      outputPath,
    ];

    const ffmpeg = execFile("ffmpeg", args, { windowsHide: true });
    activeFfmpegProcesses.set(job.id, ffmpeg);

    ffmpeg.stderr?.setEncoding("utf8");
    ffmpeg.stderr?.on("data", (chunk: string) => {
      lastError += chunk;
      
      const durationMatch = chunk.match(/Duration:\s*(\d+:\d+:\d+(?:\.\d+)?)/);
      if (durationMatch?.[1]) {
        totalDuration = parseDurationSeconds(durationMatch[1]);
      }

      const timeMatch = chunk.match(/time=(\d+:\d+:\d+(?:\.\d+)?)/);
      const sizeMatch = chunk.match(/size=\s*([0-9.]+(?:[kmg]?i?B)?)/i);
      const speedMatch = chunk.match(/speed=\s*([0-9.]+x)/i);
      const elapsed = timeMatch?.[1] ? parseDurationSeconds(timeMatch[1]) : null;

      if (elapsed !== null && totalDuration && totalDuration > 0) {
        const rawPercent = Math.max(0.1, Math.min(99.4, (elapsed / totalDuration) * 100));
        const percent = Math.max(lastPercent, Number(rawPercent.toFixed(rawPercent < 10 ? 1 : 0)));
        lastPercent = percent;
        const sizeText = formatMegabytesFromKilobytes(sizeMatch?.[1] ? parseSizeKilobytes(sizeMatch[1]) : null);
        const speedText = speedMatch?.[1] ?? null;
        const details = [sizeText, speedText].filter(Boolean).join(" • ");
        updateJob(job, {
          state: "downloading",
          percent,
          message: details ? `Downloading ${percent}% • ${details}` : `Downloading ${percent}%`,
        });
      } else if (sizeMatch?.[1]) {
        const sizeText = formatMegabytesFromKilobytes(parseSizeKilobytes(sizeMatch[1]));
        const speedText = speedMatch?.[1] ?? null;
        const details = [sizeText, speedText].filter(Boolean).join(" • ");
        updateJob(job, {
          state: "downloading",
          percent: Math.max(1, lastPercent),
          message: details ? `Downloading • ${details}` : "Downloading",
        });
      }
    });

    ffmpeg.on("error", (error) => {
      activeFfmpegProcesses.delete(job.id);
      rejectPromise(error);
    });

    ffmpeg.on("close", (code) => {
      activeFfmpegProcesses.delete(job.id);
      if (code === 0) {
        resolvePromise();
      } else {
        const errorMsg = lastError.split("\n").filter(Boolean).slice(-5).join(" ");
        rejectPromise(new Error(`ffmpeg failed: ${errorMsg || `exit code ${code}`}`));
      }
    });
  });
}

export function getFullDownloadJob(jobId: string) {
  return jobs.get(jobId) ?? null;
}

export function listFullDownloadJobsByEpisode() {
  return Array.from(jobs.values());
}

export async function resolveBrowserDownload(input: CreateDownloadInput): Promise<BrowserResolvedDownload> {
  const mergedCandidates = [
    {
      embedUrl: input.embedUrl,
      subtitlesUrl: input.subtitlesUrl,
    },
    ...(input.streamCandidates ?? []),
  ];
  const dedupedCandidates = Array.from(
    new Map(
      mergedCandidates
        .filter((candidate) => typeof candidate.embedUrl === "string" && candidate.embedUrl.trim().length > 0)
        .map((candidate) => [candidate.embedUrl, candidate]),
    ).values(),
  );

  let lastError: string | null = null;
  const errors: string[] = [];
  for (const [index, candidate] of dedupedCandidates.entries()) {
    const host = (() => {
      try {
        return new URL(candidate.embedUrl).hostname;
      } catch {
        return "invalid-url";
      }
    })();
    try {
      const rawDirectUrl = getDirectStreamUrl(candidate);
      const directUrl = rawDirectUrl && isFreshSignedStreamUrl(rawDirectUrl) ? rawDirectUrl : null;
      const resolved = directUrl
        ? { streamUrl: toValidatedHttpUrl(directUrl), refererUrl: candidate.embedUrl }
        : await resolveStreamTarget((await resolveCandidateEmbedUrl(candidate)) ?? candidate.embedUrl, 0, new Set<string>(), candidate.sourcePageUrl);

      if (!resolved) {
        lastError = "Could not resolve a direct stream URL for this provider.";
        errors.push(`${index + 1}. ${host}: ${lastError}`);
        continue;
      }

      const baseOutputName = basename(createOutputPath(input));
      const downloadUrl = `/api/download-full/browser-file?url=${encodeURIComponent(resolved.streamUrl)}&name=${encodeURIComponent(baseOutputName)}&referer=${encodeURIComponent(resolved.refererUrl)}`;

      return {
        downloadUrl,
        resolvedUrl: resolved.streamUrl,
        refererUrl: resolved.refererUrl,
      };
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
      errors.push(`${index + 1}. ${host}: ${lastError}`);
    }
  }

  throw new Error(
    errors.length
      ? `Could not resolve direct stream URL from ${dedupedCandidates.length} player link(s). ${errors.join(" | ")}`
      : lastError ?? "Could not resolve direct stream URL from player links.",
  );
}

export async function resolveCleanPlayback(input: CleanPlaybackResolveInput): Promise<CleanPlaybackResolveResult> {
  return resolveBrowserDownload(input);
}

function orderPlaybackPlayers(input: PlaybackResolveInput) {
  const remotePlayers = input.players.filter((player) => {
    const provider = player.provider?.toLowerCase();
    return player.embedUrl && provider !== "local" && provider !== "spillsave";
  });
  const active = remotePlayers.find((player) => player.alias === input.activePlayerAlias);
  const activeLanguage = active?.language;
  const activeIsSubtitleOnly = /titulky|subtitles|subbed/i.test(activeLanguage ?? "");
  const fallbackPool = activeLanguage
    ? remotePlayers.filter((player) =>
        player.alias === active?.alias ||
        player.language === activeLanguage ||
        (activeIsSubtitleOnly && /english|en\b|dab\/tit/i.test(player.language ?? "")),
      )
    : remotePlayers;
  const withDirect = fallbackPool.filter((player) => player.alias !== active?.alias && Boolean(player.streamUrl ?? player.resolvedUrl));
  const sameLanguage = remotePlayers.filter((player) =>
    player.alias !== active?.alias &&
    !withDirect.some((direct) => direct.alias === player.alias) &&
    activeLanguage &&
    player.language === activeLanguage
  );
  const remaining = fallbackPool.filter((player) =>
    player.alias !== active?.alias &&
    !withDirect.some((direct) => direct.alias === player.alias) &&
    !sameLanguage.some((same) => same.alias === player.alias)
  );
  return [active, ...withDirect, ...sameLanguage, ...remaining].filter(Boolean) as typeof remotePlayers;
}

export async function resolvePlaybackStream(input: PlaybackResolveInput): Promise<PlaybackResolveResult> {
  const orderedPlayers = orderPlaybackPlayers(input);
  const failures: PlaybackResolveFailure[] = [];
  const activePlayer = orderedPlayers.find((player) => player.alias === input.activePlayerAlias);
  const activeSubtitleUrl = activePlayer ? await resolveSubtitleUrlFromPlayer(activePlayer) : undefined;

  for (const player of orderedPlayers) {
    try {
      const candidateEmbedUrl = (await resolveCandidateEmbedUrl(player)) ?? player.embedUrl;
      const rawDirectUrl = getDirectStreamUrl({
        embedUrl: player.embedUrl,
        streamUrl: player.streamUrl,
        resolvedUrl: player.resolvedUrl,
      });
      const directUrlIsFresh = rawDirectUrl && canReuseDirectStreamUrl(player, candidateEmbedUrl, rawDirectUrl);
      const directUrl = directUrlIsFresh ? rawDirectUrl : null;
      let resolved = directUrl
        ? {
            streamUrl: toValidatedHttpUrl(directUrl),
            refererUrl: player.streamRefererUrl ?? player.sourcePageUrl ?? player.embedUrl,
          }
        : (await resolveVidkingStream(player.provider, candidateEmbedUrl)) ?? await resolveStreamTarget(candidateEmbedUrl, 0, new Set<string>(), player.sourcePageUrl, false);

      if (!resolved && !directUrl) {
        for (const alternateEmbedUrl of getAlternateProviderUrls(candidateEmbedUrl)) {
          resolved = await resolveStreamTarget(alternateEmbedUrl, 0, new Set<string>(), player.sourcePageUrl, false);
          if (resolved) {
            break;
          }
        }
      }

      if (!resolved) {
        const reachableEmbed = await canUseEmbedFallback(candidateEmbedUrl, player.sourcePageUrl);
        failures.push({
          playerAlias: player.alias,
          provider: player.provider,
          reason: reachableEmbed
            ? "Provider page is reachable but did not expose a direct MP4/HLS/DASH stream for the unified player."
            : "No MP4/HLS/DASH source found after following wrappers.",
        });
        continue;
      }

      const validation = await validateResolvedStream(resolved);
      if (!validation.ok) {
        if (directUrl) {
          const refreshed = (await resolveVidkingStream(player.provider, candidateEmbedUrl)) ?? await resolveStreamTarget(candidateEmbedUrl, 0, new Set<string>(), player.sourcePageUrl, false);
          if (refreshed) {
            const refreshedValidation = await validateResolvedStream(refreshed);
            if (refreshedValidation.ok) {
              return {
                playerAlias: player.alias,
                playbackUrl: buildPlaybackProxyPath(refreshed.streamUrl, refreshed.refererUrl, input.episodeId, refreshedValidation.streamType),
                resolvedUrl: refreshed.streamUrl,
                refererUrl: refreshed.refererUrl,
                streamType: refreshedValidation.streamType,
                subtitlesUrl: player.subtitlesUrl ?? extractSubtitleUrlFromPlayerUrl(player.embedUrl) ?? activeSubtitleUrl,
              };
            }
          }
        }
        failures.push({
          playerAlias: player.alias,
          provider: player.provider,
          reason: validation.reason,
        });
        continue;
      }

      return {
        playerAlias: player.alias,
        playbackUrl: buildPlaybackProxyPath(resolved.streamUrl, resolved.refererUrl, input.episodeId, validation.streamType),
        resolvedUrl: resolved.streamUrl,
        refererUrl: resolved.refererUrl,
        streamType: validation.streamType,
        subtitlesUrl: player.subtitlesUrl ?? extractSubtitleUrlFromPlayerUrl(player.embedUrl) ?? activeSubtitleUrl,
      };
    } catch (error) {
      failures.push({
        playerAlias: player.alias,
        provider: player.provider,
        reason: error instanceof Error ? error.message : String(error),
      });
    }
  }

  const summary = failures.map((failure) => `${failure.provider}: ${failure.reason}`).join(" | ");
  const error = summary || "No remote player links are available for this episode.";
  throw Object.assign(new Error(error), { failures });
}

export async function createFullDownloadJob(input: CreateDownloadInput): Promise<FullDownloadJob> {
  const existingJob = Array.from(jobs.values()).find(
    (entry) => entry.episodeId === input.episodeId && isActiveDownloadState(entry.state),
  );
  if (existingJob) {
    return existingJob;
  }

  const job = createJob(input.episodeId);

  void (async () => {
    const outputPath = createOutputPath(input);
    const temporaryOutputPath = createTemporaryOutputPath(outputPath);
    activeOutputPaths.set(job.id, {
      episodeId: input.episodeId,
      outputPath,
      temporaryOutputPath,
    });

    try {
      const mergedCandidates = [
        {
          embedUrl: input.embedUrl,
          subtitlesUrl: input.subtitlesUrl,
        },
        ...(input.streamCandidates ?? []),
      ];
      const dedupedCandidates = Array.from(
        new Map(
          mergedCandidates
            .filter((candidate) => typeof candidate.embedUrl === "string" && candidate.embedUrl.trim().length > 0)
            .map((candidate) => [candidate.embedUrl, candidate]),
        ).values(),
      );

      await mkdir(dirname(outputPath), { recursive: true });
      await removeFileIfExists(temporaryOutputPath);
      await removeFileIfExists(outputPath);
      ensureNotCanceled(job.id);

      let selectedEmbedUrl = input.embedUrl;
      let selectedSubtitlesUrl = input.subtitlesUrl;
      let downloadSucceeded = false;
      let lastError: string | null = null;
      const candidateErrors: string[] = [];

      for (let index = 0; index < dedupedCandidates.length; index += 1) {
        ensureNotCanceled(job.id);
        const candidate = dedupedCandidates[index];
        const stepLabel = dedupedCandidates.length > 1 ? ` (${index + 1}/${dedupedCandidates.length})` : "";
        const host = (() => {
          try {
            return new URL(candidate.embedUrl).hostname;
          } catch {
            return "invalid-url";
          }
        })();

        updateJob(job, {
          state: "resolving",
          percent: 0,
          message: `Resolving stream URL${stepLabel}`,
        });

        let resolvedTarget: ResolvedStreamTarget | null = null;
        try {
          const rawDirectUrl = getDirectStreamUrl(candidate);
          const directUrl = rawDirectUrl && isFreshSignedStreamUrl(rawDirectUrl) ? rawDirectUrl : null;
          resolvedTarget = directUrl
            ? {
                streamUrl: toValidatedHttpUrl(directUrl),
                refererUrl: candidate.embedUrl,
              }
            : await resolveStreamTarget((await resolveCandidateEmbedUrl(candidate)) ?? candidate.embedUrl, 0, new Set<string>(), candidate.sourcePageUrl);
        } catch (error) {
          lastError = error instanceof Error ? error.message : String(error);
          candidateErrors.push(`${index + 1}. ${host}: ${lastError}`);
          console.warn("[DOWNLOAD] Stream candidate resolve failed", {
            episodeId: input.episodeId,
            candidate: candidate.embedUrl,
            error: lastError,
          });
          continue;
        }

        if (!resolvedTarget) {
          lastError = "Could not resolve a direct stream URL for this provider.";
          candidateErrors.push(`${index + 1}. ${host}: ${lastError}`);
          console.warn("[DOWNLOAD] Stream candidate produced no direct URL", {
            episodeId: input.episodeId,
            candidate: candidate.embedUrl,
          });
          continue;
        }

        selectedEmbedUrl = candidate.embedUrl;
        selectedSubtitlesUrl = candidate.subtitlesUrl ?? selectedSubtitlesUrl;

        await removeFileIfExists(temporaryOutputPath);
        await removeFileIfExists(outputPath);
        ensureNotCanceled(job.id);

        updateJob(job, {
          state: "downloading",
          percent: 1,
          message: dedupedCandidates.length > 1 ? `Starting ffmpeg${stepLabel}` : "Starting ffmpeg",
          outputPath,
        });

        try {
          await runFfmpeg(job, resolvedTarget.streamUrl, temporaryOutputPath, resolvedTarget.refererUrl || selectedEmbedUrl);
          ensureNotCanceled(job.id);

          await removeFileIfExists(outputPath);
          await rename(temporaryOutputPath, outputPath);
          ensureNotCanceled(job.id);

          const fileExists = await probeVideoFile(outputPath);
          if (!fileExists) {
            throw new Error("Downloaded file failed validation - file is corrupt or unplayable.");
          }

          downloadSucceeded = true;
          break;
        } catch (error) {
          lastError = error instanceof Error ? error.message : String(error);
          candidateErrors.push(`${index + 1}. ${host}: ${lastError}`);
          console.warn("[DOWNLOAD] Stream candidate ffmpeg failed", {
            episodeId: input.episodeId,
            candidate: candidate.embedUrl,
            streamUrl: resolvedTarget.streamUrl,
            error: lastError,
          });
          await removeFileIfExists(temporaryOutputPath);
          await removeFileIfExists(outputPath);
        }
      }

      if (!downloadSucceeded) {
        throw new Error(
          candidateErrors.length
            ? `Could not download from ${dedupedCandidates.length} player link(s). ${candidateErrors.join(" | ")}`
            : lastError ?? "Could not resolve a direct stream URL for this provider.",
        );
      }

      ensureNotCanceled(job.id);

      const index = await readDownloadIndex();
      index[input.episodeId] = outputPath;
      await writeDownloadIndex(index);

      try {
        await downloadSubtitlesForEpisode(input.episodeId, selectedSubtitlesUrl, selectedEmbedUrl);
      } catch (error) {
        console.warn("[SUBS] Failed to download subtitles:", error);
      }

      updateJob(job, {
        state: "completed",
        percent: 100,
        message: "Download completed",
        outputPath,
      });
    } catch (error) {
      const canceled = isCancelRequested(job.id);
      updateJob(job, {
        state: "failed",
        message: canceled ? "Download canceled" : "Download failed",
        error: canceled ? "Canceled by user" : error instanceof Error ? error.message : "Unknown error",
      });
      await removeFileIfExists(temporaryOutputPath);
      await removeFileIfExists(outputPath);
    } finally {
      activeFfmpegProcesses.delete(job.id);
      activeOutputPaths.delete(job.id);
      cancelRequestedJobs.delete(job.id);
    }
  })();

  return job;
}

export async function getDownloadedEpisodes(): Promise<string[]> {
  try {
    const folder = getDownloadsFolder();
    const files = await readdir(folder);
    return files.filter((f) => f.endsWith(".mp4") && f !== DOWNLOAD_INDEX_FILE);
  } catch {
    return [];
  }
}

export async function listDownloadedEpisodeIds(): Promise<string[]> {
  const ids = new Set<string>();

  try {
    const index = await readDownloadIndex();
    const folder = getDownloadsFolder();

    for (const [episodeId, filePath] of Object.entries(index)) {
      try {
        await stat(filePath);
        ids.add(episodeId);
      } catch {
        console.log(`[LIST] File not found for episode ${episodeId}: ${filePath}`);
      }
    }

    try {
      await stat(folder);
    } catch (error) {
      const err = error as NodeJS.ErrnoException;
      if (err.code === "ENOENT") {
        return [];
      }
      throw error;
    }

    const files = await readdir(folder);
    for (const fileName of files) {
      if (!fileName.toLowerCase().endsWith(".mp4")) {
        continue;
      }

      const match = fileName.match(/\[([^\]]+)\]\.mp4$/i);
      const taggedId = match?.[1]?.trim();
      if (taggedId) {
        ids.add(taggedId);
      }
    }
  } catch (error) {
    const err = error as NodeJS.ErrnoException;
    if (err.code === "ENOENT") {
      return [];
    }
    console.error("[LIST] Error listing downloads:", error);
    return [];
  }

  console.log("[LIST] Found downloaded episodes:", Array.from(ids));
  return Array.from(ids);
}

export async function findEpisodeDownload(episodeId: string): Promise<string | null> {
  try {
    const index = await readDownloadIndex();
    const indexedPath = index[episodeId];
    if (indexedPath) {
      if (await isValidDownloadFile(episodeId, indexedPath)) {
        return indexedPath;
      }
      return null;
    }

    const folder = getDownloadsFolder();
    const files = await readdir(folder);
    const expectedTag = `[${sanitizeEpisodeId(episodeId).toLowerCase()}]`;

    const match = files.find((fileName) => {
      if (!fileName.endsWith(".mp4")) {
        return false;
      }

      const normalized = fileName.toLowerCase();
      return normalized.includes(expectedTag);
    });

    if (!match) {
      return null;
    }

    const resolved = resolve(folder, match);
    if (await isValidDownloadFile(episodeId, resolved)) {
      return resolved;
    }

    return null;
  } catch {
    return null;
  }
}

type SubtitleCandidate = {
  file: string;
  label: string;
  language?: string;
};

function toSafeHttpUrl(value: string | null | undefined) {
  if (!value) return null;
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
    return parsed.toString();
  } catch {
    return null;
  }
}

function inferLabelFromFileUrl(fileUrl: string) {
  try {
    const parsed = new URL(fileUrl);
    const fromLabel = parsed.searchParams.get("label") ?? parsed.searchParams.get("lang");
    if (fromLabel?.trim()) return fromLabel.trim();
  } catch {
    // no-op
  }
  return "Subtitle";
}

function readEmbedSubtitleCandidates(embedUrl?: string): SubtitleCandidate[] {
  if (!embedUrl) return [];

  let parsed: URL;
  try {
    parsed = new URL(embedUrl);
  } catch {
    return [];
  }

  const candidates: SubtitleCandidate[] = [];
  for (let i = 1; i <= 8; i += 1) {
    const file = parsed.searchParams.get(`c${i}_file`);
    if (!file) continue;

    const safeFile = toSafeHttpUrl(file);
    if (!safeFile) continue;

    const label = (parsed.searchParams.get(`c${i}_label`) ?? "Subtitle").trim() || "Subtitle";
    candidates.push({ file: safeFile, label, language: label });
  }

  return candidates;
}

async function readSubtitleCandidatesFromSource(subtitlesUrl?: string, embedUrl?: string): Promise<SubtitleCandidate[]> {
  const candidates: SubtitleCandidate[] = [];

  const safeSubtitlesUrl = toSafeHttpUrl(subtitlesUrl);
  if (safeSubtitlesUrl) {
    const response = await fetch(safeSubtitlesUrl, {
      headers: {
        "user-agent": USER_AGENT,
        accept: "application/json,text/plain,*/*",
        referer: embedUrl ?? "https://svetserialu.to/",
      },
    });

    if (response.ok) {
      const contentType = (response.headers.get("content-type") || "").toLowerCase();
      if (contentType.includes("application/json") || contentType.includes("text/json")) {
        const payload = (await response.json()) as Array<{
          file?: string;
          label?: string;
          kind?: string;
          default?: boolean;
        }>;
        if (Array.isArray(payload)) {
          for (const entry of payload) {
            const safeFile = toSafeHttpUrl(entry.file);
            if (!safeFile) continue;
            const label = (entry.label ?? "Subtitle").trim() || "Subtitle";
            candidates.push({ file: safeFile, label, language: entry.label });
          }
        }
      } else {
        const text = await response.text();
        if (text.trim()) {
          candidates.push({
            file: safeSubtitlesUrl,
            label: inferLabelFromFileUrl(safeSubtitlesUrl),
            language: undefined,
          });
        }
      }
    }
  }

  candidates.push(...readEmbedSubtitleCandidates(embedUrl));

  const deduped = new Map<string, SubtitleCandidate>();
  for (const candidate of candidates) {
    if (!deduped.has(candidate.file)) {
      deduped.set(candidate.file, candidate);
    }
  }

  return [...deduped.values()];
}

function srtToVtt(content: string): string {
  let vtt = content.trim();

  // If already VTT, just ensure it's clean
  if (vtt.startsWith("WEBVTT")) {
    return vtt;
  }

  // Convert SRT to VTT
  // 1. Timestamps: 00:00:20,000 --> 00:00:24,400  =>  00:00:20.000 --> 00:00:24.400
  vtt = vtt.replace(/(\d{2}:\d{2}:\d{2}),(\d{3})/g, "$1.$2");

  // 2. Prepend WEBVTT header
  return `WEBVTT\n\n${vtt}`;
}

async function downloadSubtitlesForEpisode(episodeId: string, subtitlesUrl?: string, embedUrl?: string) {
  const candidates = await readSubtitleCandidatesFromSource(subtitlesUrl, embedUrl);
  if (candidates.length === 0) {
    return;
  }

  const folder = resolve(getSubtitlesFolder(), sanitizeEpisodeId(episodeId));
  await mkdir(folder, { recursive: true });

  const entries: SubtitleEntry[] = [];

  for (const [index, candidate] of candidates.entries()) {
    const fileUrl = candidate.file;

    let fileResponse: Response;
    try {
      fileResponse = await fetch(fileUrl, {
        headers: {
          "user-agent": USER_AGENT,
          accept: "text/vtt,text/plain,*/*",
          referer: embedUrl ?? "https://svetserialu.to/",
        },
      });
    } catch {
      continue;
    }

    if (!fileResponse.ok) {
      continue;
    }

    // Handle potential encoding issues by reading as arrayBuffer and then decoding
    // We try UTF-8 first, and if it looks like it has garbled characters, we might need a fallback,
    // but for now let's focus on format conversion.
    const buffer = await fileResponse.arrayBuffer();
    const decoder = new TextDecoder("utf-8");
    let body = decoder.decode(buffer);

    if (!body.trim()) {
      continue;
    }

    // Convert to VTT if needed
    body = srtToVtt(body);

    const label = (candidate.label ?? "Subtitle").trim() || "Subtitle";
    const safeLabel = sanitizeSubtitleLabel(label);
    const fileName = `${String(index + 1).padStart(2, "0")}-${safeLabel}.vtt`;
    const filePath = resolve(folder, fileName);
    await writeFile(filePath, body, "utf8");

    entries.push({
      fileName,
      label,
      language: candidate.language,
    });
  }

  if (entries.length === 0) {
    return;
  }

  const index = await readSubtitleIndex();
  index[episodeId] = entries;
  await writeSubtitleIndex(index);
}

export async function findEpisodeDownloadByFileName(fileName: string): Promise<string | null> {
  const safeName = basename(fileName || "");
  if (!safeName || !safeName.toLowerCase().endsWith(".mp4")) {
    return null;
  }

  try {
    const folder = getDownloadsFolder();
    const resolved = resolve(folder, safeName);
    const normalizedFolder = resolve(folder) + sep;
    if (!resolved.toLowerCase().startsWith(normalizedFolder.toLowerCase())) {
      return null;
    }

    await stat(resolved);
    const playable = await isPlayableFile(resolved);
    return playable ? resolved : null;
  } catch {
    return null;
  }
}

export async function findEpisodeDownloadFast(episodeId: string): Promise<string | null> {
  try {
    const index = await readDownloadIndex();
    const indexedPath = index[episodeId];
    if (indexedPath) {
      const exists = await stat(indexedPath).then(() => true).catch(() => false);
      if (exists) return indexedPath;
    }

    const folder = getDownloadsFolder();
    console.log(`[LOOKUP] Searching in folder: ${folder}`);
    
    const stats = await stat(folder).catch(() => null);
    if (!stats?.isDirectory()) {
      console.warn(`[LOOKUP] Folder not found or not a directory: ${folder}`);
      return null;
    }

    const files = await readdir(folder);
    console.log(`[LOOKUP] Found ${files.length} files in folder.`);
    
    const sanitized = sanitizeEpisodeId(episodeId);
    const expectedTag = `[${sanitized.toLowerCase()}]`;
    console.log(`[LOOKUP] Looking for tag: ${expectedTag} (original id: ${episodeId})`);

    const match = files.find((fileName) => {
      if (!fileName.toLowerCase().endsWith(".mp4")) {
        return false;
      }

      const normalized = fileName.toLowerCase();
      const hasTag = normalized.includes(expectedTag);
      return hasTag;
    });

    if (!match) {
      console.warn(`[LOOKUP] No file matched tag ${expectedTag} in ${folder}`);
      if (files.length > 0) {
        console.log(`[LOOKUP] First few files: ${files.slice(0, 3).join(", ")}`);
      }
      return null;
    }

    const resolved = resolve(folder, match);
    console.log(`[LOOKUP] Found match: ${resolved}`);
    return resolved;
  } catch (error) {
    console.error("[LOOKUP] Error during lookup:", error);
    return null;
  }
}

export async function findEpisodeDownloadByFileNameFast(fileName: string): Promise<string | null> {
  const safeName = basename(fileName || "");
  if (!safeName || !safeName.toLowerCase().endsWith(".mp4")) {
    return null;
  }

  try {
    const folder = getDownloadsFolder();
    const resolved = resolve(folder, safeName);
    const normalizedFolder = resolve(folder) + sep;
    if (!resolved.toLowerCase().startsWith(normalizedFolder.toLowerCase())) {
      return null;
    }

    await stat(resolved);
    return resolved;
  } catch {
    return null;
  }
}

export async function getDownloadedSubtitles(episodeId: string): Promise<SubtitleEntry[]> {
  try {
    const index = await readSubtitleIndex();
    return Array.isArray(index[episodeId]) ? index[episodeId] : [];
  } catch {
    return [];
  }
}

export async function findSubtitleFilePath(episodeId: string, fileName: string): Promise<string | null> {
  const safeName = basename(fileName || "");
  if (!safeName || !safeName.toLowerCase().endsWith(".vtt")) {
    return null;
  }

  const folder = resolve(getSubtitlesFolder(), sanitizeEpisodeId(episodeId));
  const resolved = resolve(folder, safeName);
  const normalizedFolder = resolve(folder) + sep;
  if (!resolved.toLowerCase().startsWith(normalizedFolder.toLowerCase())) {
    return null;
  }

  try {
    await stat(resolved);
    return resolved;
  } catch {
    return null;
  }
}

export async function deleteEpisodeDownload(episodeId: string): Promise<void> {
  const filePath = await findEpisodeDownloadFast(episodeId);
  if (!filePath) {
    throw new Error("Downloaded file not found.");
  }
  await cleanupDownloadArtifacts(episodeId, filePath);
}

export async function cancelFullDownloadJob(episodeId: string): Promise<FullDownloadJob> {
  const activeJob = Array.from(jobs.values())
    .filter((job) => job.episodeId === episodeId && isActiveDownloadState(job.state))
    .sort((left, right) => right.updatedAt - left.updatedAt)[0];

  if (!activeJob) {
    throw new Error("No active download found for this episode.");
  }

  cancelRequestedJobs.add(activeJob.id);
  updateJob(activeJob, {
    state: "downloading",
    message: "Cancelling download...",
  });

  const ffmpeg = activeFfmpegProcesses.get(activeJob.id);
  if (ffmpeg && !ffmpeg.killed) {
    try {
      ffmpeg.kill("SIGKILL");
    } catch {
      try {
        ffmpeg.kill();
      } catch {
        // no-op
      }
    }
  }

  const runtime = activeOutputPaths.get(activeJob.id);
  if (runtime) {
    await removeFileIfExists(runtime.temporaryOutputPath);
    await cleanupDownloadArtifacts(episodeId, runtime.outputPath);
  }

  return updateJob(activeJob, {
    state: "failed",
    percent: 0,
    message: "Download canceled",
    error: "Canceled by user",
  });
}
