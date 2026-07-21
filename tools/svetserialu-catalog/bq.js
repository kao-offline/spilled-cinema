const crypto = require("crypto");
const db = require("./db");

let bigquery = null;
let dataset = null;
let table = null;

const DATASET_ID = "spilled_cinema";
const TABLE_ID = "shows";
const BATCH_SIZE = 200;
const LOG_PREFIX = "[bq]";

function log(...args) { console.error(LOG_PREFIX, ...args); }

function isAvailable() {
  return !!process.env.GCP_PROJECT_ID;
}

async function init(projectId) {
  if (bigquery) return true;
  const pid = projectId || process.env.GCP_PROJECT_ID;
  if (!pid) { log("GCP_PROJECT_ID not set"); return false; }
  try {
    const { BigQuery } = require("@google-cloud/bigquery");
    bigquery = new BigQuery({ projectId: pid });
    return true;
  } catch (e) {
    log("Failed to init BigQuery:", e.message);
    return false;
  }
}

function createShowSchema() {
  return [
    { name: "slug", type: "STRING", mode: "REQUIRED" },
    { name: "checksum", type: "STRING", mode: "REQUIRED" },
    { name: "title", type: "STRING", mode: "NULLABLE" },
    { name: "alt_title", type: "STRING", mode: "NULLABLE" },
    { name: "description", type: "STRING", mode: "NULLABLE" },
    { name: "year", type: "STRING", mode: "NULLABLE" },
    { name: "poster_url", type: "STRING", mode: "NULLABLE" },
    { name: "genres", type: "STRING", mode: "REPEATED" },
    { name: "languages", type: "STRING", mode: "REPEATED" },
    { name: "audio_buckets", type: "STRING", mode: "REPEATED" },
    { name: "status", type: "STRING", mode: "NULLABLE" },
    { name: "network", type: "STRING", mode: "NULLABLE" },
    { name: "country", type: "STRING", mode: "NULLABLE" },
    { name: "imdb_id", type: "STRING", mode: "NULLABLE" },
    { name: "imdb_rating", type: "FLOAT", mode: "NULLABLE" },
    { name: "csfd_id", type: "STRING", mode: "NULLABLE" },
    { name: "csfd_rating", type: "FLOAT", mode: "NULLABLE" },
    { name: "runtime", type: "INTEGER", mode: "NULLABLE" },
    {
      name: "seasons", type: "RECORD", mode: "REPEATED",
      fields: [
        { name: "season_number", type: "INTEGER", mode: "REQUIRED" },
        {
          name: "episodes", type: "RECORD", mode: "REPEATED",
          fields: [
            { name: "code", type: "STRING", mode: "REQUIRED" },
            { name: "title", type: "STRING", mode: "NULLABLE" },
            { name: "url", type: "STRING", mode: "NULLABLE" },
            { name: "duration", type: "INTEGER", mode: "NULLABLE" },
            { name: "air_date", type: "STRING", mode: "NULLABLE" },
            { name: "director_tmdb", type: "INTEGER", mode: "NULLABLE" },
            {
              name: "players", type: "RECORD", mode: "REPEATED",
              fields: [
                { name: "provider", type: "STRING", mode: "REQUIRED" },
                { name: "language", type: "STRING", mode: "NULLABLE" },
                { name: "embed_url", type: "STRING", mode: "NULLABLE" },
                { name: "subtitles_url", type: "STRING", mode: "NULLABLE" },
              ],
            },
          ],
        },
      ],
    },
    {
      name: "actors", type: "RECORD", mode: "REPEATED",
      fields: [
        { name: "tmdb_id", type: "INTEGER", mode: "REQUIRED" },
        { name: "character", type: "STRING", mode: "NULLABLE" },
        { name: "episode_count", type: "INTEGER", mode: "NULLABLE" },
        { name: "position", type: "INTEGER", mode: "NULLABLE" },
      ],
    },
    {
      name: "crew", type: "RECORD", mode: "REPEATED",
      fields: [
        { name: "tmdb_id", type: "INTEGER", mode: "REQUIRED" },
        { name: "job", type: "STRING", mode: "NULLABLE" },
        { name: "department", type: "STRING", mode: "NULLABLE" },
      ],
    },
    { name: "production_companies", type: "INTEGER", mode: "REPEATED" },
    { name: "fetched_at", type: "TIMESTAMP", mode: "NULLABLE" },
    { name: "updated_at", type: "TIMESTAMP", mode: "NULLABLE" },
  ];
}

