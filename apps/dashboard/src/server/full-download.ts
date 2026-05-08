import { createDecipheriv } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readdir, readFile, rename, stat, unlink, writeFile, rm } from "node:fs/promises";
import { basename, dirname, resolve, sep } from "node:path";
import { execFile, type ChildProcess } from "node:child_process";

const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

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

type CreateDownloadInput = {
  episodeId: string;
  showTitle: string;
  episodeTitle?: string | null;
  seasonNumber: number;
  episodeNumber: number | null;
  embedUrl: string;
  subtitlesUrl?: string;
  streamCandidates?: Array<{
    embedUrl: string;
    subtitlesUrl?: string;
  }>;
};

export type BrowserResolvedDownload = {
  downloadUrl: string;
  resolvedUrl: string;
  refererUrl: string;
};

type ResolvedStreamTarget = {
  streamUrl: string;
  refererUrl: string;
};

const jobs = new Map<string, FullDownloadJob>();
const activeFfmpegProcesses = new Map<string, ChildProcess>();
const activeOutputPaths = new Map<string, { outputPath: string; temporaryOutputPath: string; episodeId: string }>();
const cancelRequestedJobs = new Set<string>();
const DOWNLOAD_INDEX_FILE = "index.json";
const SUBTITLE_INDEX_FILE = "subtitles.json";
const REPAIRED_DOWNLOADS = new Set<string>();

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
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, " ")
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
  if (trimmed.startsWith("/")) return `https:/${trimmed}`;
  return `https://${trimmed}`;
}

