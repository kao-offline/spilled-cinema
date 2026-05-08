import { FFmpeg } from "@ffmpeg/ffmpeg";
import { toBlobURL } from "@ffmpeg/util";
import type { LibraryEpisode } from "./types";
import type { BrowserResolvedDownload } from "./full-download-client";
import { requireWritableLibraryFolder, writeBlobToLibraryVault, writeResponseToLibraryVault } from "./library-folder";
import { buildRuntimeUrl } from "./local-api";

const FFMPEG_CORE_BASE_URL = "https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.12.10/dist/esm";

type BrowserDownloadProgress = {
  percent: number;
  message: string;
};

type ManifestAsset = {
  sourceUrl: string;
  localName: string;
};

type MaterializedManifest = {
  manifestText: string;
  assets: ManifestAsset[];
  sourceUrl: string;
};

let ffmpegInstance: FFmpeg | null = null;
let ffmpegLoadPromise: Promise<FFmpeg> | null = null;
let progressListener: ((event: { progress: number }) => void) | null = null;

function reportProgress(
  callback: ((progress: BrowserDownloadProgress) => void) | undefined,
  percent: number,
  message: string,
) {
  callback?.({
    percent: Math.max(0, Math.min(100, Math.round(percent))),
    message,
  });
}

function sanitizeFileName(value: string) {
  const cleaned = String(value || "download.mp4")
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 150);
  if (!cleaned) {
    return "download.mp4";
  }
  return /\.[a-z0-9]{2,5}$/i.test(cleaned) ? cleaned : `${cleaned}.mp4`;
}

function getDownloadFileName(episode: Pick<LibraryEpisode, "showTitle" | "episodeTitle" | "episodeNumber">, downloadUrl: string) {
  try {
    const parsed = new URL(downloadUrl, window.location.origin);
    const name = parsed.searchParams.get("name");
    if (name) {
      return sanitizeFileName(name);
    }
  } catch {
    // Ignore malformed browser proxy URLs and fall back to generated name.
  }

  const title = episode.episodeTitle?.trim() || `Episode ${episode.episodeNumber ?? "Unknown"}`;
  return sanitizeFileName(`${episode.showTitle} - ${title}.mp4`);
}

function buildProxyUrl(sourceUrl: string, refererUrl: string, fileName: string) {
  return buildRuntimeUrl(`/api/download-full/browser-file?url=${encodeURIComponent(sourceUrl)}&name=${encodeURIComponent(fileName)}&referer=${encodeURIComponent(refererUrl)}`);
}

function getFileExtension(sourceUrl: string) {
  try {
    const pathname = new URL(sourceUrl).pathname;
    const match = pathname.match(/\.([a-z0-9]{2,5})$/i);
    return match?.[1]?.toLowerCase() ?? "bin";
  } catch {
    return "bin";
  }
}

function isHlsPlaylistUrl(value: string) {
  return /\.m3u8(?:$|[?#])/i.test(value);
}

function parseAttributeList(line: string) {
  const output: Record<string, string> = {};
  const body = line.includes(":") ? line.slice(line.indexOf(":") + 1) : "";
  const regex = /([A-Z0-9-]+)=("(?:[^"\\]|\\.)*"|[^,]+)/gi;

  for (const match of body.matchAll(regex)) {
    const rawValue = match[2] ?? "";
    output[match[1]] =
      rawValue.startsWith("\"") && rawValue.endsWith("\"") ? rawValue.slice(1, -1) : rawValue;
  }

  return output;
}

function getAbsoluteUrl(target: string, baseUrl: string) {
  return new URL(target, baseUrl).toString();
}

function createLocalName(index: number, sourceUrl: string, prefix: string) {
  return `${prefix}-${String(index).padStart(4, "0")}.${getFileExtension(sourceUrl)}`;
}

async function fetchText(url: string, signal?: AbortSignal) {
  const response = await fetch(url, { signal });
  if (!response.ok) {
    throw new Error(`Proxy request failed (${response.status}).`);
  }
  return response.text();
}

async function fetchBinary(
  url: string,
  signal?: AbortSignal,
  onChunk?: (receivedBytes: number, totalBytes: number | null) => void,
) {
  const response = await fetch(url, { signal });
  if (!response.ok || !response.body) {
    throw new Error(`Proxy request failed (${response.status}).`);
  }

  const contentLengthHeader = response.headers.get("content-length");
  const totalBytes = contentLengthHeader ? Number.parseInt(contentLengthHeader, 10) : Number.NaN;
  const expectedBytes = Number.isFinite(totalBytes) && totalBytes > 0 ? totalBytes : null;
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let receivedBytes = 0;

  while (true) {
    signal?.throwIfAborted();
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;
    chunks.push(value);
    receivedBytes += value.byteLength;
    onChunk?.(receivedBytes, expectedBytes);
  }

  const output = new Uint8Array(receivedBytes);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return output;
}

function chooseHighestBandwidthVariant(manifestText: string, manifestUrl: string) {
  const lines = manifestText.split(/\r?\n/);
  const variants: Array<{ bandwidth: number; url: string }> = [];

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]?.trim();
    if (!line?.startsWith("#EXT-X-STREAM-INF")) {
      continue;
    }

    const bandwidth = Number.parseInt(line.match(/BANDWIDTH=(\d+)/i)?.[1] ?? "0", 10);
    const nextLine = lines[index + 1]?.trim();
    if (!nextLine || nextLine.startsWith("#")) {
      continue;
    }

    variants.push({
      bandwidth: Number.isFinite(bandwidth) ? bandwidth : 0,
      url: getAbsoluteUrl(nextLine, manifestUrl),
    });
  }

  variants.sort((left, right) => right.bandwidth - left.bandwidth);
  return variants[0]?.url ?? null;
}

