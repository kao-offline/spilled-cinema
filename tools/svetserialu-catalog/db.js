const Database = require("better-sqlite3");
const path = require("path");
const fs = require("fs");

const DB_DIR = path.join(__dirname, "data");
const DB_PATH = path.join(DB_DIR, "catalog.db");

let db;

function getDb() {
  if (db) return db;
  fs.mkdirSync(DB_DIR, { recursive: true });
  db = new Database(DB_PATH);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  if (!isSchemaReady()) initSchema();
  return db;
}

function isSchemaReady() {
  const tables = new Set(db.prepare("SELECT name FROM sqlite_master WHERE type IN ('table', 'index')").all().map(row => row.name));
  const requiredTables = ["shows", "episodes", "episode_players", "actors", "crew", "meta", "shows_fts", "episodes_fts", "actors_fts", "crew_fts"];
  if (!requiredTables.every(name => tables.has(name))) return false;

  const episodeColumns = new Set(db.prepare("PRAGMA table_info(episodes)").all().map(row => row.name));
  const showColumns = new Set(db.prepare("PRAGMA table_info(shows)").all().map(row => row.name));
  const companyColumns = new Set(db.prepare("PRAGMA table_info(production_companies)").all().map(row => row.name));
  return ["air_date", "director", "director_tmdb"].every(name => episodeColumns.has(name))
    && showColumns.has("csfd_rating")
    && companyColumns.has("tmdb_id");
}

