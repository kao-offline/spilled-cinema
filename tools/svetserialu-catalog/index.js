#!/usr/bin/env node
// Load .env file if present
try {
  const envPath = require("path").join(__dirname, ".env");
  if (require("fs").existsSync(envPath)) {
    for (const line of require("fs").readFileSync(envPath, "utf8").split("\n")) {
      const m = line.trim().match(/^([^=]+)=(.*)$/);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
    }
  }
} catch {}

const scraper = require("./scraper");
const enricher = require("./enricher");
const db = require("./db");
const bq = require("./bq");
const algolia = require("./algolia");
const fs = require("fs");
const path = require("path");

const cmd = process.argv[2];
const args = process.argv.slice(3);

function log(...m) { console.log(...m); }

async function main() {
  switch (cmd) {
    case "fetch":
      return cmdFetch();
    case "refresh":
      return cmdRefresh();
    case "watch":
      return cmdWatch();
    case "search":
      if (args[0] === "engine") return cmdSearchEngine();
      return cmdSearch();
    case "search-engine":
      return cmdSearchEngine();
    case "list":
      return cmdList();
    case "show":
      return cmdShow();
    case "stats":
      return cmdStats();
    case "players":
      return cmdPlayers();
    case "enrich":
      return cmdEnrich();
    case "rebuild-fts":
      db.rebuildFts();
      log("FTS rebuilt");
      return;
    case "export":
      return cmdExport();
    case "get":
      return cmdGet();
    case "search-bq":
      return cmdSearchBq();
    case "sync":
      return cmdSync();
    case "bq-init":
      return cmdBqInit();
    case "bq-stats":
      return cmdBqStats();
    case "bq-verify":
      return cmdBqVerify();
    case "algolia-sync":
      return cmdAlgoliaSync();
    case "discover":
      return cmdDiscover();
    case "batch-fetch-missing":
      return cmdBatchFetchMissing();
    case "help":
    default:
      showHelp();
  }
}

