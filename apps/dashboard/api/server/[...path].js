async function readBody(req) {
  return await new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

function normalizeTargetPath(req) {
  const slug = req.query?.path;
  if (Array.isArray(slug) && slug.length > 0) {
    return slug.join("/");
  }
  if (typeof slug === "string" && slug.length > 0) {
    return slug;
  }
  return "";
}

export default async function handler(req, res) {
  const siteUrl = process.env.CONVEX_SITE_URL;
  if (!siteUrl) {
    res.status(500).json({ error: "CONVEX_SITE_URL is not configured." });
    return;
  }

  const targetPath = normalizeTargetPath(req);
  const queryIndex = req.url.indexOf("?");
  const query = queryIndex >= 0 ? req.url.slice(queryIndex) : "";
  const target = `${siteUrl.replace(/\/$/, "")}/server/${targetPath}${query}`;

  try {
    const init = {
      method: req.method,
      headers: {
        "Content-Type": req.headers["content-type"] || "application/json",
      },
    };

    if (req.method && req.method !== "GET" && req.method !== "HEAD") {
      init.body = await readBody(req);
    }

    const response = await fetch(target, init);
    const buffer = Buffer.from(await response.arrayBuffer());

    res.statusCode = response.status;
    response.headers.forEach((value, key) => {
      if (key.toLowerCase() === "transfer-encoding") {
        return;
      }
      res.setHeader(key, value);
    });
    res.end(buffer);
  } catch (error) {
    res.status(502).json({
      error: error instanceof Error ? error.message : "Failed to reach Convex control plane.",
    });
  }
}