async function materializeMediaManifest(
  manifestUrl: string,
  refererUrl: string,
  signal?: AbortSignal,
): Promise<MaterializedManifest> {
  const proxyUrl = buildProxyUrl(manifestUrl, refererUrl, "playlist.m3u8");
  const manifestText = await fetchText(proxyUrl, signal);

  if (!manifestText.includes("#EXTINF") && manifestText.includes("#EXT-X-STREAM-INF")) {
    const variantUrl = chooseHighestBandwidthVariant(manifestText, manifestUrl);
    if (!variantUrl) {
      throw new Error("Could not choose a playable HLS variant.");
    }
    return materializeMediaManifest(variantUrl, refererUrl, signal);
  }

  const assets = new Map<string, ManifestAsset>();
  let assetIndex = 0;
  const lines = manifestText.split(/\r?\n/);
  const rewrittenLines = lines.map((line) => {
    const trimmed = line.trim();
    if (!trimmed) {
      return line;
    }

    if (trimmed.startsWith("#EXT-X-MAP:") || trimmed.startsWith("#EXT-X-KEY:")) {
      const attributes = parseAttributeList(trimmed);
      const assetUri = attributes.URI;
      if (!assetUri) {
        return line;
      }

      const absoluteUrl = getAbsoluteUrl(assetUri, manifestUrl);
      const existing = assets.get(absoluteUrl);
      const localName = existing?.localName ?? createLocalName(++assetIndex, absoluteUrl, trimmed.startsWith("#EXT-X-KEY:") ? "key" : "asset");
      assets.set(absoluteUrl, { sourceUrl: absoluteUrl, localName });

      return line.replace(`URI="${assetUri}"`, `URI="${localName}"`);
    }

    if (trimmed.startsWith("#")) {
      return line;
    }

    const absoluteUrl = getAbsoluteUrl(trimmed, manifestUrl);
    const existing = assets.get(absoluteUrl);
    const localName = existing?.localName ?? createLocalName(++assetIndex, absoluteUrl, "segment");
    assets.set(absoluteUrl, { sourceUrl: absoluteUrl, localName });
    return localName;
  });

  return {
    manifestText: rewrittenLines.join("\n"),
    assets: Array.from(assets.values()),
    sourceUrl: manifestUrl,
  };
}

async function getFfmpeg() {
  if (ffmpegInstance) {
    return ffmpegInstance;
  }

  if (!ffmpegLoadPromise) {
    ffmpegLoadPromise = (async () => {
      const ffmpeg = new FFmpeg();
      await ffmpeg.load({
        coreURL: await toBlobURL(`${FFMPEG_CORE_BASE_URL}/ffmpeg-core.js`, "text/javascript"),
        wasmURL: await toBlobURL(`${FFMPEG_CORE_BASE_URL}/ffmpeg-core.wasm`, "application/wasm"),
      });
      ffmpegInstance = ffmpeg;
      return ffmpeg;
    })();
  }

  return ffmpegLoadPromise;
}