async function cmdGet() {
  const nonFlag = args.filter(a => !a.startsWith("--"));
  const url = nonFlag[0];
  const bqSync = args.includes("--bq");
  if (!url || !url.includes("svetserialu.to/serial/")) {
    log("Usage: node index.js get [--bq] <svetserialu.to-url>");
    log("Example: node index.js get --bq https://svetserialu.to/serial/severance");
    return;
  }

  const slug = url.match(/\/serial\/([^/?#]+)/)?.[1];
  if (!slug) return log("Could not extract slug from URL.");

  log(`\n=== Fetching: ${url} ===\nSlug: ${slug}`);

  // 1. Show detail
  const detail = await scraper.fetchShowDetail(slug);
  if (!detail) { log("Failed to fetch show page."); return; }
  log(`Title: ${detail.title}`);
  log(`Genres: ${detail.genres.join(", ") || "N/A"}`);
  log(`Network: ${detail.network || "N/A"}`);
  log(`IMDB: ${detail.imdbId} (${detail.imdbRating || "?"})`);
  const csfdStr = detail.csfdId + (detail.csfdRating ? ` (${detail.csfdRating}%)` : "");
  log(`CSFD: ${csfdStr}`);

  db.saveShows([detail]);
  db.updateFtsForShows([detail.slug]);

  // 2. Episodes
  if (detail.seasons?.length) {
    const episodes = await scraper.fetchEpisodes(detail.slug, detail.seasons);
    if (episodes.length) {
      db.saveEpisodes(detail.slug, episodes);
      const byS = {};
      for (const ep of episodes) { byS[ep.seasonNumber] = (byS[ep.seasonNumber] || 0) + 1; }
      const sList = Object.entries(byS).map(([s, c]) => `  Season ${s}: ${c} episodes`).join("\n");
      log(`Episodes: ${episodes.length} across ${detail.seasons.length} seasons\n${sList}`);
    }
  }

  // 3. Players
  log("Fetching players...");
  let playerCount = 0;
  const showFromDb = db.getShow(slug);
  for (const ep of showFromDb?.episodes || []) {
    if (!ep.episode_url) continue;
    const players = await scraper.fetchEpisodePlayers(ep.episode_url, slug);
    if (players.length) { db.saveEpisodePlayers(players); playerCount += players.length; }
    await sleep(100);
  }
  if (playerCount) log(`Player links: ${playerCount}`);

  // 4. TMDB enrichment
  const apiKey = process.env.TMDB_API_KEY;
  if (apiKey) {
    log("Enriching with TMDB...");
    enricher.init(apiKey);
    await enricher.enrichShow(slug);
    log("TMDB enrichment done.");
  } else {
    log("TMDB_API_KEY not set \u2014 skipping actors/crew/companies.");
  }

  // 5. Sync to BigQuery
  if (bqSync) {
    log("Syncing to BigQuery...");
    const ok = await bq.syncShow(slug);
    log(ok ? "  Synced." : "  Sync failed or not configured. Set GCP_PROJECT_ID.");
  }

  // 6. Print result
  await printShow(slug);
}

function wrap(n) { return "\u2500".repeat(n); }

async function printShow(slug) {
  const show = db.getShow(slug);
  if (!show) return;

  const W = 100;

  // ─── HEADER ───
  log(`\n${wrap(W)}`);
  log(`  ${show.title}${show.year ? ` (${show.year})` : ""}`);
  if (show.alt_title) log(`  aka ${show.alt_title}`);
  log("");

  log(`  Slug:       ${show.slug}`);
  log(`  Genres:     ${show.genres.join(", ") || "N/A"}`);
  log(`  Network:    ${show.network || "N/A"}`);
  const imdbLine = `https://www.imdb.com/title/${show.imdb_id}`;
  log(`  IMDB:       ${imdbLine} (${show.imdb_rating || "?"})`);
  const csfdPct = show.csfd_rating ? ` (${show.csfd_rating}%)` : "";
  log(`  CSFD:       https://www.csfd.cz/film/${show.csfd_id}${csfdPct}`);
  log("");

  // Description
  if (show.description) {
    const descLines = show.description.match(/.{1,90}(?:\s|$)/g) || [];
    for (const line of descLines) log(`  ${line.trim()}`);
  }
  log(`${wrap(W)}\n`);

  log("\u2500\u2500\u2500 EPISODES " + wrap(86) + "\n");

  const seasonMap = {};
  for (const ep of show.episodes || []) {
    if (!seasonMap[ep.season_number]) seasonMap[ep.season_number] = [];
    seasonMap[ep.season_number].push(ep);
  }

  // Get players per episode
  const playersByEp = {};
  for (const p of show.players || []) {
    if (!playersByEp[p.episode_slug]) playersByEp[p.episode_slug] = [];
    playersByEp[p.episode_slug].push(p);
  }

  // Get season year from first episode's air_date
  const seasonYear = {};
  for (const ep of show.episodes || []) {
    if (!seasonYear[ep.season_number] && ep.air_date) {
      seasonYear[ep.season_number] = ep.air_date.substring(0, 4);
    }
  }

  const snums = Object.keys(seasonMap).sort((a, b) => parseInt(a) - parseInt(b));
  for (const sn of snums) {
    const eps = seasonMap[sn];
    const sy = seasonYear[sn] ? ` (${seasonYear[sn]})` : "";
    log(`  \u25BC SEASON ${sn}${sy}\n`);

    for (const ep of eps) {
      const code = (ep.episode_code || "").toUpperCase();
      const title = ep.episode_title || "";
      log(`    ${code} - ${title}`);

      const parts = [];
      if (ep.air_date) parts.push(`\uD83D\uDCC5 Date: ${ep.air_date}`);
      if (ep.duration) parts.push(`\u23F1\uFE0F Duration: ${ep.duration} min`);
      if (ep.director) parts.push(`\uD83C\uDFAC Director: ${ep.director}`);
      if (parts.length) log(`    ${parts.join("  |  ")}`);

      // Players for this episode
      const epSlug = ep.slug;
      const epPlayers = playersByEp[epSlug] || [];
      if (epPlayers.length) {
        const langGroups = {};
        for (const pl of epPlayers) {
          const lg = pl.language || "unknown";
          if (!langGroups[lg]) langGroups[lg] = [];
          langGroups[lg].push(pl);
        }
        log(`    \uD83D\uDD17 Players:`);
        for (const [lang, pls] of Object.entries(langGroups)) {
          log(`       \uD83D\uDCC2 [${lang}]`);
          for (const pl of pls) {
            const pUrl = pl.embed_url && pl.embed_url.startsWith("http") ? pl.embed_url : "";
            log(`           \u2022 ${pl.provider}:  ${pUrl}`);
          }
        }
      }
      log("");
    }
  }

  log("\u2500\u2500\u2500 CREDITS & PRODUCTION " + wrap(64) + "\n");

  if (show.actors?.length) {
    log(`  Cast (${show.actors.length}):`);
    for (const a of show.actors) {
      const role = a.role ? ` as ${a.role}` : "";
      const idStr = a.tmdb_id ? ` [ID: ${a.tmdb_id}]` : "";
      log(`    \u2022 ${a.name}${role}${idStr}`);
      if (a.tmdb_id) log(`      \u21b3 Link: https://www.themoviedb.org/person/${a.tmdb_id}`);
    }
    log("");
  }

  if (show.crew?.length) {
    log(`  Key Crew:`);
    const seen = new Set();
    for (const c of show.crew) {
      if (!seen.has(c.name)) { seen.add(c.name); log(`    ${c.name} (${c.job})`); }
    }
    log("");
  }

  if (show.production_companies?.length) {
    log(`  Production: ${show.production_companies.map(c => c.name).join(", ")}`);
  }

  log(`${wrap(W)}\n`);
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function showHelp() {
  log(`
svetserialu-catalog — catalog Czech/Slovak TV show data

USAGE:
  node index.js <command> [options]

COMMANDS:
  get [--bq] <url>   Fetch a show by URL: detail + episodes + players + TMDB enrich
  fetch [--bq]       Full fetch: discover all shows + details + episodes
  refresh            Incrementally refresh new and stale shows, then sync indexes
  watch [--interval-minutes N]  Keep the catalog and indexes continuously fresh
  discover           Discover new shows from /serialy listing page
  batch-fetch-missing  Search for and fetch shows missed by aa-zz discovery
  search <query>     Search shows in local SQLite (FTS)
  search engine      Interactive search engine (Algolia, instant)
  search-bq <query>  Search shows in BigQuery (live, over internet)
  list [limit]       List all shows
  show <slug>        Show full details for a show
  players <slug>     Scrape player links for a show's episodes
  enrich [--skip] [--limit N]  Enrich with TMDB data (requires TMDB_API_KEY)
  stats              Database statistics
  rebuild-fts        Rebuild full-text search indexes
  export [file]      Export catalog as JSON (default: stdout)
  sync               Sync all SQLite data to BigQuery (checksum-based)
  algolia-sync       Sync all shows to Algolia (instant cloud search)
  bq-init            Create BigQuery dataset and table
  bq-stats           Show BigQuery storage stats
  bq-verify          Show BigQuery data verification report
  help               Show this help

ENVIRONMENT:
  TMDB_API_KEY       Required for enrich and get commands
  GCP_PROJECT_ID     Required for BigQuery commands and --bq flag
  ALGOLIA_APP_ID     Required for Algolia commands
  ALGOLIA_API_KEY    Required for Algolia commands
`);
}

// ─── FETCH ───

async function cmdFetch() {
  const bqSync = args.includes("--bq");
  log("=== Full fetch ===");
  const shows = await scraper.runFetch({
    onProgress: (p) => {
      if (p.done % 50 === 0 || p.done === p.total)
        process.stderr.write(`\r  ${p.phase}: ${p.done}/${p.total} (${p.unique || ""})      `);
    },
  });
  db.rebuildFts();
  log(`\nDone. ${shows.length} shows discovered, details saved to DB.`);

  if (bqSync && shows.length) {
    log("\nSyncing all to BigQuery...");
    const result = await bq.syncAll();
    log(`Synced: ${result.inserted} inserted, ${result.skipped} skipped`);
  }
}

// ─── REFRESH ───

async function cmdRefresh() {
  log("=== Refresh ===");
  const result = await scraper.runRefresh({
    onProgress: (p) => {
      process.stderr.write(`\r  ${p.phase}: ${p.done}/${p.total}      `);
    },
  });
  log(`\nDone. ${result.newCount} new, ${result.refreshedCount} refreshed, ${result.total} total.`);

  if (result.changedSlugs.length && algolia.isAvailable()) {
    await algolia.syncSlugs(result.changedSlugs);
  }
  if (result.changedSlugs.length && bq.isAvailable() && process.env.SVETSERIALU_SYNC_BIGQUERY !== "0") {
    const sync = await bq.syncAll();
    log(`BigQuery: ${sync.inserted} updated, ${sync.skipped} unchanged.`);
  }
  return result;
}

async function cmdWatch() {
  const intervalIndex = args.indexOf("--interval-minutes");
  const requestedMinutes = intervalIndex >= 0 ? Number.parseFloat(args[intervalIndex + 1]) : Number.parseFloat(process.env.SVETSERIALU_REFRESH_INTERVAL_MINUTES || "15");
  const intervalMinutes = Number.isFinite(requestedMinutes) ? Math.max(1, requestedMinutes) : 15;
  const intervalMs = intervalMinutes * 60 * 1000;
  let stopping = false;
  let cycle = 0;

  const stop = () => {
    stopping = true;
    log("Stopping after the current refresh cycle...");
  };
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);

  log(`Watching SvetSerialu every ${intervalMinutes} minute(s).`);
  while (!stopping) {
    cycle += 1;
    const startedAt = Date.now();
    try {
      log(`\n=== Watch cycle ${cycle} (${new Date(startedAt).toISOString()}) ===`);
      await cmdRefresh();
    } catch (error) {
      log(`Refresh cycle failed: ${error instanceof Error ? error.message : String(error)}`);
    }
    if (stopping) break;
    const remaining = Math.max(1_000, intervalMs - (Date.now() - startedAt));
    await sleep(remaining);
  }
}

// ─── SEARCH ───

async function cmdSearch() {
  const query = args[0];
  if (!query) { log("Usage: node index.js search <query>"); return; }
  const limit = parseInt(args[1]) || 30;

  const shows = db.searchShows(query, limit);
  if (shows.length) {
    log(`\n=== Shows matching "${query}" ===\n`);
    for (const s of shows) {
      const year = s.year ? ` (${s.year})` : "";
      const rating = s.imdb_rating ? ` [IMDB: ${s.imdb_rating}]` : "";
      log(`  ${s.title}${year}${rating}`);
      log(`    slug: ${s.slug}`);
      if (s.network) log(`    network: ${s.network}`);
      if (s.genres.length) log(`    genres: ${s.genres.join(", ")}`);
      log("");
    }
  } else {
    log("No shows found.");
  }

  // Search episodes too
  const eps = db.searchEpisodes(query, 20);
  if (eps.length) {
    log(`=== Episodes matching "${query}" ===\n`);
    for (const e of eps.slice(0, 20)) {
      log(`  ${e.show_title} — ${e.episode_code}: ${e.episode_title}`);
    }
    log("");
  }

  // Search actors
  const actors = db.searchActors(query, 10);
  if (actors.length) {
    log(`=== Actors matching "${query}" ===\n`);
    for (const a of actors) {
      log(`  ${a.name} (${a.known_for || "actor"})`);
    }
    log("");
  }
}

// ─── LIST ───

async function cmdList() {
  const limit = parseInt(args[0]) || 100;
  const offset = parseInt(args[1]) || 0;
  const shows = db.listShows(limit, offset);
  if (!shows.length) { log("No shows in database."); return; }
  log(`\n=== Shows (${shows.length}) ===\n`);
  for (const s of shows) {
    const year = s.year ? ` (${s.year})` : "";
    const rating = s.imdb_rating ? ` [${s.imdb_rating}]` : "";
    log(`  ${s.title}${year}${rating}`);
    log(`    ${s.slug} | ${s.network || "?"} | ${s.genres?.join(", ") || ""}`);
  }
  log(`\nTotal: ${db.getStats().showCount} shows`);
}

// ─── SHOW ───

async function cmdShow() {
  const slug = args[0];
  if (!slug) { log("Usage: node index.js show <slug>"); return; }
  const show = db.getShow(slug);
  if (!show) { log(`Show not found: ${slug}`); return; }

  log(`\n=== ${show.title}${show.year ? ` (${show.year})` : ""} ===`);
  if (show.alt_title) log(`aka: ${show.alt_title}`);
  log(`slug: ${show.slug}`);
  if (show.genres.length) log(`genres: ${show.genres.join(", ")}`);
  if (show.network) log(`network: ${show.network}`);
  if (show.country) log(`country: ${show.country}`);
  if (show.languages.length) log(`languages: ${show.languages.join(", ")}`);
  if (show.audio_buckets.length) log(`audio: ${show.audio_buckets.join(", ")}`);
  if (show.imdb_id) log(`IMDB: https://www.imdb.com/title/${show.imdb_id}`);
  if (show.imdb_rating) log(`IMDB rating: ${show.imdb_rating}`);
  if (show.csfd_id) log(`CSFD: https://www.csfd.cz/film/${show.csfd_id}`);
  if (show.status) log(`status: ${show.status}`);
  if (show.runtime) log(`avg runtime: ${show.runtime} min`);
  if (show.description) log(`\ndescription:\n${show.description.substring(0, 500)}${show.description.length > 500 ? "..." : ""}`);

  // Seasons
  const seasonMap = {};
  for (const ep of show.episodes || []) {
    if (!seasonMap[ep.season_number]) seasonMap[ep.season_number] = [];
    seasonMap[ep.season_number].push(ep);
  }
  const seasonKeys = Object.keys(seasonMap).sort((a, b) => parseInt(a) - parseInt(b));
  if (seasonKeys.length) {
    log(`\n--- Episodes (${show.episodes.length} total, ${seasonKeys.length} seasons) ---`);
    for (const sk of seasonKeys) {
      const eps = seasonMap[sk];
      log(`\nSeason ${sk} (${eps.length} episodes):`);
      for (const ep of eps.slice(0, 10)) {
        const title = ep.episode_title ? `: ${ep.episode_title}` : "";
        const dur = ep.duration ? ` [${ep.duration}min]` : "";
        log(`  ${ep.episode_code}${title}${dur}`);
      }
      if (eps.length > 10) log(`  ... and ${eps.length - 10} more`);
    }
  }

  // Players
  if (show.players?.length) {
    log(`\n--- Players (${show.players.length}) ---`);
    const byProvider = {};
    for (const p of show.players) {
      if (!byProvider[p.provider]) byProvider[p.provider] = { count: 0, languages: new Set() };
      byProvider[p.provider].count++;
      if (p.language) byProvider[p.provider].languages.add(p.language);
    }
    for (const [prov, info] of Object.entries(byProvider)) {
      log(`  ${prov}: ${info.count} links [${[...info.languages].join(", ")}]`);
    }
  }

  // Actors
  if (show.actors?.length) {
    log(`\n--- Actors (${show.actors.length}) ---`);
    for (const a of show.actors.slice(0, 20)) {
      const role = a.role ? ` as ${a.role}` : "";
      log(`  ${a.name}${role}`);
    }
    if (show.actors.length > 20) log(`  ... and ${show.actors.length - 20} more`);
  }

  // Crew
  if (show.crew?.length) {
    log(`\n--- Crew ---`);
    for (const c of show.crew) {
      log(`  ${c.name} (${c.job})`);
    }
  }

  // Production companies
  if (show.production_companies?.length) {
    log(`\n--- Production Companies ---`);
    for (const c of show.production_companies) {
      log(`  ${c.name}`);
    }
  }

  log("");
}

// ─── PLAYERS ───

async function cmdPlayers() {
  const slug = args[0];
  if (!slug) { log("Usage: node index.js players <slug>"); return; }

  log(`Scraping players for ${slug}...`);
  const total = await scraper.enrichShowPlayers(slug);
  log(`Saved ${total} player links.`);
}

// ─── ENRICH ───

async function cmdEnrich() {
  const apiKey = process.env.TMDB_API_KEY;
  if (!apiKey) {
    log("Error: TMDB_API_KEY env var not set.");
    log("Get one at https://www.themoviedb.org/settings/api");
    process.exit(1);
  }

  enricher.init(apiKey);
  const skip = args.includes("--skip");
  const limitIdx = args.indexOf("--limit");
  const limit = limitIdx >= 0 ? parseInt(args[limitIdx + 1]) || undefined : undefined;

  log(`Enriching ${limit ? `first ${limit}` : "all"} shows from TMDB...`);
  const count = await enricher.enrichAll({
    onProgress: (p) => {
      process.stderr.write(`\r  ${p.phase}: ${p.done}/${p.total}      `);
    },
    skipExisting: skip,
    limit,
  });
  log(`\nDone. ${count} shows enriched.`);
}

// ─── STATS ───

async function cmdStats() {
  const s = db.getStats();
  log(`
=== Database Statistics ===
  Shows:         ${s.showCount}
  Episodes:      ${s.episodeCount}
  Actors:        ${s.actorCount}
  Crew:          ${s.crewCount}
  Players:       ${s.playerCount}
  Companies:     ${s.companyCount}
  Last fetch:    ${s.lastFetch ? new Date(parseInt(s.lastFetch)).toISOString() : "never"}
  Last refresh:  ${s.lastRefresh ? new Date(parseInt(s.lastRefresh)).toISOString() : "never"}
`);
}

// ─── EXPORT ───

async function cmdExport() {
  const dest = args[0];
  const d = db.getDb();
  const shows = d.prepare("SELECT * FROM shows ORDER BY title").all();
  const episodes = d.prepare("SELECT e.*, s.title as show_title FROM episodes e JOIN shows s ON s.slug = e.show_slug ORDER BY s.title, e.season_number, e.episode_number").all();
  const actors = d.prepare("SELECT * FROM actors ORDER BY name").all();
  const showActors = d.prepare("SELECT * FROM show_actors ORDER BY show_slug, position").all();
  const players = d.prepare("SELECT * FROM episode_players ORDER BY show_slug, episode_slug").all();

  const output = JSON.stringify({ shows, episodes, actors, showActors, players, exportedAt: new Date().toISOString() }, null, 2);
  if (dest) {
    fs.writeFileSync(dest, output, "utf8");
    log(`Exported to ${dest}`);
  } else {
    console.log(output);
  }
}

// ─── SYNC (BigQuery) ───

async function cmdSync() {
  if (!bq.isAvailable()) { log("BigQuery not configured. Set GCP_PROJECT_ID."); return; }

  const result = await bq.syncAll();
  log(`\nSync complete.`);
  log(`  Total:   ${result.total}`);
  log(`  Synced:  ${result.inserted} (new or changed)`);
  log(`  Skipped: ${result.skipped} (unchanged)`);

  const stats = await bq.showStats();
  if (stats) log(`  BQ storage: ${stats.size_mb} MB (${stats.count} rows)`);
}

async function cmdBqInit() {
  if (!bq.isAvailable()) { log("BigQuery not configured. Set GCP_PROJECT_ID."); return; }
  await bq.init();
  const ok = await bq.ensureTable();
  log(ok ? "BigQuery dataset and table ready." : "Failed to initialize BigQuery.");
}

async function cmdBqStats() {
  if (!bq.isAvailable()) { log("BigQuery not configured. Set GCP_PROJECT_ID."); return; }
  await bq.init();
  const stats = await bq.showStats();
  if (stats) {
    log(`\n=== BigQuery Storage ===`);
    log(`  Rows:     ${stats.count}`);
    log(`  Size:     ${stats.size_mb} MB`);
    log(`  Dataset:  ${require("@google-cloud/bigquery").BigQuery ? "OK" : "N/A"}`);
  } else {
    log("Could not fetch BigQuery stats. Is the table created?");
  }
}

// ─── BQ VERIFY ───

async function cmdBqVerify() {
  if (!bq.isAvailable()) { log("BigQuery not configured. Set GCP_PROJECT_ID."); return; }
  await bq.init();

  const { BigQuery } = require("@google-cloud/bigquery");
  const bqc = new BigQuery({ projectId: process.env.GCP_PROJECT_ID });
  const TBL = "`spilledcinema.spilled_cinema.shows`";

  log(`\n\u2500\u2500\u2500 BIGQUERY VERIFICATION REPORT ${"\u2500".repeat(70)}`);
  log("");

  async function aggQ(sql) {
    const [rows] = await bqc.query({ query: sql });
    return rows[0];
  }

  // ─── Row counts ───
  const agg = await aggQ(`
    SELECT
      COUNT(*) as total_shows,
      COUNT(seasons) as with_seasons,
      COUNT(actors) as with_actors,
      COUNT(crew) as with_crew,
      COUNT(production_companies) as with_companies
    FROM ${TBL}
  `);

  log("  ROW COUNTS:");
  log(`    Total shows:       ${agg.total_shows}`);
  log(`    With seasons:      ${agg.with_seasons}`);
  log(`    With actors:       ${agg.with_actors}`);
  log(`    With crew:         ${agg.with_crew}`);
  log(`    With prod. co's:   ${agg.with_companies}`);
  log("");

  // ─── Nested element counts ───
  const nested = await aggQ(`
    SELECT
      SUM(ARRAY_LENGTH(actors)) as total_actors,
      SUM(ARRAY_LENGTH(crew)) as total_crew,
      SUM(ARRAY_LENGTH(production_companies)) as total_companies,
      SUM((SELECT SUM(ARRAY_LENGTH(se.episodes)) FROM UNNEST(seasons) se)) as total_episodes,
      SUM((SELECT SUM(ARRAY_LENGTH(ep.players)) FROM UNNEST(seasons) se, UNNEST(se.episodes) ep)) as total_players
    FROM ${TBL}
  `);

  log("  NESTED ELEMENTS:");
  log(`    Episodes:          ${nested.total_episodes}`);
  log(`    Actors:            ${nested.total_actors}`);
  log(`    Crew:              ${nested.total_crew}`);
  log(`    Players (links):   ${nested.total_players}`);
  log(`    Prod. companies:   ${nested.total_companies}`);
  log("");

  // ─── Averages ───
  log("  AVERAGES (per show):");
  log(`    Episodes:          ${(nested.total_episodes / agg.total_shows).toFixed(1)}`);
  log(`    Actors:            ${(nested.total_actors / agg.total_shows).toFixed(1)}`);
  log(`    Crew:              ${(nested.total_crew / agg.total_shows).toFixed(1)}`);
  log(`    Players:           ${(nested.total_players / agg.total_shows).toFixed(1)}`);
  log("");

  // ─── Enrichment quality ───
  const quality = await aggQ(`
    SELECT
      COUNTIF(imdb_id IS NOT NULL) as with_imdb,
      COUNTIF(csfd_id IS NOT NULL) as with_csfd,
      COUNTIF(imdb_rating IS NOT NULL) as with_imdb_rating,
      COUNTIF(csfd_rating IS NOT NULL) as with_csfd_rating,
      COUNTIF(ARRAY_LENGTH(actors) > 0) as enriched_actors,
      COUNTIF(ARRAY_LENGTH(crew) > 0) as enriched_crew
    FROM ${TBL}
  `);

  log("  ENRICHMENT QUALITY:");
  log(`    Has IMDB ID:          ${quality.with_imdb} / ${agg.total_shows}`);
  log(`    Has CSFD ID:          ${quality.with_csfd} / ${agg.total_shows}`);
  log(`    Has IMDB rating:      ${quality.with_imdb_rating} / ${agg.total_shows}`);
  log(`    Has CSFD rating:      ${quality.with_csfd_rating} / ${agg.total_shows}`);
  log(`    Has TMDB actors:      ${quality.enriched_actors} / ${agg.total_shows}`);
  log(`    Has TMDB crew:        ${quality.enriched_crew} / ${agg.total_shows}`);
  log("");

  // ─── Random sample ───
  const [sample] = await bqc.query({
    query: `
      SELECT slug, title, year, network, imdb_rating, csfd_rating,
        ARRAY_LENGTH(actors) as actor_count,
        ARRAY_LENGTH(crew) as crew_count,
        ARRAY_LENGTH(production_companies) as company_count
      FROM ${TBL}
      ORDER BY RAND()
      LIMIT 5
    `
  });

  log("  RANDOM SAMPLE (5 shows):");
  for (const s of sample) {
    const imdb = s.imdb_rating ? ` IMDB:${s.imdb_rating}` : "";
    const csfd = s.csfd_rating ? ` CSFD:${s.csfd_rating}` : "";
    log(`    ${s.title}${s.year ? ` (${s.year})` : ""}${imdb}${csfd}`);
    log(`      ${s.slug} | ${s.network || "?"} | ${s.actor_count} actors, ${s.crew_count} crew, ${s.company_count} companies`);
  }
  log("");

  // ─── Storage ───
  const stats = await bq.showStats();
  if (stats) {
    log("  STORAGE:");
    log(`    ${stats.size_mb} MB used (${stats.count} rows)`);
    log(`    ${((stats.size_mb / 10240) * 100).toFixed(2)}% of 10 GB free tier`);
  }

  log(`\n${"\u2500".repeat(100)}\n`);
}

// ─── SEARCH BQ ───

async function cmdSearchBq() {
  if (!bq.isAvailable()) { log("BigQuery not configured. Set GCP_PROJECT_ID."); return; }
  await bq.init();

  const query = args.filter(a => !a.startsWith("--"))[0];
  if (!query) { log("Usage: node index.js search-bq <query> [--limit N]"); return; }

  const limitIdx = args.indexOf("--limit");
  const limit = limitIdx >= 0 ? parseInt(args[limitIdx + 1]) || 20 : 20;

  const { BigQuery } = require("@google-cloud/bigquery");
  const bqc = new BigQuery({ projectId: process.env.GCP_PROJECT_ID });
  const TBL = "`spilledcinema.spilled_cinema.shows`";

  const start = Date.now();

  try {
    const [rows] = await bqc.query({
      query: `
        SELECT
          slug, title, alt_title, year, network,
          genres, imdb_rating, csfd_rating,
          runtime,
          ARRAY_LENGTH(actors) as actor_count,
          (SELECT SUM(ARRAY_LENGTH(se.episodes)) FROM UNNEST(seasons) se) as episode_count
        FROM ${TBL}
        WHERE LOWER(title) LIKE '%' || LOWER(@query) || '%'
           OR LOWER(alt_title) LIKE '%' || LOWER(@query) || '%'
           OR LOWER(description) LIKE '%' || LOWER(@query) || '%'
           OR EXISTS (SELECT 1 FROM UNNEST(genres) g WHERE LOWER(g) LIKE '%' || LOWER(@query) || '%')
        ORDER BY COALESCE(imdb_rating, 0) DESC
        LIMIT @limit
      `,
      params: { query, limit },
    });

    const elapsed = ((Date.now() - start) / 1000).toFixed(1);

    if (!rows.length) {
      log(`No results for "${query}" (${elapsed}s)`);
      return;
    }

    log(`\nSearch results for "${query}" (${rows.length} results in ${elapsed}s):\n`);

    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      const num = String(i + 1).padStart(3);
      const yr = r.year ? ` (${r.year})` : "";
      const imdb = r.imdb_rating ? ` IMDB: ${r.imdb_rating}` : "";
      const csfd = r.csfd_rating ? ` CSFD: ${r.csfd_rating}%` : "";
      const net = r.network ? ` [${r.network}]` : "";
      const slug = r.slug;
      const eps = r.episode_count ? `${r.episode_count} episodes, ` : "";
      const actors = r.actor_count ? `${r.actor_count} actors` : "";
      const genres = (r.genres || []).join(", ") || "";
      const extras = [eps, actors].filter(Boolean).join("");

      log(`  ${num}. ${r.title}${yr}${imdb}${csfd}${net}`);
      log(`      \u21b3 https://svetserialu.to/serial/${slug}`);
      if (extras || genres) log(`      ${extras}${extras && genres ? " · " : ""}${genres}`);
      log("");
    }
  } catch (e) {
    log(`Search failed: ${e.message}`);
  }
}

// ─── INTERACTIVE SEARCH ENGINE ───

async function cmdSearchEngine() {
  if (!algolia.isAvailable()) { log("Algolia not configured. Set ALGOLIA_APP_ID and ALGOLIA_API_KEY."); return; }

  const MAX_VISIBLE = 10;
  let limit = 20;
  let query = "";
  let results = [];
  let linesBelow = 0;
  let active = 0;

  if (!process.stdin.isTTY) { log("This command requires an interactive terminal."); return; }
  process.stdin.setRawMode(true);
  process.stdin.resume();

  function out(...a) { process.stdout.write(a.join("")); }

  function clearDown(n) {
    if (n > 0) out("\x1b[" + n + "A");
    out("\r\x1b[J");
  }

  function render() {
    clearDown(linesBelow);
    let n = 0;
    out("  search\x1b[33m>\x1b[0m " + query + "\n"); n++;
    if (results.length) {
      const elapsed = results._elapsed ? " (" + results._elapsed + "ms)" : "";
      out("  \u2713  " + results.length + " result" + (results.length !== 1 ? "s" : "") + elapsed + "\n"); n++;
    } else if (query.trim()) {
      out("  \u231b  Searching\u2026\n"); n++;
    }
    const show = results.slice(0, MAX_VISIBLE);
    for (const r of show) {
      const yr = r.year ? " (" + r.year + ")" : "";
      const imdb = r.imdb_rating ? "  IMDB: " + r.imdb_rating : "";
      const net = r.network ? "  [" + r.network + "]" : "";
      out("  " + r.title + yr + imdb + net + "\n"); n++;
      out("    \u21b3 https://svetserialu.to/serial/" + r.slug + "\n"); n++;
      if (r.genres?.length) {
        out("    " + (r.genres || []).join(", ") + "\n"); n++;
      }
    }
    if (results.length > MAX_VISIBLE) {
      out("  ... and " + (results.length - MAX_VISIBLE) + " more\n"); n++;
    }
    linesBelow = n;
  }

  async function doSearch(q) {
    const gen = ++active;
    const trimmed = q.trim();
    if (!trimmed) { results = []; render(); return; }
    results = [];
    results._q = trimmed;
    render();
    const start = Date.now();
    try {
      const hits = await algolia.search(trimmed, { limit });
      if (gen < active) return;
      results = hits;
      results._elapsed = Date.now() - start;
    } catch {
      if (gen < active) return;
      results = [];
    }
    render();
  }

  out("\x1b[?25l");
  out("\n  \u2550\u2550\u2550 svetserialu.to Algolia Search Engine \u2550".padEnd(76, "\u2550") + "\n");
  out("  Start typing \u2014 instant results  |  :q quit  Ctrl+C exit  :limit N\n");
  render();

  process.stdin.on("data", (buf) => {
    const key = buf.toString("utf8");
    if (key === "\x03" || key === "\x04") {
      out("\r\x1b[J\n  Bye!\n\n");
      process.stdin.setRawMode(false);
      process.stdin.pause();
      process.exit(0);
    }
    if (key === "\x1b" || key.startsWith("\x1b[")) return;
    if (key === "\r" || key === "\n") return;
    if (key === "\t") return;
    if (key === "\x7f" || key === "\b") {
      if (query.length > 0) { query = query.slice(0, -1); doSearch(query); }
      return;
    }
    if (query === "" && key === ":") { query = ":"; render(); return; }
    if (query.startsWith(":")) {
      query += key;
      if (query === ":q" || query === ":quit") {
        out("\r\x1b[J\n  Bye!\n\n");
        process.stdin.setRawMode(false);
        process.stdin.pause();
        process.exit(0);
      }
      if (/^:limit \d+$/.test(query)) {
        const n = parseInt(query.slice(7));
        if (n > 0 && n <= 500) { limit = n; query = "";
          clearDown(linesBelow); out("  Limit set to " + limit + "\n\n"); linesBelow = 0; render();
        }
        return;
      }
      render();
      return;
    }
    query += key;
    doSearch(query);
  });

  await new Promise(() => {});
}

async function cmdAlgoliaSync() {
  if (!algolia.isAvailable()) { log("Algolia not configured. Set ALGOLIA_APP_ID and ALGOLIA_API_KEY."); return; }
  log("\n=== Algolia Sync ===");
  const ok = await algolia.syncAll();
  log(ok ? "Done." : "Sync failed.");
}

async function cmdBatchFetchMissing() {
  const apiKey = process.env.TMDB_API_KEY;
  if (!apiKey) { log("TMDB_API_KEY not set — skipping enrichment."); }

  const existing = new Set(db.getAllSlugs());
  const allSlugs = db.getAllSlugs();
  const searchTerms = new Set();

  // Generate search terms from existing shows' slugs
  for (const slug of allSlugs) {
    const clean = slug.replace(/[^a-z0-9]/g, "");
    if (clean.length >= 3) searchTerms.add(clean.substring(0, 3));
    if (clean.length >= 4) searchTerms.add(clean.substring(0, 4));
  }

  const terms = [...searchTerms].sort();
  log(`\n=== Batch Fetch Missing Shows ===`);
  log(`Existing: ${existing.size}, Search terms: ${terms.length}`);

  let found = new Set();

  // Phase 1: Find all missing shows
  log("Phase 1: Searching for missing shows...");
  for (let i = 0; i < terms.length; i++) {
    const items = await scraper.searchShows(terms[i]);
    for (const item of items) {
      if (!existing.has(item.slug)) found.add(item.slug);
    }
    if ((i + 1) % 100 === 0) log(`  Searched ${i + 1}/${terms.length} — ${found.size} missing`);
    await sleep(80);
  }
  log(`Found ${found.size} missing shows.`);

  if (!found.size) { log("Nothing to fetch."); return; }

  const missing = [...found].sort();

  // Phase 2: Fetch details + episodes + players + TMDB for each
  log("Phase 2: Fetching details...");
  if (apiKey) enricher.init(apiKey);

  let fetched = 0;
  for (const slug of missing) {
    const detail = await scraper.fetchShowDetail(slug);
    if (detail) {
      db.saveShows([detail]);
      db.updateFtsForShows([detail.slug]);

      if (detail.seasons?.length) {
        const episodes = await scraper.fetchEpisodes(detail.slug, detail.seasons);
        if (episodes.length) db.saveEpisodes(detail.slug, episodes);

        // Players
        const showFromDb = db.getShow(slug);
        for (const ep of showFromDb?.episodes || []) {
          if (!ep.episode_url) continue;
          const players = await scraper.fetchEpisodePlayers(ep.episode_url, slug);
          if (players.length) db.saveEpisodePlayers(players);
          await sleep(80);
        }
      }

      // TMDB
      if (apiKey) {
        await enricher.enrichShow(slug);
      }
    }
    fetched++;
    log(`  [${fetched}/${missing.length}] ${slug}`);
    await sleep(150);
  }

  db.rebuildFts();
  log(`\nFetched ${fetched} shows.`);

  // Sync to Algolia
  if (algolia.isAvailable()) {
    log("Syncing to Algolia...");
    await algolia.syncAll();
  }

  const newStats = db.getStats();
  log(`Total shows now: ${newStats.showCount}`);
}

async function cmdDiscover() {
  log("=== Discovering shows from /serialy listing ===");
  const items = await scraper.discoverFromSerialy();
  log(`Found ${items.length} shows on /serialy.`);

  const existing = new Set(db.getAllSlugs());
  const newItems = items.filter(i => !existing.has(i.slug));
  log(`${newItems.length} new shows to fetch.`);

  if (!newItems.length) { log("Nothing new."); return; }

  let count = 0;
  for (const item of newItems) {
    const detail = await scraper.fetchShowDetail(item.slug);
    if (detail) {
      if (!detail.posterUrl && item.posterUrl) detail.posterUrl = item.posterUrl;
      if (!detail.title && item.title) detail.title = item.title;
      db.saveShows([detail]);
      db.updateFtsForShows([detail.slug]);
      if (detail.seasons?.length) {
        const episodes = await scraper.fetchEpisodes(detail.slug, detail.seasons);
        if (episodes.length) db.saveEpisodes(detail.slug, episodes);
      }
    }
    count++;
    if (count % 10 === 0) log(`  ${count}/${newItems.length} new shows fetched`);
    await sleep(100);
  }

  db.setMeta("last_full_fetch", String(Date.now()));
  log(`Done. ${count} new shows added.`);

  // Auto-sync to Algolia
  if (algolia.isAvailable()) {
    log("Syncing to Algolia...");
    await algolia.syncAll();
  }
}

main().catch(e => { console.error("Fatal:", e); process.exit(1); });
