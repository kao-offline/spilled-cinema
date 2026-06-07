async function readBody(req) {
  return await new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

export function normalizeTargetPath(req) {
  const queryPath = req.query?.path;
  if (typeof queryPath === "string" && queryPath.length > 0) {
    return queryPath.replace(/^\/+/, "");
  }
  if (Array.isArray(queryPath) && queryPath.length > 0) {
    return queryPath.join("/").replace(/^\/+/, "");
  }

  const slug = req.query?.path;
  if (Array.isArray(slug) && slug.length > 0) {
    return slug.join("/");
  }
  if (typeof slug === "string" && slug.length > 0) {
    return slug;
  }

  const pathname = new URL(req.url || "/", "https://spilled.local").pathname;
  for (const prefix of ["/api/server/", "/server/"]) {
    if (pathname.startsWith(prefix)) {
      return decodeURIComponent(pathname.slice(prefix.length));
    }
  }

  if (pathname !== "/api/server" && pathname !== "/server") {
    return decodeURIComponent(pathname.replace(/^\/+/, ""));
  }

  return "";
}

export function buildControlPlaneTarget(siteUrl, req, pathOverride) {
  const targetPath = pathOverride ?? normalizeTargetPath(req);
  const source = new URL(req.url || "/", "https://spilled.local");
  source.searchParams.delete("path");
  const query = source.searchParams.toString();
  return `${siteUrl.replace(/\/$/, "")}/server/${targetPath}${query ? `?${query}` : ""}`;
}

export async function proxyControlPlane(req, res, pathOverride) {
  const siteUrl = process.env.CONVEX_SITE_URL;
  if (!siteUrl) {
    res.status(500).json({ error: "CONVEX_SITE_URL is not configured." });
    return;
  }

  const target = buildControlPlaneTarget(siteUrl, req, pathOverride);

  try {
    const init = {
      method: req.method,
      headers: {
        "Content-Type": req.headers["content-type"] || "application/json",
      },
    };
    if (req.headers["x-spilled-control-plane-secret"]) {
      init.headers["x-spilled-control-plane-secret"] = req.headers["x-spilled-control-plane-secret"];
    }

    if (req.method && req.method !== "GET" && req.method !== "HEAD") {
      init.body = await readBody(req);
    }

    const response = await fetch(target, init);
    const body = await response.text();

    if ((response.headers.get("content-type") || "").includes("application/json")) {
      res.status(response.status).json(JSON.parse(body));
      return;
    }

    res.setHeader("Content-Type", response.headers.get("content-type") || "text/plain; charset=utf-8");
    res.status(response.status).send(body);
  } catch (error) {
    res.status(502).json({
      error: error instanceof Error ? error.message : "Failed to reach Convex control plane.",
    });
  }
}