async function ensureTable() {
  if (!bigquery) return false;
  try {
    const ds = bigquery.dataset(DATASET_ID);
    const [dsExists] = await ds.exists();
    if (!dsExists) {
      await bigquery.createDataset(DATASET_ID);
      log(`Created dataset ${DATASET_ID}`);
    }
    const tbl = ds.table(TABLE_ID);
    const [tblExists] = await tbl.exists();
    if (!tblExists) {
      await ds.createTable(TABLE_ID, { schema: { fields: createShowSchema() } });
      log(`Created table ${DATASET_ID}.${TABLE_ID}`);
    }
    dataset = ds;
    table = tbl;
    return true;
  } catch (e) {
    log("ensureTable error:", e.message);
    return false;
  }
}

// Freshness timestamps should not turn an otherwise unchanged record into a
// content update on every maintenance cycle.
const EXCLUDED_KEYS = new Set(["checksum", "_", "fetched_at", "updated_at"]);

function canonicalJson(obj) {
  if (obj === null || obj === undefined) return null;
  if (Array.isArray(obj)) {
    const items = obj.map(canonicalJson).filter(x => x !== null && x !== undefined);
    return `[${items.join(",")}]`;
  }
  if (typeof obj === "object") {
    const keys = Object.keys(obj).sort();
    const pairs = keys
      .filter(k => obj[k] !== null && obj[k] !== undefined && !EXCLUDED_KEYS.has(k))
      .map(k => `${JSON.stringify(k)}:${canonicalJson(obj[k])}`);
    return `{${pairs.join(",")}}`;
  }
  return JSON.stringify(obj);
}

function computeChecksum(showData) {
  return crypto.createHash("sha256").update(canonicalJson(showData)).digest("hex");
}

function buildShowRow(slug) {
  const show = db.getShow(slug);
  if (!show) return null;

  const episodes = show.episodes || [];
  const players = show.players || [];
  const actors = show.actors || [];
  const crew = show.crew || [];
  const companies = show.production_companies || [];

  const playerMap = {};
  for (const p of players) {
    const key = p.episode_slug;
    if (!playerMap[key]) playerMap[key] = [];
    playerMap[key].push({
      provider: p.provider,
      language: p.language || null,
      embed_url: p.embed_url || null,
      subtitles_url: p.subtitles_url || null,
    });
  }

  const seasonMap = {};
  for (const ep of episodes) {
    const sn = ep.season_number;
    if (!seasonMap[sn]) seasonMap[sn] = [];
    seasonMap[sn].push({
      code: ep.episode_code || `s${String(sn).padStart(2, "0")}e${String(ep.episode_number || 0).padStart(2, "0")}`,
      title: ep.episode_title || null,
      url: ep.episode_url || null,
      duration: ep.duration || null,
      air_date: ep.air_date || null,
      director_tmdb: ep.director_tmdb || null,
      players: playerMap[ep.slug] || [],
    });
  }

  const seasons = Object.entries(seasonMap)
    .sort(([a], [b]) => parseInt(a) - parseInt(b))
    .map(([num, eps]) => ({
      season_number: parseInt(num),
      episodes: eps,
    }));

  const bqActors = actors
    .filter(a => a.tmdb_id)
    .map(a => ({
      tmdb_id: parseInt(a.tmdb_id),
      character: a.role || null,
      episode_count: a.episode_count || null,
      position: a.position || null,
    }));

  const bqCrew = crew
    .filter(c => c.tmdb_id)
    .map(c => ({
      tmdb_id: parseInt(c.tmdb_id),
      job: c.job || null,
      department: c.department || null,
    }));

  const bqCompanies = companies
    .map(c => c.tmdb_id ? parseInt(c.tmdb_id) : null)
    .filter(id => id !== null && !isNaN(id));

  const genres = (typeof show.genres === "string" ? JSON.parse(show.genres) : show.genres) || [];
  const languages = (typeof show.languages === "string" ? JSON.parse(show.languages) : show.languages) || [];
  const audioBuckets = (typeof show.audio_buckets === "string" ? JSON.parse(show.audio_buckets) : show.audio_buckets) || [];

  const dataObj = {
    slug: show.slug,
    title: show.title,
    alt_title: show.alt_title,
    description: show.description,
    year: show.year,
    poster_url: show.poster_url,
    genres,
    languages,
    audio_buckets: audioBuckets,
    status: show.status,
    network: show.network,
    country: show.country,
    imdb_id: show.imdb_id,
    imdb_rating: show.imdb_rating || null,
    csfd_id: show.csfd_id,
    csfd_rating: show.csfd_rating ? parseFloat(show.csfd_rating) : null,
    runtime: show.runtime || null,
    seasons,
    actors: bqActors,
    crew: bqCrew,
    production_companies: bqCompanies,
    fetched_at: show.fetched_at ? new Date(show.fetched_at).toISOString() : null,
    updated_at: show.updated_at ? new Date(show.updated_at).toISOString() : null,
  };

  dataObj.checksum = computeChecksum(dataObj);

  return dataObj;
}