export async function downloadResolvedVideoInBrowser(
  episode: Pick<LibraryEpisode, "showTitle" | "episodeTitle" | "episodeNumber">,
  resolved: BrowserResolvedDownload,
  onProgress?: (progress: BrowserDownloadProgress) => void,
  signal?: AbortSignal,
): Promise<{ fileName: string }> {
  signal?.throwIfAborted();
  const outputFileName = getDownloadFileName(episode, resolved.downloadUrl);
  await requireWritableLibraryFolder();

  if (!isHlsPlaylistUrl(resolved.resolvedUrl)) {
    signal?.throwIfAborted();
    reportProgress(onProgress, 4, "Connecting to vault");
    const response = await fetch(resolved.downloadUrl, { signal });
    const saved = await writeResponseToLibraryVault(outputFileName, response, signal, (receivedBytes, totalBytes) => {
      const percent = totalBytes ? 8 + (receivedBytes / totalBytes) * 90 : 50;
      reportProgress(onProgress, percent, "Writing video into vault");
    });
    reportProgress(onProgress, 100, "Saved into vault");
    return { fileName: saved.fileName };
  }

  reportProgress(onProgress, 2, "Loading ffmpeg.wasm");
  const ffmpeg = await getFfmpeg();
  signal?.throwIfAborted();

  reportProgress(onProgress, 8, "Reading HLS playlist");
  const manifest = await materializeMediaManifest(resolved.resolvedUrl, resolved.refererUrl, signal);
  signal?.throwIfAborted();

  if (progressListener) {
    ffmpeg.off("progress", progressListener);
  }

  progressListener = ({ progress }) => {
    const percent = 80 + progress * 18;
    reportProgress(onProgress, percent, "Muxing video in browser");
  };
  ffmpeg.on("progress", progressListener);

  for (const asset of manifest.assets) {
    await ffmpeg.deleteFile(asset.localName).catch(() => undefined);
  }
  await ffmpeg.deleteFile("input.m3u8").catch(() => undefined);
  await ffmpeg.deleteFile("output.mp4").catch(() => undefined);

  const totalAssets = manifest.assets.length || 1;
  for (const [index, asset] of manifest.assets.entries()) {
    signal?.throwIfAborted();
    const assetProxyUrl = buildProxyUrl(asset.sourceUrl, resolved.refererUrl, asset.localName);
    const basePercent = 10 + (index / totalAssets) * 65;
    const assetData = await fetchBinary(assetProxyUrl, signal, (receivedBytes, totalBytes) => {
      const fileProgress = totalBytes ? receivedBytes / totalBytes : 0;
      const percent = basePercent + (65 / totalAssets) * fileProgress;
      reportProgress(onProgress, percent, `Fetching video chunk ${index + 1}/${totalAssets}`);
    });
    await ffmpeg.writeFile(asset.localName, assetData);
  }

  reportProgress(onProgress, 76, "Preparing local playlist");
  signal?.throwIfAborted();
  await ffmpeg.writeFile("input.m3u8", new TextEncoder().encode(manifest.manifestText));

  reportProgress(onProgress, 80, "Muxing video in browser");
  await ffmpeg.exec([
    "-allowed_extensions",
    "ALL",
    "-protocol_whitelist",
    "file,crypto,data",
    "-i",
    "input.m3u8",
    "-c",
    "copy",
    "-movflags",
    "+faststart",
    "output.mp4",
  ]);

  reportProgress(onProgress, 99, "Saving video");
  signal?.throwIfAborted();
  const output = await ffmpeg.readFile("output.mp4");
  if (typeof output === "string") {
    throw new Error("ffmpeg.wasm returned text instead of a video file.");
  }
  const videoBytes = output instanceof Uint8Array ? output : new Uint8Array(output);
  const blobBytes = new Uint8Array(videoBytes.byteLength);
  blobBytes.set(videoBytes);
  reportProgress(onProgress, 99, "Writing video into vault");
  const saved = await writeBlobToLibraryVault(outputFileName, new Blob([blobBytes.buffer], { type: "video/mp4" }));
  reportProgress(onProgress, 100, "Saved into vault");
  return { fileName: saved.fileName };
}