function initSchema() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS shows (
      slug TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      alt_title TEXT,
      description TEXT,
      year TEXT,
      poster_url TEXT,
      genres TEXT DEFAULT '[]',
      audio_buckets TEXT DEFAULT '[]',
      languages TEXT DEFAULT '[]',
      status TEXT,
      network TEXT,
      country TEXT,
      imdb_id TEXT,
      imdb_rating REAL,
      csfd_id TEXT,
      csfd_rating TEXT,
      runtime INTEGER,
      fetched_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS episodes (
      slug TEXT NOT NULL,
      show_slug TEXT NOT NULL,
      season_number INTEGER NOT NULL,
      episode_number INTEGER,
      episode_code TEXT,
      episode_title TEXT,
      episode_url TEXT,
      duration INTEGER,
      air_date TEXT,
      director TEXT,
      director_tmdb INTEGER,
      fetched_at INTEGER NOT NULL,
      PRIMARY KEY (slug, show_slug),
      FOREIGN KEY (show_slug) REFERENCES shows(slug) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS episode_players (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      episode_slug TEXT NOT NULL,
      show_slug TEXT NOT NULL,
      provider TEXT NOT NULL,
      language TEXT,
      embed_url TEXT,
      subtitles_url TEXT,
      FOREIGN KEY (episode_slug, show_slug) REFERENCES episodes(slug, show_slug) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS actors (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      image_url TEXT,
      known_for TEXT,
      imdb_id TEXT,
      tmdb_id TEXT,
      fetched_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS show_actors (
      show_slug TEXT NOT NULL,
      actor_id TEXT NOT NULL,
      role TEXT,
      episode_count INTEGER,
      position INTEGER,
      PRIMARY KEY (show_slug, actor_id),
      FOREIGN KEY (show_slug) REFERENCES shows(slug) ON DELETE CASCADE,
      FOREIGN KEY (actor_id) REFERENCES actors(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS crew (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      job TEXT NOT NULL,
      department TEXT,
      image_url TEXT,
      tmdb_id TEXT,
      fetched_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS show_crew (
      show_slug TEXT NOT NULL,
      crew_id TEXT NOT NULL,
      job TEXT NOT NULL,
      PRIMARY KEY (show_slug, crew_id, job),
      FOREIGN KEY (show_slug) REFERENCES shows(slug) ON DELETE CASCADE,
      FOREIGN KEY (crew_id) REFERENCES crew(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS production_companies (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      logo_url TEXT,
      tmdb_id INTEGER,
      fetched_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS show_production_companies (
      show_slug TEXT NOT NULL,
      company_id TEXT NOT NULL,
      PRIMARY KEY (show_slug, company_id),
      FOREIGN KEY (show_slug) REFERENCES shows(slug) ON DELETE CASCADE,
      FOREIGN KEY (company_id) REFERENCES production_companies(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_episodes_show ON episodes(show_slug);
    CREATE INDEX IF NOT EXISTS idx_episodes_season ON episodes(show_slug, season_number);
    CREATE INDEX IF NOT EXISTS idx_players_episode ON episode_players(episode_slug);
    CREATE INDEX IF NOT EXISTS idx_show_actors_show ON show_actors(show_slug);
    CREATE INDEX IF NOT EXISTS idx_show_actors_actor ON show_actors(actor_id);
    CREATE INDEX IF NOT EXISTS idx_show_crew_show ON show_crew(show_slug);
    CREATE INDEX IF NOT EXISTS idx_show_crew_crew ON show_crew(crew_id);
    CREATE INDEX IF NOT EXISTS idx_actors_name ON actors(name);
    CREATE INDEX IF NOT EXISTS idx_crew_name ON crew(name);
  `);

  // Migrate existing databases: add new columns if missing
  try { db.exec("ALTER TABLE episodes ADD COLUMN air_date TEXT"); } catch {}
  try { db.exec("ALTER TABLE episodes ADD COLUMN director TEXT"); } catch {}
  try { db.exec("ALTER TABLE episodes ADD COLUMN director_tmdb INTEGER"); } catch {}
  try { db.exec("ALTER TABLE production_companies ADD COLUMN tmdb_id INTEGER"); } catch {}
  try { db.exec("ALTER TABLE shows ADD COLUMN csfd_rating TEXT"); } catch {}

  if (!db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='shows_fts'").get()) {
    db.exec(`
      CREATE VIRTUAL TABLE shows_fts USING fts5(
        slug, title, alt_title, description, genres, network, languages,
        tokenize='unicode61'
      );
      CREATE VIRTUAL TABLE episodes_fts USING fts5(
        episode_code, episode_title,
        tokenize='unicode61'
      );
      CREATE VIRTUAL TABLE actors_fts USING fts5(
        name, known_for,
        tokenize='unicode61'
      );
      CREATE VIRTUAL TABLE crew_fts USING fts5(
        name, job, department,
        tokenize='unicode61'
      );
    `);
  }
}

function close() {
  if (db) { db.close(); db = null; }
}

function saveShows(shows) {
  const d = getDb();
  const now = Date.now();
  const stmt = d.prepare(`
    INSERT INTO shows (slug, title, alt_title, description, year, poster_url, genres, audio_buckets, languages, status, network, country, imdb_id, imdb_rating, csfd_id, csfd_rating, runtime, fetched_at, updated_at)
    VALUES (@slug, @title, @altTitle, @description, @year, @posterUrl, @genres, @audioBuckets, @languages, @status, @network, @country, @imdbId, @imdbRating, @csfdId, @csfdRating, @runtime, @fetchedAt, @updatedAt)
    ON CONFLICT(slug) DO UPDATE SET
      title=excluded.title, alt_title=excluded.alt_title, description=excluded.description,
      year=excluded.year, poster_url=excluded.poster_url, genres=excluded.genres,
      audio_buckets=excluded.audio_buckets, languages=excluded.languages,
      status=excluded.status, network=excluded.network, country=excluded.country,
      imdb_id=COALESCE(excluded.imdb_id, shows.imdb_id),
      imdb_rating=COALESCE(excluded.imdb_rating, shows.imdb_rating),
      csfd_id=COALESCE(excluded.csfd_id, shows.csfd_id),
      csfd_rating=COALESCE(excluded.csfd_rating, shows.csfd_rating),
      runtime=COALESCE(excluded.runtime, shows.runtime),
      fetched_at=excluded.fetched_at, updated_at=excluded.updated_at
  `);
  const tx = d.transaction(() => {
    for (const s of shows) {
      stmt.run({
        slug: s.slug, title: s.title, altTitle: s.altTitle ?? null,
        description: s.description ?? null, year: s.year ?? null,
        posterUrl: s.posterUrl ?? null, genres: JSON.stringify(s.genres ?? []),
        audioBuckets: JSON.stringify(s.audioBuckets ?? []),
        languages: JSON.stringify(s.languages ?? []),
        status: s.status ?? null, network: s.network ?? null,
        country: s.country ?? null, imdbId: s.imdbId ?? null,
        imdbRating: s.imdbRating ?? null, csfdId: s.csfdId ?? null,
        csfdRating: s.csfdRating ?? null,
        runtime: s.runtime ?? null, fetchedAt: now, updatedAt: now,
      });
    }
  });
  tx();
  return shows.length;
}

function saveEpisodes(showSlug, episodes) {
  const d = getDb();
  const now = Date.now();
  if (!episodes?.length) return 0;
  const stmt = d.prepare(`
    INSERT INTO episodes (slug, show_slug, season_number, episode_number, episode_code, episode_title, episode_url, duration, air_date, director, director_tmdb, fetched_at)
    VALUES (@slug, @showSlug, @seasonNumber, @episodeNumber, @episodeCode, @episodeTitle, @episodeUrl, @duration, @airDate, @director, @directorTmdb, @fetchedAt)
    ON CONFLICT(slug, show_slug) DO UPDATE SET
      season_number=excluded.season_number, episode_number=excluded.episode_number,
      episode_code=excluded.episode_code, episode_title=excluded.episode_title,
      episode_url=excluded.episode_url,
      duration=COALESCE(excluded.duration, episodes.duration),
      air_date=COALESCE(excluded.air_date, episodes.air_date),
      director=COALESCE(excluded.director, episodes.director),
      director_tmdb=COALESCE(excluded.director_tmdb, episodes.director_tmdb),
      fetched_at=excluded.fetched_at
  `);
  const tx = d.transaction(() => {
    for (const ep of episodes) {
      stmt.run({
        slug: ep.slug, showSlug, seasonNumber: ep.seasonNumber,
        episodeNumber: ep.episodeNumber ?? null, episodeCode: ep.episodeCode ?? null,
        episodeTitle: ep.episodeTitle ?? null, episodeUrl: ep.episodeUrl ?? null,
        duration: ep.duration ?? null, airDate: ep.airDate ?? null,
        director: ep.director ?? null, directorTmdb: ep.directorTmdb ?? null, fetchedAt: now,
      });
    }
  });
  tx();
  updateFtsForEpisodes(showSlug);
  return episodes.length;
}

function saveEpisodePlayers(players) {
  const d = getDb();
  if (!players?.length) return 0;
  const stmt = d.prepare(`
    INSERT OR REPLACE INTO episode_players (episode_slug, show_slug, provider, language, embed_url, subtitles_url)
    VALUES (@episodeSlug, @showSlug, @provider, @language, @embedUrl, @subtitlesUrl)
  `);
  const tx = d.transaction(() => {
    for (const p of players) {
      stmt.run({
        episodeSlug: p.episodeSlug, showSlug: p.showSlug,
        provider: p.provider, language: p.language ?? null,
        embedUrl: p.embedUrl ?? null, subtitlesUrl: p.subtitlesUrl ?? null,
      });
    }
  });
  tx();
  return players.length;
}

function saveShowActors(showSlug, actors) {
  const d = getDb();
  if (!actors?.length) return;
  const now = Date.now();
  const actorStmt = d.prepare(`
    INSERT OR REPLACE INTO actors (id, name, image_url, known_for, imdb_id, tmdb_id, fetched_at)
    VALUES (@id, @name, @imageUrl, @knownFor, @imdbId, @tmdbId, @fetchedAt)
  `);
  const roleStmt = d.prepare(`
    INSERT OR REPLACE INTO show_actors (show_slug, actor_id, role, episode_count, position)
    VALUES (@showSlug, @actorId, @role, @episodeCount, @position)
  `);
  const ftsStmt = d.prepare(`
    INSERT OR REPLACE INTO actors_fts(rowid, name, known_for)
    VALUES ((SELECT rowid FROM actors WHERE id = @id), @name, @knownFor)
  `);
  const tx = d.transaction(() => {
    for (const a of actors) {
      actorStmt.run({
        id: a.id, name: a.name, imageUrl: a.imageUrl ?? null,
        knownFor: a.knownFor ?? null, imdbId: a.imdbId ?? null,
        tmdbId: a.tmdbId ?? null, fetchedAt: now,
      });
      roleStmt.run({
        showSlug, actorId: a.id, role: a.role ?? null,
        episodeCount: a.episodeCount ?? null, position: a.position ?? null,
      });
      ftsStmt.run({ id: a.id, name: a.name, knownFor: a.knownFor ?? "" });
    }
  });
  tx();
}

function saveShowCrew(showSlug, crewList) {
  const d = getDb();
  if (!crewList?.length) return;
  const now = Date.now();
  const crewStmt = d.prepare(`
    INSERT OR REPLACE INTO crew (id, name, job, department, image_url, tmdb_id, fetched_at)
    VALUES (@id, @name, @job, @department, @imageUrl, @tmdbId, @fetchedAt)
  `);
  const roleStmt = d.prepare(`
    INSERT OR REPLACE INTO show_crew (show_slug, crew_id, job)
    VALUES (@showSlug, @crewId, @job)
  `);
  const ftsStmt = d.prepare(`
    INSERT OR REPLACE INTO crew_fts(rowid, name, job, department)
    VALUES ((SELECT rowid FROM crew WHERE id = @id), @name, @job, @department)
  `);
  const tx = d.transaction(() => {
    for (const c of crewList) {
      const cId = c.id || `crew:${c.name.replace(/\s+/g, "-").toLowerCase()}:${c.job.replace(/\s+/g, "-").toLowerCase()}`;
      crewStmt.run({
        id: cId, name: c.name, job: c.job,
        department: c.department ?? null, imageUrl: c.imageUrl ?? null,
        tmdbId: c.tmdbId ?? null, fetchedAt: now,
      });
      roleStmt.run({ showSlug, crewId: cId, job: c.job });
      ftsStmt.run({ id: cId, name: c.name, job: c.job, department: c.department ?? "" });
    }
  });
  tx();
}

function saveProductionCompanies(showSlug, companies) {
  const d = getDb();
  if (!companies?.length) return;
  const now = Date.now();
  const coStmt = d.prepare(`
    INSERT OR REPLACE INTO production_companies (id, name, logo_url, tmdb_id, fetched_at)
    VALUES (@id, @name, @logoUrl, @tmdbId, @fetchedAt)
  `);
  const relStmt = d.prepare(`
    INSERT OR REPLACE INTO show_production_companies (show_slug, company_id)
    VALUES (@showSlug, @companyId)
  `);
  const tx = d.transaction(() => {
    for (const c of companies) {
      const cId = c.id || `prodco:${c.name.replace(/\s+/g, "-").toLowerCase()}`;
      coStmt.run({ id: cId, name: c.name, logoUrl: c.logoUrl ?? null, tmdbId: c.tmdbId ?? null, fetchedAt: now });
      relStmt.run({ showSlug, companyId: cId });
    }
  });
  tx();
}

function updateFtsForShows(slugs) {
  const d = getDb();
  d.prepare("DELETE FROM shows_fts WHERE slug IN (" + slugs.map(() => "?").join(",") + ")").run(...slugs);
  const rows = d.prepare("SELECT rowid, slug, title, alt_title, description, genres, network, languages FROM shows WHERE slug IN (" + slugs.map(() => "?").join(",") + ")").all(...slugs);
  const insert = d.prepare("INSERT INTO shows_fts(rowid, slug, title, alt_title, description, genres, network, languages) VALUES (?, ?, ?, ?, ?, ?, ?, ?)");
  for (const r of rows) {
    insert.run(r.rowid, r.slug, r.title, r.alt_title ?? "", r.description ?? "", r.genres ?? "", r.network ?? "", r.languages ?? "");
  }
}

function updateFtsForEpisodes(showSlug) {
  const d = getDb();
  d.prepare("DELETE FROM episodes_fts WHERE rowid IN (SELECT e.rowid FROM episodes e WHERE e.show_slug = ?)").run(showSlug);
  const rows = d.prepare("SELECT e.rowid, e.episode_code, e.episode_title FROM episodes e WHERE e.show_slug = ?").all(showSlug);
  const insert = d.prepare("INSERT INTO episodes_fts(rowid, episode_code, episode_title) VALUES (?, ?, ?)");
  for (const r of rows) insert.run(r.rowid, r.episode_code ?? "", r.episode_title ?? "");
}

function rebuildFts() {
  const d = getDb();
  for (const t of ["shows_fts", "episodes_fts", "actors_fts", "crew_fts"]) {
    d.exec(`DELETE FROM ${t}`);
  }
  d.exec(`INSERT INTO shows_fts(rowid, slug, title, alt_title, description, genres, network, languages) SELECT rowid, slug, title, COALESCE(alt_title,''), COALESCE(description,''), genres, COALESCE(network,''), COALESCE(languages,'') FROM shows`);
  d.exec(`INSERT INTO episodes_fts(rowid, episode_code, episode_title) SELECT rowid, COALESCE(episode_code,''), COALESCE(episode_title,'') FROM episodes`);
  d.exec(`INSERT INTO actors_fts(rowid, name, known_for) SELECT rowid, name, COALESCE(known_for,'') FROM actors`);
  d.exec(`INSERT INTO crew_fts(rowid, name, job, department) SELECT rowid, name, job, COALESCE(department,'') FROM crew`);
}

function showExists(slug) { return !!getDb().prepare("SELECT 1 FROM shows WHERE slug = ?").get(slug); }
function getAllSlugs() { return getDb().prepare("SELECT slug FROM shows ORDER BY title").all().map(r => r.slug); }

function getShow(slug) {
  const d = getDb();
  const show = d.prepare("SELECT * FROM shows WHERE slug = ?").get(slug);
  if (!show) return null;
  show.genres = JSON.parse(show.genres || "[]");
  show.audio_buckets = JSON.parse(show.audio_buckets || "[]");
  show.languages = JSON.parse(show.languages || "[]");
  show.episodes = d.prepare("SELECT * FROM episodes WHERE show_slug = ? ORDER BY season_number, episode_number").all(slug);
  show.players = d.prepare(`SELECT ep.* FROM episode_players ep JOIN episodes e ON ep.episode_slug = e.slug AND ep.show_slug = e.show_slug WHERE e.show_slug = ?`).all(slug);
  show.actors = d.prepare(`SELECT a.*, sa.role, sa.episode_count, sa.position FROM show_actors sa JOIN actors a ON a.id = sa.actor_id WHERE sa.show_slug = ? ORDER BY sa.position`).all(slug);
  show.crew = d.prepare(`SELECT c.*, sc.job FROM show_crew sc JOIN crew c ON c.id = sc.crew_id WHERE sc.show_slug = ?`).all(slug);
  show.production_companies = d.prepare(`SELECT pc.* FROM show_production_companies spc JOIN production_companies pc ON pc.id = spc.company_id WHERE spc.show_slug = ?`).all(slug);
  return show;
}

const FTS_STOP_WORDS = new Set(["a", "an", "and", "of", "or", "the", "to"]);

function buildFtsPrefixQuery(query) {
  const cleaned = String(query || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .trim();
  const rawTokens = cleaned.split(/\s+/).filter(Boolean);
  const significant = rawTokens.filter(token => !FTS_STOP_WORDS.has(token));
  const tokens = significant.length ? significant : rawTokens;
  return tokens.map(token => `"${token}"*`).join(" AND ");
}

function searchShows(query, limit = 30) {
  const d = getDb();
  const ftsQuery = buildFtsPrefixQuery(query);
  if (ftsQuery) {
    try {
      return d.prepare(`SELECT s.*, rank FROM shows_fts f JOIN shows s ON s.rowid = f.rowid WHERE shows_fts MATCH ? ORDER BY rank LIMIT ?`).all(ftsQuery, Math.max(1, limit)).map(r => ({ ...r, genres: JSON.parse(r.genres || "[]") }));
    } catch {}
  }
  const like = `%${query}%`;
  return d.prepare("SELECT * FROM shows WHERE title LIKE ? OR alt_title LIKE ? OR slug LIKE ? LIMIT ?").all(like, like, like, Math.max(1, limit)).map(r => ({ ...r, genres: JSON.parse(r.genres || "[]") }));
}

function searchEpisodes(query, limit = 50) {
  const d = getDb();
  const ftsQuery = buildFtsPrefixQuery(query);
  if (ftsQuery) {
    try {
      return d.prepare(`SELECT e.*, s.title as show_title, s.poster_url as show_poster FROM episodes_fts f JOIN episodes e ON e.rowid = f.rowid JOIN shows s ON s.slug = e.show_slug WHERE episodes_fts MATCH ? ORDER BY rank LIMIT ?`).all(ftsQuery, Math.max(1, limit));
    } catch {}
  }
  const like = `%${query}%`;
  return d.prepare(`SELECT e.*, s.title as show_title, s.poster_url as show_poster FROM episodes e JOIN shows s ON s.slug = e.show_slug WHERE e.episode_title LIKE ? OR e.episode_code LIKE ? LIMIT ?`).all(like, like, Math.max(1, limit));
}

function searchActors(query, limit = 30) {
  const d = getDb();
  const ftsQuery = buildFtsPrefixQuery(query);
  if (ftsQuery) {
    try {
      return d.prepare(`SELECT a.*, rank FROM actors_fts f JOIN actors a ON a.rowid = f.rowid WHERE actors_fts MATCH ? ORDER BY rank LIMIT ?`).all(ftsQuery, Math.max(1, limit));
    } catch {}
  }
  const like = `%${query}%`;
  return d.prepare(`SELECT * FROM actors WHERE name LIKE ? LIMIT ?`).all(like, Math.max(1, limit));
}

function getActorShows(actorId) {
  return getDb().prepare(`SELECT s.slug, s.title, sa.role, sa.episode_count FROM show_actors sa JOIN shows s ON s.slug = sa.show_slug WHERE sa.actor_id = ? ORDER BY s.title`).all(actorId);
}

function getStats() {
  const d = getDb();
  return {
    showCount: d.prepare("SELECT COUNT(*) as c FROM shows").get().c,
    episodeCount: d.prepare("SELECT COUNT(*) as c FROM episodes").get().c,
    actorCount: d.prepare("SELECT COUNT(*) as c FROM actors").get().c,
    crewCount: d.prepare("SELECT COUNT(*) as c FROM crew").get().c,
    playerCount: d.prepare("SELECT COUNT(*) as c FROM episode_players").get().c,
    companyCount: d.prepare("SELECT COUNT(*) as c FROM production_companies").get().c,
    lastFetch: d.prepare("SELECT value FROM meta WHERE key = 'last_full_fetch'").get()?.value ?? null,
    lastRefresh: d.prepare("SELECT value FROM meta WHERE key = 'last_refresh'").get()?.value ?? null,
  };
}

function listShows(limit = 50, offset = 0) {
  return getDb().prepare("SELECT slug, title, year, genres, network, imdb_rating, fetched_at FROM shows ORDER BY title LIMIT ? OFFSET ?").all(limit, offset).map(r => ({ ...r, genres: JSON.parse(r.genres || "[]") }));
}

function getOldestShows(limit = 40) {
  return getDb().prepare(`
    SELECT slug, title, poster_url, fetched_at
    FROM shows
    ORDER BY fetched_at ASC, slug ASC
    LIMIT ?
  `).all(Math.max(1, limit));
}

function setMeta(key, value) { getDb().prepare("INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)").run(key, String(value)); }
function getMeta(key) { return getDb().prepare("SELECT value FROM meta WHERE key = ?").get(key)?.value ?? null; }
function deleteEpisodesForShow(showSlug) { getDb().prepare("DELETE FROM episodes WHERE show_slug = ?").run(showSlug); }
function pruneEpisodesForShow(showSlug, currentSlugs) {
  const d = getDb();
  const keep = new Set(currentSlugs);
  const stale = d.prepare("SELECT rowid, slug FROM episodes WHERE show_slug = ?").all(showSlug).filter(row => !keep.has(row.slug));
  const deleteFts = d.prepare("DELETE FROM episodes_fts WHERE rowid = ?");
  const deleteEpisode = d.prepare("DELETE FROM episodes WHERE show_slug = ? AND slug = ?");
  d.transaction(() => {
    for (const row of stale) {
      deleteFts.run(row.rowid);
      deleteEpisode.run(showSlug, row.slug);
    }
  })();
  return stale.length;
}

module.exports = {
  getDb, close,
  saveShows, saveEpisodes, saveEpisodePlayers,
  saveShowActors, saveShowCrew, saveProductionCompanies,
  updateFtsForShows, rebuildFts,
  showExists, getAllSlugs, getShow,
  searchShows, searchEpisodes, searchActors, getActorShows,
  getStats, listShows,
  getOldestShows,
  setMeta, getMeta, deleteEpisodesForShow, pruneEpisodesForShow,
};
