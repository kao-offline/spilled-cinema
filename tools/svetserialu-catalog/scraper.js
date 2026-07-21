const db = require("./db");
const BASE = "https://svetserialu.to";
const SEARCH_URL = `${BASE}/?searchfor=`;
const TIMEOUT = 15000;
const MAX_RETRIES = 3;
const BATCH_DELAY = 200;
const CONCURRENCY = 5;

function log(...args) { console.error("[scraper]", ...args); }

async function fetch(url, retries = MAX_RETRIES) {
  for (let i = 0; i < retries; i++) {
    try {
      const resp = await globalThis.fetch(url, {
        headers: { "Accept-Language": "sk-SK,sk;q=0.9", "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36" },
        signal: AbortSignal.timeout(TIMEOUT),
      });
      if (resp.ok) return await resp.text();
      if (resp.status === 429) { log(`Rate limited, waiting...`); await sleep(2000 * (i + 1)); continue; }
      log(`HTTP ${resp.status} for ${url}`);
      return null;
    } catch (e) {
      if (i === retries - 1) { log(`Failed ${url}: ${e.message}`); return null; }
      await sleep(1000 * (i + 1));
    }
  }
  return null;
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ─── Discovery ───

function generatePairs() {
  const pairs = [];
  for (let i = 97; i <= 122; i++)
    for (let j = 97; j <= 122; j++)
      pairs.push(String.fromCharCode(i) + String.fromCharCode(j));
  return pairs;
}

async function searchShows(query) {
  const html = await fetch(`${SEARCH_URL}${encodeURIComponent(query)}`);
  if (!html) return [];
  const items = [];
  const regex = /<a[^>]*href="\/serial\/([^"]+)"[^>]*>[\s\S]*?<img[^>]*src="([^"]*)"[^>]*>[\s\S]*?<span class="name-search nunito">([\s\S]*?)<\/span>/gi;
  let match;
  while ((match = regex.exec(html)) !== null) {
    const slug = match[1].trim();
    if (!items.some(i => i.slug === slug)) {
      items.push({ slug, title: match[3].replace(/<[^>]+>/g, "").trim(), posterUrl: match[2].startsWith("http") ? match[2] : BASE + match[2] });
    }
  }
  return items;
}

async function discoverAll(onProgress) {
  const pairs = generatePairs();
  let allItems = [];
  const seen = new Set();
  let processed = 0;

  for (let i = 0; i < pairs.length; i += CONCURRENCY) {
    const batch = pairs.slice(i, i + CONCURRENCY);
    const results = await Promise.all(batch.map(q => searchShows(q).catch(() => [])));
    for (const items of results) {
      for (const item of items) {
        if (!seen.has(item.slug)) {
          seen.add(item.slug);
          allItems.push(item);
        }
      }
    }
    processed += batch.length;
    if (onProgress) onProgress(processed, pairs.length, allItems.length);
    if (i + CONCURRENCY < pairs.length) await sleep(BATCH_DELAY);
  }
  return allItems;
}

// ─── Show detail ───

async function fetchShowDetail(slug) {
  const html = await fetch(`${BASE}/serial/${slug}`);
  if (!html) return null;

  const show = { slug, genres: [], audioBuckets: [], languages: [] };

  const titleMatch = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
  if (titleMatch) show.title = titleMatch[1].replace(/<[^>]+>/g, "").trim();

  const altMatch = html.match(/<span[^>]*class="[^"]*alt-name[^"]*"[^>]*>([\s\S]*?)<\/span>/i);
  if (altMatch) show.altTitle = altMatch[1].replace(/<[^>]+>/g, "").trim().replace(/^\(|\)$/g, "");

  const descMatch = html.match(/<div[^>]*class="[^"]*show-text[^"]*"[^>]*>([\s\S]*?)<\/div>/i);
  if (descMatch) show.description = descMatch[1].replace(/<[^>]+>/g, "").trim();

  const yearMatch = html.match(/<span[^>]*class="[^"]*year[^"]*"[^>]*>([^<]*)<\/span>/i);
  if (yearMatch) show.year = yearMatch[1].trim();

  const posterMatch = html.match(/<div[^>]*class="[^"]*show-image[^"]*"[^>]*>[\s\S]*?<img[^>]*src="([^"]+)"/i);
  if (posterMatch) show.posterUrl = posterMatch[1].startsWith("http") ? posterMatch[1] : BASE + posterMatch[1];

  const genresMatch = [...html.matchAll(/<span[^>]*class="[^"]*single-genre[^"]*"[^>]*>([\s\S]*?)<\/span>/gi)];
  show.genres = genresMatch.map(m => m[1].replace(/<[^>]+>/g, "").trim()).filter(Boolean);

  const networkMatch = html.match(/<div[^>]*class="[^"]*station-logo[^"]*"[^>]*>[\s\S]*?<span[^>]*>([^<]*)<\/span>/i);
  if (networkMatch) show.network = networkMatch[1].trim();

  const langFlags = [...html.matchAll(/<span[^>]*class="[^"]*flag(EN|CZ|SK|DE|PL|RU|FR|ES)[^"]*"[^>]*>/gi)];
  show.languages = [...new Set(langFlags.map(m => m[1].toLowerCase().replace("cz", "cs").replace("sk", "cs")))];

  const bucketTags = [...html.matchAll(/<span[^>]*class="[^"]*tagsbs[^"]*"[^>]*>([\s\S]*?)<\/span>/gi)];
  const rawBuckets = bucketTags.map(m => ({ text: m[1].replace(/<[^>]+>/g, "").trim(), phoneOnly: m[0].includes("phoneOnly") }));
  show.audioBuckets = [...new Set(rawBuckets.filter(b => !b.phoneOnly).map(b => b.text))];

  const imdbMatch = html.match(/<a[^>]*class="[^"]*imdb[^"]*"[^>]*href="https:\/\/www\.imdb\.com\/title\/(tt\d+)/i);
  if (imdbMatch) show.imdbId = imdbMatch[1];

  const ratingMatch = html.match(/data-progress="([\d.]+)"/i);
  if (ratingMatch) show.imdbRating = parseFloat(ratingMatch[1]);

  const csfdMatch = html.match(/<a[^>]*class="[^"]*csfd[^"]*"[^>]*href="https:\/\/www\.csfd\.cz\/film\/(\d+)/i);
  if (csfdMatch) show.csfdId = csfdMatch[1];
  // csfdRating will be filled later by enricher.js via node-csfd-api

  const statusMatch = html.match(/<div[^>]*class="[^"]*detail-status[^"]*"[^>]*>([\s\S]*?)<\/div>/i);
  if (statusMatch) show.status = statusMatch[1].replace(/<[^>]+>/g, "").trim();

  const accordionSections = [...html.matchAll(/<div class="accordion accordionId(\d+)">([\s\S]*?)<\/div>\s*<\/div>\s*<\/div>/gi)];
  show.seasons = [];
  for (const section of accordionSections) {
    const accordionId = parseInt(section[1]);
    const sectionHtml = section[2];
    const seasonMatch = sectionHtml.match(/<span><i>(\d+)[.<]/i);
    if (seasonMatch) {
      show.seasons.push({ accordionId, seasonNumber: parseInt(seasonMatch[1]) });
    }
  }

  if (!show.seasons.length) {
    const blocks = [...html.matchAll(/<div class="accordion accordionId(\d+)">[\s\S]*?<h2[^>]*>[\s\S]*?<span><i>(\d+)[.<]/gi)];
    for (const b of blocks) {
      show.seasons.push({ accordionId: parseInt(b[1]), seasonNumber: parseInt(b[2]) });
    }
  }

  return show;
}

// ─── Episodes from accordion ───

async function fetchEpisodes(showSlug, seasons) {
  if (!seasons?.length) return [];
  const allEpisodes = [];

  for (const season of seasons) {
    await sleep(100);
    const html = await fetch(`${BASE}/serial/${showSlug}?loadAccordionId=${season.accordionId}`);
    if (!html) continue;

    // Parse episode links from the returned HTML
    // Structure: <a href="/serial/slug/sXXeYY" class="accordionLink ...">
    //   <span class="number_eps">NUM</span>
    //   <span class="ep_name">TITLE</span>
    // </a>
    const epLinks = [...html.matchAll(/<a\s+href="\/serial\/([^"]+)"[^>]*class="[^"]*accordionLink[^"]*"[^>]*>([\s\S]*?)<\/a>/gi)];
    for (const link of epLinks) {
      const href = link[1];
      const inner = link[2];

      const slugMatch = href.match(/s(\d+)e(\d+)/i);
      const numMatch = inner.match(/<span[^>]*class="[^"]*number_eps[^"]*"[^>]*>(\d+)<\/span>/i);
      const titleMatch = inner.match(/<span[^>]*class="[^"]*ep_name[^"]*"[^>]*>([\s\S]*?)<\/span>/i);

      const epNum = parseInt(slugMatch?.[2] || numMatch?.[1] || 0);
      const epSlug = href.replace(/\/$/, "");
      const epTitle = titleMatch ? titleMatch[1].replace(/<[^>]+>/g, "").trim() : null;

      allEpisodes.push({
        slug: epSlug,
        seasonNumber: season.seasonNumber,
        episodeNumber: epNum,
        episodeCode: `s${String(season.seasonNumber).padStart(2, "0")}e${String(epNum).padStart(2, "0")}`,
        episodeTitle: epTitle || epSlug,
        episodeUrl: `/serial/${epSlug}`,
      });
    }
  }
  return allEpisodes;
}

// ─── Episode players ───

async function fetchEpisodePlayers(episodeUrl, showSlug) {
  const fullUrl = `${BASE}${episodeUrl}`;
  const html = await fetch(fullUrl);
  if (!html) return [];

  const players = [];

  // Find LangGroup sections - player links are embedded directly in the HTML (no AJAX needed)
  const langGroups = [...html.matchAll(/<div class="LangGroup[^"]*"[^>]*>[\s\S]*?<div class="tabshe[^>]*>[\s\S]*?<\/div>\s*<\/div>/gi)];

  for (const group of langGroups) {
    const groupHtml = group[0];
    const headerMatch = groupHtml.match(/<div class="LangHeader[^"]*"[^>]*>([\s\S]*?)<\/div>/i);
    const langText = headerMatch ? headerMatch[1].replace(/<[^>]+>/g, "").trim() : "unknown";

    // Parse source links directly from the embedded HTML
    const sourceLinks = [...groupHtml.matchAll(/<a\s+class="source_link\s+([^"\s]+)"[^>]*data-iframe="([^"]+)"[^>]*>/gi)];
    for (const sl of sourceLinks) {
      const provider = sl[1];
      const encoded = sl[2];
      let embedUrl = null;
      try {
        embedUrl = Buffer.from(encoded, "base64").toString("utf8");
      } catch {}
      if (embedUrl) {
        embedUrl = embedUrl.startsWith("http") ? embedUrl : `${BASE}${embedUrl}`;
      }
      players.push({
        episodeSlug: episodeUrl.startsWith("/serial/") ? episodeUrl.replace("/serial/", "") : (episodeUrl.split("/").pop() || episodeUrl),
        showSlug,
        provider: provider || "unknown",
        language: langText.includes("Titulky") ? "subtitles" : (langText.includes("Dabing") ? "dubbing" : langText),
        embedUrl,
        subtitlesUrl: null,
      });
    }
  }

  return players;
}

// ─── Orchestrators ───

async function runFetch(options = {}) {
  const { onProgress, skipDetail } = options;

  log("Discovering shows via search...");
  const allShows = await discoverAll((done, total, unique) => {
    if (onProgress) onProgress({ phase: "discovery", done, total, unique });
  });

  log(`Found ${allShows.length} unique shows.`);

  if (!skipDetail) {
    log("Fetching show details...");
    let detailCount = 0;
    for (let i = 0; i < allShows.length; i++) {
      const item = allShows[i];
      if (db.showExists(item.slug)) continue;

      const detail = await fetchShowDetail(item.slug);
      if (detail) {
        if (!detail.posterUrl && item.posterUrl) detail.posterUrl = item.posterUrl;
        if (!detail.title && item.title) detail.title = item.title;
        db.saveShows([detail]);
        db.updateFtsForShows([detail.slug]);

        // Fetch episodes from accordion IDs
        if (detail.seasons?.length) {
          const episodes = await fetchEpisodes(detail.slug, detail.seasons);
          if (episodes.length) db.saveEpisodes(detail.slug, episodes);
        }
      }
      detailCount++;
      if (onProgress) onProgress({ phase: "detail", done: detailCount, total: allShows.length });
      if (detailCount % 5 === 0) await sleep(200);
    }
  } else {
    const basicShows = allShows.map(s => ({
      slug: s.slug, title: s.title, posterUrl: s.posterUrl,
      fetchedAt: Date.now(), updatedAt: Date.now(),
    }));
    db.saveShows(basicShows);
    for (const s of basicShows) db.updateFtsForShows([s.slug]);
  }

  db.setMeta("last_full_fetch", String(Date.now()));
  return allShows;
}

async function runRefresh(options = {}) {
  const { onProgress } = options;
  const configuredLimit = Number.parseInt(String(options.existingLimit ?? process.env.SVETSERIALU_REFRESH_BATCH_SIZE ?? "40"), 10);
  const existingLimit = Number.isFinite(configuredLimit) ? Math.max(0, configuredLimit) : 40;
  const existing = new Set(db.getAllSlugs());
  let allShows = await discoverFromSerialy((done, total, unique) => {
    if (onProgress) onProgress({ phase: "refresh_discovery", done, total, unique });
  });
  // The listing is the fast freshness path. Fall back to exhaustive discovery
  // only when its markup changed or it returned no usable entries.
  if (!allShows.length) {
    allShows = await discoverAll((done, total, unique) => {
      if (onProgress) onProgress({ phase: "refresh_discovery_fallback", done, total, unique });
    });
  }

  const newShows = allShows.filter(s => !existing.has(s.slug));
  const staleShows = existingLimit > 0
    ? db.getOldestShows(existingLimit).filter((show) => !newShows.some((item) => item.slug === show.slug))
    : [];
  const candidates = [
    ...newShows.map((item) => ({ ...item, isNew: true })),
    ...staleShows.map((item) => ({ slug: item.slug, title: item.title, posterUrl: item.poster_url, isNew: false })),
  ];
  const changedSlugs = [];
  log(`Found ${newShows.length} new shows; refreshing ${staleShows.length} existing shows.`);

  let count = 0;
  for (const item of candidates) {
    const detail = await fetchShowDetail(item.slug);
    if (detail) {
      if (!detail.posterUrl && item.posterUrl) detail.posterUrl = item.posterUrl;
      if (!detail.title && item.title) detail.title = item.title;
      db.saveShows([detail]);
      db.updateFtsForShows([detail.slug]);

      if (detail.seasons?.length) {
        const episodes = await fetchEpisodes(detail.slug, detail.seasons);
        // Never replace a healthy episode set with an empty response caused by a
        // transient upstream error. A non-empty response is safe to atomically refresh.
        if (episodes.length) {
          db.saveEpisodes(detail.slug, episodes);
          db.pruneEpisodesForShow(detail.slug, episodes.map((episode) => episode.slug));
        }
      }
      changedSlugs.push(detail.slug);
    }
    count++;
    if (onProgress) onProgress({ phase: "refresh_detail", done: count, total: candidates.length });
    if (count % 5 === 0) await sleep(200);
  }

  db.setMeta("last_refresh", String(Date.now()));
  return {
    newCount: newShows.length,
    refreshedCount: staleShows.length,
    changedSlugs,
    total: Math.max(existing.size + newShows.length, allShows.length),
  };
}

async function enrichShowPlayers(slug) {
  const show = db.getShow(slug);
  if (!show) { log(`Show not found: ${slug}`); return 0; }

  let totalPlayers = 0;
  for (const ep of show.episodes || []) {
    if (!ep.episode_url) continue;
    const players = await fetchEpisodePlayers(ep.episode_url, slug);
    if (players.length) {
      db.saveEpisodePlayers(players);
      totalPlayers += players.length;
    }
    await sleep(100);
  }
  return totalPlayers;
}

// ─── Sitemap / Serialy page discovery ───

async function discoverFromSerialy(onProgress) {
  const html = await fetch(`${BASE}/serialy`);
  if (!html) return [];

  const items = [];
  const seen = new Set();

  // Extract all show links from the listing
  const links = [...html.matchAll(/href="\/serial\/([^"]+)"/gi)];
  for (const m of links) {
    const slug = m[1].trim();
    if (!slug || slug.includes("#") || seen.has(slug)) continue;
    seen.add(slug);
    items.push({ slug, title: slug, posterUrl: null });
  }

  // Try to get titles from the listing page structure
  const titleRegex = /<a[^>]*href="\/serial\/([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
  let match;
  while ((match = titleRegex.exec(html)) !== null) {
    const slug = match[1].trim();
    const inner = match[2].replace(/<[^>]+>/g, "").trim();
    if (inner) {
      const item = items.find(i => i.slug === slug);
      if (item) item.title = inner;
    }
  }

  return items;
}

module.exports = {
  discoverAll, discoverFromSerialy, searchShows, fetchShowDetail, fetchEpisodes,
  fetchEpisodePlayers, runFetch, runRefresh, enrichShowPlayers,
};
