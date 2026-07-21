const { algoliasearch } = require("algoliasearch");
const db = require("./db");

const LOG_PREFIX = "[algolia]";
function log(...args) { console.error(LOG_PREFIX, ...args); }

let client = null;
let initialized = false;

const INDEX_NAME = "spilledcinema_shows";

function isAvailable() {
  return !!(process.env.ALGOLIA_APP_ID && process.env.ALGOLIA_API_KEY);
}

async function init() {
  if (initialized) return true;
  try {
    client = algoliasearch(process.env.ALGOLIA_APP_ID, process.env.ALGOLIA_API_KEY);
    initialized = true;
    return true;
  } catch (e) {
    log("Failed to init Algolia:", e.message);
    return false;
  }
}

async function configureIndex() {
  try {
    await client.setSettings({
      indexName: INDEX_NAME,
      indexSettings: {
        searchableAttributes: [
          "title",
          "alt_title",
          "unordered(actors.n)",
          "unordered(actors.r)",
          "unordered(crew.n)",
          "unordered(crew.j)",
          "unordered(episodes.c)",
          "unordered(episodes.t)",
          "unordered(episodes_text)",
          "unordered(genres)",
          "unordered(network)",
          "description",
        ],
        customRanking: [
          "desc(imdb_rating)",
          "desc(csfd_rating)",
        ],
        attributesForFaceting: [
          "network",
          "genres",
          "year_start",
          "status",
        ],
        typoTolerance: "min",
        minWordSizefor1Typo: 3,
        minWordSizefor2Typos: 7,
        hitsPerPage: 20,
      },
    });
    log("Index settings configured.");
  } catch (e) {
    log("Failed to configure index:", e.message);
  }
}

function buildRecord(slug) {
  const show = db.getShow(slug);
  if (!show) return null;

  const genres = (typeof show.genres === "string" ? JSON.parse(show.genres) : show.genres) || [];
  const languages = (typeof show.languages === "string" ? JSON.parse(show.languages) : show.languages) || [];

  let yearStart = null, yearEnd = null;
  if (show.year) {
    const parts = show.year.split("–").map(s => s.trim());
    yearStart = parseInt(parts[0]) || null;
    yearEnd = parts[1] ? (parseInt(parts[1]) || null) : yearStart;
  }

  // Episodes — compact format (code + title only), capped at 50 to stay under 10KB/record limit
  const allEps = show.episodes || [];
  const MAX_EPS = 50;
  const episodes = allEps.slice(0, MAX_EPS).map(ep => ({
    c: ep.episode_code || `s${String(ep.season_number).padStart(2, "0")}e${String(ep.episode_number || 0).padStart(2, "0")}`,
    t: ep.episode_title ? ep.episode_title.substring(0, 80) : null,
    s: ep.season_number,
  }));

  // Searchable text blob with ALL episode codes (truncated to fit under 10KB total)
  let episodes_text = null;
  if (allEps.length > MAX_EPS) {
    episodes_text = allEps.map(ep =>
      ep.episode_code || `s${String(ep.season_number).padStart(2, "0")}e${String(ep.episode_number || 0).padStart(2, "0")}`
    ).join(" ");
    if (episodes_text.length > 2000) episodes_text = episodes_text.substring(0, 2000);
  }

  // Actors — top 50 with names
  const actors = (show.actors || []).slice(0, 50).map(a => ({
    n: a.name,
    r: a.role || null,
    tmdb_id: a.tmdb_id ? parseInt(a.tmdb_id) : null,
  }));

  // Crew — top 30 with names
  const crew = (show.crew || []).slice(0, 30).map(c => ({
    n: c.name,
    j: c.job,
    d: c.department || null,
    tmdb_id: c.tmdb_id ? parseInt(c.tmdb_id) : null,
  }));

  // Production companies
  const companies = (show.production_companies || []).map(c => ({
    n: c.name,
    tmdb_id: c.tmdb_id || null,
  }));

  return {
    objectID: slug,
    slug,
    title: show.title,
    alt_title: show.alt_title || null,
    year: show.year || null,
    year_start: yearStart,
    year_end: yearEnd,
    description: show.description ? show.description.substring(0, 500) : null,
    poster_url: show.poster_url || null,
    genres,
    network: show.network || null,
    country: show.country || null,
    language: languages,
    status: show.status || null,
    imdb_id: show.imdb_id || null,
    imdb_rating: show.imdb_rating || null,
    csfd_id: show.csfd_id || null,
    csfd_rating: show.csfd_rating ? (typeof show.csfd_rating === "string" ? parseFloat(show.csfd_rating) : show.csfd_rating) : null,
    runtime: show.runtime || null,
    episode_count: allEps.length,
    actor_count: (show.actors || []).length,
    season_count: new Set(allEps.map(e => e.season_number)).size,
    actors,
    crew,
    production_companies: companies,
    episodes,
    episodes_text,
  };
}

async function syncAll() {
  if (!isAvailable()) { log("Algolia not configured. Set ALGOLIA_APP_ID and ALGOLIA_API_KEY."); return false; }
  if (!initialized) await init();
  if (!client) return false;

  const allSlugs = db.getAllSlugs();
  log(`Building ${allSlugs.length} records...`);

  const objects = [];
  for (let i = 0; i < allSlugs.length; i++) {
    const record = buildRecord(allSlugs[i]);
    if (record) objects.push(record);
    if ((i + 1) % 500 === 0) log(`  Built ${i + 1}/${allSlugs.length} records`);
  }

  log(`Built ${objects.length} records. Pushing to Algolia...`);
  const start = Date.now();

  try {
    await client.replaceAllObjects({ indexName: INDEX_NAME, objects });
    await configureIndex();

    const elapsed = ((Date.now() - start) / 1000).toFixed(1);
    log(`Synced ${objects.length} records to Algolia in ${elapsed}s`);
    return true;
  } catch (e) {
    log("Sync failed:", e.message);
    return false;
  }
}

async function syncSlugs(slugs) {
  if (!isAvailable()) return false;
  if (!initialized) await init();
  if (!client) return false;

  const unique = [...new Set((slugs || []).filter(Boolean))];
  if (!unique.length) return true;
  const objects = unique.map(buildRecord).filter(Boolean);
  if (!objects.length) return true;

  try {
    await client.saveObjects({ indexName: INDEX_NAME, objects });
    log(`Updated ${objects.length} Algolia records.`);
    return true;
  } catch (e) {
    log("Incremental sync failed:", e.message);
    return false;
  }
}

async function search(query, { limit = 20 } = {}) {
  if (!initialized) await init();
  if (!client) return [];

  try {
    const { results } = await client.search({
      requests: [{
        indexName: INDEX_NAME,
        query,
        hitsPerPage: limit,
      }],
    });
    return results[0]?.hits || [];
  } catch (e) {
    log("Search failed:", e.message);
    return [];
  }
}

module.exports = { isAvailable, init, syncAll, syncSlugs, search, buildRecord };
