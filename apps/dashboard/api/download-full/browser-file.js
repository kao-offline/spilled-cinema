const { Readable } = require("node:stream");

const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

function getSafeName(input) {
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

function isHlsPlaylistResponse(url, contentType) {
  return /\.m3u8(?:$|[?#])/i.test(url.pathname + url.search) ||
    /\/hls3\/[^\s"'<>]+\.txt(?:$|[?#])/i.test(url.pathname + url.search) ||
    /(?:mpegurl|application\/vnd\.apple\.mpegurl|audio\/x-mpegurl)/i.test(contentType);
}

function isCacheableHlsAsset(url, contentType) {
  return isHlsPlaylistResponse(url, contentType) ||
    /\.(?:ts|m4s|aac|vtt)(?:$|[?#])/i.test(url.pathname + url.search) ||
    /video\/mp2t|audio\/aac|text\/vtt/i.test(contentType);
}

function buildBrowserFileProxyPath(streamUrl, fileName, referer, inlinePlayback = false) {
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

function rewriteHlsTagUris(line, playlistUrl, fileName, referer, inlinePlayback = false) {
  return line.replace(/\bURI=(["'])([^"']+)\1/gi, (match, quote, rawUrl) => {
    try {
      const absolute = new URL(rawUrl, playlistUrl).toString();
      return `URI=${quote}${buildBrowserFileProxyPath(absolute, fileName, referer || playlistUrl.toString(), inlinePlayback)}${quote}`;
    } catch {
      return match;
    }
  });
}

function rewriteHlsPlaylistUrls(playlist, playlistUrl, fileName, referer, inlinePlayback = false) {
  const preserveImageNamedSegments = Boolean(getBrowserFileOriginHeader(referer));
  return playlist
    .split(/\r?\n/)
    .map((line) => {
      const trimmed = line.trim();
      if (!trimmed) {
        return line;
      }
      if (trimmed.startsWith("#")) {
        return rewriteHlsTagUris(line, playlistUrl, fileName, referer, inlinePlayback);
      }
      const isKnownAd = /ad-site|\.image(?:[?#]|$)/i.test(trimmed);
      const isImageNamed = /\.(?:png|jpe?g|webp|gif)(?:[?#]|$)/i.test(trimmed);
      if (isKnownAd || (isImageNamed && !preserveImageNamedSegments)) {
        return line;
      }

      try {
        const absolute = new URL(trimmed, playlistUrl).toString();
        return buildBrowserFileProxyPath(absolute, fileName, referer || playlistUrl.toString(), inlinePlayback);
      } catch {
        return line;
      }
    })
    .join("\n");
}

function getBrowserFileOriginHeader(referer) {
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

module.exports = async function handler(req, res) {
  if (req.method !== "GET" && req.method !== "HEAD") {
    res.statusCode = 405;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ error: "Method not allowed." }));
    return;
  }

  try {
    const rawUrl = req.url || "";
    const query = rawUrl.includes("?") ? rawUrl.slice(rawUrl.indexOf("?") + 1) : "";
    const params = new URLSearchParams(query);

    const streamUrl = params.get("url");
    const fileName = getSafeName(params.get("name"));
    const referer = params.get("referer") || undefined;
    const inlinePlayback = params.get("playback") === "1";

    if (!streamUrl) {
      res.statusCode = 400;
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ error: "Missing stream URL." }));
      return;
    }

    let parsed;
    try {
      parsed = new URL(streamUrl);
    } catch {
      res.statusCode = 400;
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ error: "Invalid stream URL." }));
      return;
    }

    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      res.statusCode = 400;
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ error: "Unsupported stream URL protocol." }));
      return;
    }

    const isVidkingRequest = Boolean(getBrowserFileOriginHeader(referer));
    const isXpassSegment = /play\.xpass\.top/i.test(referer || "") && /\/page-\d+\.html(?:$|[?#])/i.test(parsed.pathname + parsed.search);
    const upstreamHeaders = {
      "user-agent": USER_AGENT,
      accept: "*/*",
      ...(referer ? { referer } : {}),
      ...(typeof req.headers.range === "string" ? { range: req.headers.range } : {}),
    };

    const upstream = await fetch(parsed.toString(), {
      method: req.method,
      headers: upstreamHeaders,
      redirect: "follow",
    });

    if (!upstream.ok && upstream.status !== 206) {
      const body = await upstream.text().catch(() => "");
      res.statusCode = upstream.status || 502;
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ error: `Upstream stream request failed (${upstream.status}).`, detail: body.slice(0, 300) }));
      return;
    }

    const upstreamContentType = upstream.headers.get("content-type") || "application/octet-stream";
    const contentType = (isVidkingRequest && /\.jpe?g$/i.test(parsed.pathname)) || isXpassSegment
      ? "video/mp2t"
      : upstreamContentType;
    const contentLength = upstream.headers.get("content-length");
    const contentRange = upstream.headers.get("content-range");
    const acceptRanges = upstream.headers.get("accept-ranges");

    res.statusCode = upstream.status;
    res.setHeader("Content-Type", contentType);
    if (acceptRanges) {
      res.setHeader("Accept-Ranges", acceptRanges);
    }
    res.setHeader("Cache-Control", isCacheableHlsAsset(parsed, contentType) ? "private, max-age=600" : "no-store");
    res.setHeader("Content-Disposition", `${inlinePlayback ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(fileName)}`);

    if (req.method !== "HEAD" && upstream.body && isHlsPlaylistResponse(parsed, contentType)) {
      const playlist = await upstream.text();
      const rewritten = rewriteHlsPlaylistUrls(playlist, parsed, fileName, referer, inlinePlayback);
      res.setHeader("Content-Type", "application/vnd.apple.mpegurl");
      res.setHeader("Content-Length", Buffer.byteLength(rewritten).toString());
      res.end(rewritten);
      return;
    }

    if (contentLength) {
      res.setHeader("Content-Length", contentLength);
    }
    if (contentRange) {
      res.setHeader("Content-Range", contentRange);
    }

    if (req.method === "HEAD") {
      res.end();
      return;
    }

    if (!upstream.body) {
      res.end();
      return;
    }

    const nodeReadable = Readable.fromWeb(upstream.body);
    nodeReadable.on("error", () => {
      if (!res.headersSent) {
        res.statusCode = 500;
      }
      res.end();
    });

    nodeReadable.pipe(res);
  } catch (error) {
    res.statusCode = 500;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ error: error instanceof Error ? error.message : "Failed to proxy download." }));
  }
};