async function getChecksums() {
  if (!bigquery || !table) return {};
  try {
    const [rows] = await bigquery.query({
      query: `SELECT slug, checksum FROM \`${bigquery.projectId}.${DATASET_ID}.${TABLE_ID}\``,
      params: {},
    });
    const map = {};
    for (const r of rows) map[r.slug] = r.checksum;
    return map;
  } catch (e) {
    log("getChecksums error:", e.message);
    return {};
  }
}

async function upsertShow(slug) {
  if (!bigquery || !table) return false;
  const row = buildShowRow(slug);
  if (!row) { log(`No data for ${slug}`); return false; }

  try {
    await bigquery.query({
      query: `DELETE FROM \`${bigquery.projectId}.${DATASET_ID}.${TABLE_ID}\` WHERE slug = @slug`,
      params: { slug },
    });
    await table.insert(row);
    return true;
  } catch (e) {
    log(`upsertShow(${slug}) error:`, e.message);
    return false;
  }
}

async function batchDelete(slugs) {
  if (!slugs.length || !bigquery) return;
  const tmpTable = `_delete_${Date.now()}`;
  try {
    const uuidSet = slugs.map(s => ({ slug: s }));
    await bigquery.query({
      query: `DELETE FROM \`${bigquery.projectId}.${DATASET_ID}.${TABLE_ID}\` WHERE slug IN UNNEST(@slugs)`,
      params: { slugs },
    });
  } catch (e) {
    log(`batchDelete error:`, e.message);
  }
}

async function batchInsert(rows) {
  if (!rows.length || !bigquery || !table) return 0;
  let inserted = 0;
  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const batch = rows.slice(i, i + BATCH_SIZE);
    try {
      await table.insert(batch);
      inserted += batch.length;
    } catch (e) {
      log(`batchInsert error at offset ${i}:`, e.message);
    }
  }
  return inserted;
}

async function syncShow(slug) {
  if (!isAvailable()) { log("BigQuery not configured. Set GCP_PROJECT_ID."); return false; }
  if (!bigquery) await init();
  if (!table) await ensureTable();
  if (!bigquery || !table) return false;

  const row = buildShowRow(slug);
  if (!row) return false;

  const existing = await getChecksums();
  if (existing[slug] === row.checksum) return true;

  return await upsertShow(slug);
}

async function syncAll() {
  if (!isAvailable()) { log("BigQuery not configured. Set GCP_PROJECT_ID."); return false; }
  if (!bigquery) await init();
  if (!table) await ensureTable();
  if (!bigquery || !table) return { total: 0, inserted: 0, skipped: 0 };

  const allSlugs = db.getAllSlugs();
  log(`Building rows for ${allSlugs.length} shows...`);

  const existingChecksums = await getChecksums();
  let toUpsert = [];

  for (let i = 0; i < allSlugs.length; i++) {
    const slug = allSlugs[i];
    const row = buildShowRow(slug);
    if (!row) continue;
    if (existingChecksums[slug] === row.checksum) continue;
    toUpsert.push(row);
  }

  log(`${allSlugs.length} total, ${toUpsert.length} changed/new, ${allSlugs.length - (Object.keys(existingChecksums).length)} new shows`);

  if (!toUpsert.length) return { total: allSlugs.length, inserted: 0, skipped: allSlugs.length };

  await batchDelete(toUpsert.map(r => r.slug));
  const inserted = await batchInsert(toUpsert);

  log(`Synced ${inserted}/${toUpsert.length} shows to BigQuery`);
  return { total: allSlugs.length, inserted, skipped: allSlugs.length - inserted };
}

async function showStats() {
  if (!bigquery) await init();
  if (!table) await ensureTable();
  if (!bigquery || !table) return null;
  try {
    const [rows] = await bigquery.query({
      query: `SELECT COUNT(*) as count FROM \`${bigquery.projectId}.${DATASET_ID}.${TABLE_ID}\``,
    });
    let sizeMb = null;
    try {
      const [sizeRows] = await bigquery.query({
        query: `SELECT ROUND(SUM(LENGTH(TO_JSON_STRING(t)))/1048576, 2) as size_mb FROM \`${bigquery.projectId}.${DATASET_ID}.${TABLE_ID}\` t`,
      });
      sizeMb = sizeRows[0]?.size_mb || null;
    } catch {}
    return { count: rows[0]?.count || 0, size_mb: sizeMb };
  } catch {
    return null;
  }
}

module.exports = {
  isAvailable,
  init,
  ensureTable,
  buildShowRow,
  computeChecksum,
  getChecksums,
  upsertShow,
  syncShow,
  syncAll,
  showStats,
};
