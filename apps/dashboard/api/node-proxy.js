const MAX_BODY_BYTES = 2 * 1024 * 1024;

function getSingleQueryValue(value) {
  return Array.isArray(value) ? value[0] : value;
}

export function isAllowedNodeOrigin(origin) {
  try {
    const parsed = new URL(origin);
    if (parsed.protocol !== "https:") {
      return false;
    }
    const host = parsed.hostname.toLowerCase();
    return host === "loca.lt" || host.endsWith(".loca.lt");
  } catch {
    return false;
  }
}

export function isAllowedNodePath(path) {
  return (
    path === "/api/status" ||
    path === "/api/search" ||
    path === "/api/import-svetserialu" ||
    path === "/api/import-bombuj" ||
    path === "/api/provider-modules" ||
    path === "/api/provider-feed" ||
    path === "/api/provider-search" ||
    path === "/api/explore/feed" ||
    path === "/api/explore/people" ||
    path === "/api/trending/feed" ||
    path === "/api/player/resolve" ||
    path === "/api/download-full/browser-start" ||
    path.startsWith("/api/download-full/browser-file?")
  );
}

async function readBody(req) {
  const chunks = [];
  let total = 0;
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    total += buffer.length;
    if (total > MAX_BODY_BYTES) {
      throw new Error("Proxy request body is too large.");
    }
    chunks.push(buffer);
  }
  return Buffer.concat(chunks);
}

function buildProxyDownloadUrl(req, nodeOrigin, downloadPath) {
  const baseUrl = `https://${req.headers.host || "spilled.overload.studio"}`;
  const url = new URL("/api/node-proxy", baseUrl);
  url.searchParams.set("node", nodeOrigin);
  url.searchParams.set("path", downloadPath);
  return `${url.pathname}${url.search}`;
}

export default async function handler(req, res) {
  const nodeOrigin = getSingleQueryValue(req.query?.node);
  const targetPath = getSingleQueryValue(req.query?.path);

  if (!nodeOrigin || !targetPath || !isAllowedNodeOrigin(nodeOrigin) || !isAllowedNodePath(targetPath)) {
    res.status(400).json({ error: "Invalid node proxy target." });
    return;
  }

  if (!["GET", "HEAD", "POST"].includes(req.method || "")) {
    res.status(405).json({ error: "Method not allowed." });
    return;
  }

  const targetUrl = new URL(targetPath, nodeOrigin);
  const headers = {
    "bypass-tunnel-reminder": "true",
    "user-agent": req.headers["user-agent"] || "SpilledCinema/1.0",
    accept: req.headers.accept || "*/*",
  };

  if (req.headers.range) {
    headers.range = req.headers.range;
  }
  if (req.method === "POST") {
    headers["content-type"] = req.headers["content-type"] || "text/plain;charset=UTF-8";
  }

  try {
    const response = await fetch(targetUrl, {
      method: req.method,
      headers,
      body: req.method === "POST" ? await readBody(req) : undefined,
      redirect: "follow",
    });

    const contentType = response.headers.get("content-type") || "";
    if (contentType.includes("application/json")) {
      const payload = await response.json();
      if (payload && typeof payload.downloadUrl === "string" && payload.downloadUrl.startsWith("/")) {
        payload.downloadUrl = buildProxyDownloadUrl(req, nodeOrigin, payload.downloadUrl);
      }
      res.status(response.status).json(payload);
      return;
    }

    res.status(response.status);
    res.setHeader("Content-Type", contentType || "application/octet-stream");
    res.setHeader("Cache-Control", "no-store");
    const contentLength = response.headers.get("content-length");
    const contentRange = response.headers.get("content-range");
    const acceptRanges = response.headers.get("accept-ranges");
    if (contentLength) res.setHeader("Content-Length", contentLength);
    if (contentRange) res.setHeader("Content-Range", contentRange);
    if (acceptRanges) res.setHeader("Accept-Ranges", acceptRanges);
    if (req.method === "HEAD" || !response.body) {
      res.end();
      return;
    }

    const reader = response.body.getReader();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      res.write(Buffer.from(value));
    }
    res.end();
  } catch (error) {
    res.status(502).json({ error: error instanceof Error ? error.message : "Node proxy failed." });
  }
}
