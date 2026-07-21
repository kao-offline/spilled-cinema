const db = require("./db");
const { csfd } = require("node-csfd-api");

const TMDB_API = "https://api.themoviedb.org/3";
const TIMEOUT = 10000;

function log(...args) { console.error("[enricher]", ...args); }

let apiKey = null;

function init(key) { apiKey = key; }

function addKey(url) {
  const sep = url.includes("?") ? "&" : "?";
  return `${url}${sep}api_key=${apiKey}`;
}

async function fetch(url, retries = 3) {
  for (let i = 0; i < retries; i++) {
    try {
      const resp = await globalThis.fetch(addKey(url), {
        headers: { "User-Agent": "svetserialu-catalog/1.0" },
        signal: AbortSignal.timeout(TIMEOUT),
      });
      if (resp.ok) return await resp.json();
      if (resp.status === 429) { log(`Rate limited, waiting...`); await sleep(2000 * (i + 1)); continue; }
      log(`TMDB HTTP ${resp.status} for ${url}`);
      return null;
    } catch (e) {
      if (i === retries - 1) { log(`TMDB fetch failed ${url}: ${e.message}`); return null; }
      await sleep(1000 * (i + 1));
    }
  }
  return null;
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function findShow(imdbId) {
  if (!imdbId) return null;
  const data = await fetch(`${TMDB_API}/find/${imdbId}?external_source=imdb_id`);
  if (!data) return null;
  const results = data.tv_results || data.movie_results || [];
  return results[0] || null;
}

async function enrichShow(slug) {
  const show = db.getShow(slug);
  if (!show) { log(`Show not found: ${slug}`); return; }

  if (!show.imdb_id) { log(`No IMDB ID for ${slug}, skipping TMDB enrichment`); return; }

  const tmdbShow = await findShow(show.imdb_id);
  if (!tmdbShow) { log(`No TMDB result for ${show.imdb_id}`); return; }

  const tmdbId = tmdbShow.id;
  log(`Enriching ${slug} (TMDB ID: ${tmdbId})`);

  // Get full details
  const details = await fetch(`${TMDB_API}/tv/${tmdbId}?append_to_response=credits,external_ids,content_ratings`);
  if (!details) { log(`Failed to get details for TMDB ${tmdbId}`); return; }

  // ─── Actors ───
  const cast = details.credits?.cast || [];
  if (cast.length) {
    const actors = cast.map((person, idx) => ({
      id: `tmdb:${person.id}`,
      name: person.name,
      imageUrl: person.profile_path ? `https://image.tmdb.org/t/p/w185${person.profile_path}` : null,
      knownFor: person.known_for_department || "Acting",
      imdbId: null, // would need separate lookup
      tmdbId: String(person.id),
      role: person.character || null,
      episodeCount: person.episode_count || null,
      position: person.order ?? idx,
    }));
    db.saveShowActors(slug, actors);
    log(`  Saved ${actors.length} actors`);
  }

  // ─── Crew ───
  const crew = details.credits?.crew || [];
  const directorTypes = ["Director", "Executive Producer", "Producer", "Writer", "Creator"];
  const relevantCrew = crew.filter(c => directorTypes.includes(c.job));
  if (relevantCrew.length) {
    const crewData = relevantCrew.map(person => ({
      id: `tmdb:${person.id}`,
      name: person.name,
      job: person.job,
      department: person.department || null,
      imageUrl: person.profile_path ? `https://image.tmdb.org/t/p/w185${person.profile_path}` : null,
      tmdbId: String(person.id),
    }));
    db.saveShowCrew(slug, crewData);
    log(`  Saved ${crewData.length} crew members`);
  }

  // ─── Production Companies ───
  const companies = details.production_companies || [];
  if (companies.length) {
    const companyData = companies.map(c => ({
      id: String(c.id),
      name: c.name,
      tmdbId: c.id,
      logoUrl: c.logo_path ? `https://image.tmdb.org/t/p/w92${c.logo_path}` : null,
    }));
    db.saveProductionCompanies(slug, companyData);
    log(`  Saved ${companyData.length} production companies`);
  }

  // ─── Episode details (duration, air_date, director) ───
  if (details.seasons) {
    let totalDurations = 0;
    let durationCount = 0;
    for (const season of details.seasons) {
      if (!season.season_number || season.season_number === 0) continue;
      await sleep(250);
      const seasonData = await fetch(`${TMDB_API}/tv/${tmdbId}/season/${season.season_number}`);
      if (!seasonData?.episodes) continue;

      const dbEps = db.getDb().prepare("SELECT slug, episode_number FROM episodes WHERE show_slug = ? AND season_number = ?").all(slug, season.season_number);
      for (const ep of seasonData.episodes) {
        const match = dbEps.find(e => e.episode_number === ep.episode_number);
        if (!match) continue;

        const upd = {};
        if (ep.runtime) upd.duration = ep.runtime;
        if (ep.air_date) upd.air_date = ep.air_date;

        // Director from episode-level crew
        if (ep.crew?.length) {
          const dir = ep.crew.find(c => c.job === "Director");
          if (dir) {
            upd.director = dir.name;
            upd.director_tmdb = dir.id;
          }
        }

        if (Object.keys(upd).length) {
          const setClauses = Object.keys(upd).map(k => `${k} = ?`).join(", ");
          const vals = Object.values(upd);
          db.getDb().prepare(`UPDATE episodes SET ${setClauses} WHERE slug = ? AND show_slug = ?`).run(...vals, match.slug, slug);
          if (upd.duration) { totalDurations += upd.duration; durationCount++; }
        }
      }
    }
    if (durationCount) {
      const avgRuntime = Math.round(totalDurations / durationCount);
      db.getDb().prepare("UPDATE shows SET runtime = ? WHERE slug = ?").run(avgRuntime, slug);
      log(`  Updated ${durationCount} episode durations and release dates`);
    }
  }

  // ─── Update show metadata ───
  const updates = {};
  if (details.first_air_date && !show.year) updates.year = details.first_air_date.substring(0, 4);
  if (!show.genres?.length && details.genres) updates.genres = JSON.stringify(details.genres.map(g => g.name));
  if (details.origin_country?.length && !show.country) updates.country = details.origin_country.join(", ");
  if (details.status) updates.status = details.status;

  if (Object.keys(updates).length) {
    const setClauses = Object.keys(updates).map(k => `${k} = ?`).join(", ");
    const values = Object.values(updates);
    db.getDb().prepare(`UPDATE shows SET ${setClauses} WHERE slug = ?`).run(...values, slug);
    db.updateFtsForShows([slug]);
  }

  // ─── CSFD rating ───
  if (show.csfd_id && !show.csfd_rating) {
    try {
      const csfdData = await csfd.movie(parseInt(show.csfd_id));
      if (csfdData && csfdData.rating) {
        db.getDb().prepare("UPDATE shows SET csfd_rating = ? WHERE slug = ?").run(String(csfdData.rating), slug);
        log(`  CSFD rating: ${csfdData.rating}%`);
      }
    } catch (e) {
      log(`  CSFD API error: ${e.message}`);
    }
  }
}

async function enrichAll(options = {}) {
  const { onProgress, skipExisting, limit } = options;
  if (!apiKey) { log("TMDB API key not set. Set TMDB_API_KEY env var."); return 0; }

  const slugs = db.getAllSlugs();
  let count = 0;
  let enriched = 0;

  for (const slug of slugs) {
    count++;
    if (limit && count > limit) break;

    // Check if already enriched (has actors)
    if (skipExisting) {
      const existingActors = db.getDb().prepare("SELECT COUNT(*) as c FROM show_actors WHERE show_slug = ?").get(slug);
      if (existingActors.c > 0) { if (onProgress) onProgress({ phase: "skip", done: count, total: slugs.length }); continue; }
    }

    await enrichShow(slug);
    enriched++;
    if (onProgress) onProgress({ phase: "enrich", done: count, total: slugs.length });
    await sleep(500); // Rate limiting: 2 requests per second max
  }

  db.rebuildFts();
  log(`Enriched ${enriched} shows`);
  return enriched;
}

module.exports = { init, enrichShow, enrichAll };
