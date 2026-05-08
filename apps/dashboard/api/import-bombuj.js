const BASE_URLS = ["https://www.bombuj.si", "https://serialy.bombuj.si", "https://bombuj.si"];
const DEFAULT_BASE_URL = BASE_URLS[0];
const FETCH_PROXY_TEMPLATE = process.env.IMPORT_FETCH_PROXY_TEMPLATE || "";
const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36";

function decodeHtml(value) {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ");
}

function stripTags(value) {
  return decodeHtml(value.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ")).trim();
}

function matchOne(html, pattern) {
  const match = html.match(pattern);
  return match?.[1]?.trim() ?? null;
}

function absoluteUrl(value, baseUrl = DEFAULT_BASE_URL) {
  try {
    return new URL(value, baseUrl).toString();
  } catch {
    return value;
  }
}

function buildProxyUrl(targetUrl) {
  const template = String(FETCH_PROXY_TEMPLATE || "").trim();
  if (!template) return null;

  if (template.includes("{url}")) {
    return template.replaceAll("{url}", encodeURIComponent(targetUrl));
  }

  const separator = template.includes("?") ? "&" : "?";
  return `${template}${separator}url=${encodeURIComponent(targetUrl)}`;
}

async function fetchTextViaProxy(targetUrl, referer) {
  const proxyUrl = buildProxyUrl(targetUrl);
  if (!proxyUrl) {
    return null;
  }

  const response = await fetch(proxyUrl, {
    headers: {
      "User-Agent": USER_AGENT,
      Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8,application/json;q=0.6",
      Referer: referer ?? DEFAULT_BASE_URL,
      "X-Target-URL": targetUrl,
    },
    redirect: "follow",
  });

  if (!response.ok) {
    throw new Error(`Proxy request failed: ${response.status}`);
  }

  const contentType = response.headers.get("content-type") || "";
  if (contentType.includes("application/json")) {
    const payload = await response.json().catch(() => null);
    const html = payload?.html ?? payload?.content ?? payload?.body ?? payload?.data?.html;
    if (typeof html === "string" && html.trim().length > 0) {
      return html;
    }
    throw new Error("Proxy response did not include HTML payload.");
  }

  return response.text();
}

async function fetchText(url, referer) {
  try {
    const response = await fetch(url, {
      headers: {
        "User-Agent": USER_AGENT,
         "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
         "Accept-Language": "en-US,en;q=0.9,cs;q=0.8",
         "Accept-Encoding": "gzip, deflate, br",
         "DNT": "1",
         "Connection": "keep-alive",
         "Upgrade-Insecure-Requests": "1",
         "Sec-Fetch-Dest": "document",
         "Sec-Fetch-Mode": "navigate",
         "Sec-Fetch-Site": "none",
         "Sec-Fetch-User": "?1",
         "Sec-CH-UA": "\"Chromium\";v=\"123\", \"Not:A-Brand\";v=\"8\"",
         "Sec-CH-UA-Mobile": "?0",
         "Sec-CH-UA-Platform": "\"Windows\"",
        Referer: referer ?? DEFAULT_BASE_URL,
      },
      redirect: "follow",
    });

    if (!response.ok) {
      if ((response.status === 403 || response.status === 503) && FETCH_PROXY_TEMPLATE) {
        const proxied = await fetchTextViaProxy(url, referer);
        if (proxied) {
          console.log(`[bombuj] Proxy fetch used for ${url}`);
          return proxied;
        }
      }
      throw new Error(`Request failed: ${response.status}`);
    }

    return await response.text();
  } catch (error) {
    console.error(`Fetch failed for ${url}:`, error instanceof Error ? error.message : String(error));
    throw error;
  }
}

function normalizeSlug(value) {
  return String(value || "")
    .trim()
    .replace(/^online-(serial|film)-/i, "")
    .replace(/^\/+/, "");
}

function buildCandidateUrls(slug, mediaType) {
  if (!slug) {
    return [];
  }

  if (/^https?:\/\//i.test(slug)) {
    return [slug];
  }

  const rawSlug = normalizeSlug(slug);
  if (!rawSlug) {
    return [];
  }

  if (mediaType === "serial") {
    return [
      ...BASE_URLS.map((baseUrl) => `${baseUrl}/serial-${rawSlug}`),
      ...BASE_URLS.map((baseUrl) => `${baseUrl}/serial/${rawSlug}`),
    ];
  }

  if (mediaType === "movie") {
    return BASE_URLS.map((baseUrl) => `${baseUrl}/online-film-${rawSlug}`);
  }

  return [
    ...BASE_URLS.map((baseUrl) => `${baseUrl}/online-film-${rawSlug}`),
    ...BASE_URLS.map((baseUrl) => `${baseUrl}/serial-${rawSlug}`),
    ...BASE_URLS.map((baseUrl) => `${baseUrl}/serial/${rawSlug}`),
  ];
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const { slug, mediaType } = req.body || {};

  if (!slug || typeof slug !== "string" || !/^[a-z0-9-]+$/.test(slug)) {
    return res.status(400).json({ error: "Provide a valid movie slug." });
  }

  try {
    const candidateUrls = buildCandidateUrls(slug, mediaType);

    if (candidateUrls.length === 0) {
      throw new Error("Provide a valid Bombuj slug.");
    }

    const attempts = [];

    for (const movieUrl of candidateUrls) {
      try {
        console.log(`[bombuj] Fetching movie page: ${movieUrl}`);
        const movieHtml = await fetchText(movieUrl, movieUrl);
        console.log(`[bombuj] Movie HTML fetched, length: ${movieHtml.length}`);

        const title = stripTags(matchOne(movieHtml, /<h1[^>]*>([\s\S]*?)<\/h1>/i) ?? slug);
        console.log(`[bombuj] Title: ${title}`);
        const description = stripTags(
          matchOne(movieHtml, /<div class="(?:movie-)?description[^"]*"[^>]*>([\s\S]*?)<\/div>/i) ?? ""
        );
        const posterPath =
          matchOne(movieHtml, /<div class="movie-image"[^>]*>\s*<img src="([^"]+)"/i) ||
          matchOne(movieHtml, /<img[^>]*?alt="[^"]*poster[^"]*"[^>]*?src="([^"]+)"/i) ||
          matchOne(movieHtml, /poster["']?\s*:\s*["']?([^"'\s,]+)/i);

        const year = matchOne(movieHtml, /<span class="year">([\s\S]*?)<\/span>/i) || matchOne(movieHtml, /(\d{4})/);

        const show = {
          slug,
          title,
          altTitle: null,
          description: description || null,
          years: year || null,
          posterUrl: posterPath ? absoluteUrl(posterPath, movieUrl) : null,
          availableSeasons: [1],
          importedAt: Date.now(),
          episodes: [
            {
              id: `${slug}:s1e1`,
              showSlug: slug,
              showTitle: title,
              posterUrl: posterPath ? absoluteUrl(posterPath, movieUrl) : null,
              seasonNumber: 1,
              episodeNumber: 1,
              episodeCode: "s1e1",
              episodeTitle: title,
              episodeUrl: movieUrl,
              players: [
                {
                  alias: "embed-default",
                  provider: "bombuj",
                  label: "Bombuj.si",
                  language: "cs",
                  sourcePageUrl: movieUrl,
                  embedUrl: movieUrl,
                  subtitlesUrl: null,
                },
              ],
              selectedPlayerAlias: "embed-default",
              importedAt: Date.now(),
            },
          ],
        };

        console.log(`[bombuj] Successfully imported movie: ${show.title}`);
        res.status(200).json({ show });
        return;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        attempts.push(`${movieUrl}: ${message}`);
        console.error(`[bombuj] Host failed ${movieUrl}: ${message}`);

        if (!/Request failed:\s*(403|404|5\d\d)/i.test(message)) {
          throw error;
        }
      }
    }

    throw new Error(`All Bombuj hosts failed. ${attempts.join(" | ")}`);
  } catch (error) {
     console.error("[bombuj] Import error:", error instanceof Error ? error.message : String(error));
     console.error("[bombuj] Stack trace:", error instanceof Error ? error.stack : "");
    res.status(500).json({
      error: error instanceof Error ? error.message : "Failed to import movie from bombuj.si.",
    });
  }
}
