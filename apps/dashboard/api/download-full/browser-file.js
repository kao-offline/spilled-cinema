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

    const contentType = upstream.headers.get("content-type") || "application/octet-stream";
    const contentLength = upstream.headers.get("content-length");
    const contentRange = upstream.headers.get("content-range");
    const acceptRanges = upstream.headers.get("accept-ranges") || "bytes";

    res.statusCode = upstream.status;
    res.setHeader("Content-Type", contentType);
    res.setHeader("Accept-Ranges", acceptRanges);
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("Content-Disposition", `attachment; filename*=UTF-8''${encodeURIComponent(fileName)}`);

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