function unpackDeanEdwardsPacker(source: string) {
  const match = source.match(
    /eval\(function\(p,a,c,k,e,d\)\{[\s\S]*?\}\('([\s\S]*?)',\s*(\d+),\s*(\d+),\s*'([\s\S]*?)'\.split\('\|'\)/,
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

function findMediaUrlInText(text: string) {
  const directMp4Match = text.match(/https?:\/\/[^\s"'<>]+\.mp4[^\s"'<>]*/i);
  if (directMp4Match?.[0]) {
    return directMp4Match[0].replace(/\\u0026/g, "&");
  }

  const filePropertyMatch = text.match(/file\s*:\s*['"]([^'"]+\.(?:m3u8|mp4)[^'"]*)['"]/i);
  if (filePropertyMatch?.[1]) {
    return filePropertyMatch[1].replace(/\\u0026/g, "&");
  }

  const directM3u8Match = text.match(/https?:\/\/[^\s"'<>]+\.m3u8[^\s"'<>]*/i);
  if (directM3u8Match?.[0]) {
    return directM3u8Match[0].replace(/\\u0026/g, "&");
  }

  return null;
}

function isKnownPlaceholderStream(url: string) {
  return /test-videos\.co\.uk|big_buck_bunny/i.test(url);
}

async function resolvePreferredHlsVariant(streamUrl: string, refererUrl: string) {
  if (!/\.m3u8(?:$|[?#])/i.test(streamUrl)) {
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
        variants.push({
          bandwidth: Number.isFinite(bandwidth) ? bandwidth : 0,
          url: new URL(nextLine, response.url).toString(),
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
  const iframeMatch = text.match(/<iframe[^>]+src=["']([^"'#?][^"']*)["']/i);
  if (!iframeMatch?.[1]) {
    return null;
  }

  try {
    return new URL(iframeMatch[1], baseUrl).toString();
  } catch {
    return null;
  }
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

function remuxToFaststart(inputPath: string, outputPath: string): Promise<void> {
  return new Promise((resolvePromise, rejectPromise) => {
    const ffmpeg = execFile(
      "ffmpeg",
      [
        "-y",
        "-i",
        inputPath,
        "-c",
        "copy",
        "-movflags",
        "+faststart",
        outputPath,
      ],
      { stdio: ["ignore", "ignore", "pipe"] } as any,
    );

    let lastError = "";
    ffmpeg.stderr?.setEncoding("utf8");
    ffmpeg.stderr?.on("data", (chunk: string) => {
      lastError += chunk;
    });

    ffmpeg.on("error", (error) => rejectPromise(error));
    ffmpeg.on("close", (code) => {
      if (code === 0) {
        resolvePromise();
      } else {
        rejectPromise(new Error(`ffmpeg remux failed: ${lastError || `exit code ${code}`}`));
      }
    });
  });
}

function probeVideoFile(filePath: string): Promise<boolean> {
  return new Promise((resolvePromise) => {
    const ffmpeg = execFile(
      "ffmpeg",
      ["-v", "error", "-i", filePath, "-f", "null", "-"],
      { stdio: ["ignore", "ignore", "pipe"] } as any,
    );

    ffmpeg.on("error", () => resolvePromise(false));
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

const REPAIR_PROMISES = new Map<string, Promise<string>>();

export async function ensureSeekableDownloadFile(episodeId: string, filePath: string): Promise<string> {
  // Repair disabled temporarily to troubleshoot playback issues.
  return filePath;
}

async function isValidDownloadFile(episodeId: string, filePath: string) {
  const exists = await probeVideoFile(filePath);
  if (!exists) {
    await cleanupDownloadArtifacts(episodeId, filePath);
    return false;
  }

  return true;
}

async function resolveF16PxStream(embedUrl: string): Promise<string | null> {
  const parsed = new URL(embedUrl);
  const parts = parsed.pathname.split("/").filter(Boolean);
  if (parts[0] !== "e" || !parts[1]) {
    return null;
  }

  const code = parts[1];
  const playbackUrl = `${parsed.origin}/api/videos/${encodeURIComponent(code)}/embed/playback`;
  const response = await fetch(playbackUrl, {
    headers: {
      "user-agent": USER_AGENT,
      accept: "application/json,text/plain,*/*",
      referer: embedUrl,
      origin: parsed.origin,
    },
  });

  if (!response.ok) {
    return null;
  }

  const body = (await response.json()) as {
    playback?: {
      iv?: string;
      payload?: string;
      key_parts?: string[];
      iv2?: string;
      payload2?: string;
      decrypt_keys?: { edge_1?: string; edge_2?: string };
    };
  };

  const pb = body.playback;
  if (!pb) {
    return null;
  }

  const sources: string[] = [];

  if (pb.iv && pb.payload && Array.isArray(pb.key_parts) && pb.key_parts.length > 0) {
    const key = Buffer.concat(pb.key_parts.map((value) => base64UrlToBuffer(value)));
    const decoded = decryptAesGcmPayload(pb.iv, pb.payload, key);
    sources.push(...extractSources(decoded));
  }

  if (pb.iv2 && pb.payload2 && pb.decrypt_keys?.edge_1 && pb.decrypt_keys?.edge_2) {
    const key2 = Buffer.concat([base64UrlToBuffer(pb.decrypt_keys.edge_1), base64UrlToBuffer(pb.decrypt_keys.edge_2)]);
    const decoded2 = decryptAesGcmPayload(pb.iv2, pb.payload2, key2);
    sources.push(...extractSources(decoded2));
  }

  const unique = Array.from(new Set(sources));
  return unique.find((entry) => entry.includes(".m3u8")) ?? unique[0] ?? null;
}

async function resolveStreamTarget(embedUrl: string, depth = 0, visited = new Set<string>()): Promise<ResolvedStreamTarget | null> {
  // Reject svetserialu internal endpoints - they need server-side resolution
  if (embedUrl.includes("svetserialu.to/sources/")) {
    throw new Error(
      "Episode using svetserialu internal endpoint. The show needs to be re-imported to access streaming providers.",
    );
  }

  if (visited.has(embedUrl) || depth > 4) {
    return null;
  }
  visited.add(embedUrl);

  if (embedUrl.includes("f16px")) {
    const streamUrl = await resolveF16PxStream(embedUrl);
    return streamUrl ? { streamUrl, refererUrl: embedUrl } : null;
  }

  if (/streamtape\./i.test(embedUrl)) {
    const streamUrl = await resolveStreamtapeUrl(embedUrl);
    return streamUrl ? { streamUrl, refererUrl: embedUrl } : null;
  }

  if (embedUrl.includes(".m3u8") || embedUrl.includes(".mp4")) {
    const preferredUrl = await resolvePreferredHlsVariant(embedUrl, embedUrl);
    return { streamUrl: preferredUrl, refererUrl: embedUrl };
  }

  try {
    const response = await fetch(embedUrl, {
      headers: {
        "user-agent": USER_AGENT,
        accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        referer: "https://www.bombuj.si/",
      },
      redirect: "follow",
    });
    if (!response.ok) {
      return null;
    }
    const html = await response.text();

    const direct = findMediaUrlInText(html);
    if (direct && !isKnownPlaceholderStream(direct)) {
      return { streamUrl: await resolvePreferredHlsVariant(direct, response.url), refererUrl: response.url };
    }

    const unpacked = unpackDeanEdwardsPacker(html);
    if (unpacked) {
      const fromPacked = findMediaUrlInText(unpacked);
      if (fromPacked && !isKnownPlaceholderStream(fromPacked)) {
        return { streamUrl: await resolvePreferredHlsVariant(fromPacked, response.url), refererUrl: response.url };
      }
    }

    const redirectUrl = extractScriptRedirectUrl(html, response.url);
    if (redirectUrl && redirectUrl !== embedUrl) {
      const redirected = await resolveStreamTarget(redirectUrl, depth + 1, visited);
      if (redirected) {
        return redirected;
      }
    }

    const iframeUrl = extractIframeUrl(html, response.url);
    if (iframeUrl && iframeUrl !== embedUrl) {
      const nested = await resolveStreamTarget(iframeUrl, depth + 1, visited);
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

    const ffmpeg = execFile(
      "ffmpeg",
      args,
      { stdio: ["ignore", "ignore", "pipe"] } as any,
    );
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
  for (const candidate of dedupedCandidates) {
    try {
      const resolved = await resolveStreamTarget(candidate.embedUrl);
      if (!resolved) {
        lastError = "Could not resolve a direct stream URL for this provider.";
        continue;
      }

      const parsed = new URL(resolved.streamUrl);
      if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
        lastError = "Resolved stream has unsupported protocol.";
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
    }
  }

  throw new Error(lastError ?? "Could not resolve direct stream URL from player links.");
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

      for (let index = 0; index < dedupedCandidates.length; index += 1) {
        ensureNotCanceled(job.id);
        const candidate = dedupedCandidates[index];
        const stepLabel = dedupedCandidates.length > 1 ? ` (${index + 1}/${dedupedCandidates.length})` : "";

        updateJob(job, {
          state: "resolving",
          percent: 0,
          message: `Resolving stream URL${stepLabel}`,
        });

        let resolvedTarget: ResolvedStreamTarget | null = null;
        try {
          resolvedTarget = await resolveStreamTarget(candidate.embedUrl);
        } catch (error) {
          lastError = error instanceof Error ? error.message : String(error);
          console.warn("[DOWNLOAD] Stream candidate resolve failed", {
            episodeId: input.episodeId,
            candidate: candidate.embedUrl,
            error: lastError,
          });
          continue;
        }

        if (!resolvedTarget) {
          lastError = "Could not resolve a direct stream URL for this provider.";
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
        throw new Error(lastError ?? "Could not resolve a direct stream URL for this provider.");
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
