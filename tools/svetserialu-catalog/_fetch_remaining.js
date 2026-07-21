const db = require('./db');
const scraper = require('./scraper');
const enricher = require('./enricher');
const algolia = require('./algolia');
const apiKey = process.env.TMDB_API_KEY;
if (apiKey) enricher.init(apiKey);

const BATCH_SIZE = 3; // concurrent fetches
const DELAY = 120;

async function fetchOne(slug) {
  try {
    const detail = await scraper.fetchShowDetail(slug);
    if (!detail) return false;
    db.saveShows([detail]);
    db.updateFtsForShows([detail.slug]);
    if (detail.seasons?.length) {
      const episodes = await scraper.fetchEpisodes(detail.slug, detail.seasons);
      if (episodes.length) db.saveEpisodes(detail.slug, episodes);
    }
    if (apiKey) await enricher.enrichShow(slug);
    return true;
  } catch (e) {
    console.error('  Error on ' + slug + ': ' + e.message);
    return false;
  }
}

async function main() {
  // Find what's still missing
  const existing = new Set(db.getAllSlugs());
  const allSlugs = db.getAllSlugs();
  const searchTerms = new Set();
  for (const slug of allSlugs) {
    const clean = slug.replace(/[^a-z0-9]/g, '');
    if (clean.length >= 3) searchTerms.add(clean.substring(0, 3));
  }

  const terms = [...searchTerms].sort();
  console.log('Existing: ' + existing.size + ', Search terms: ' + terms.length);

  let missing = new Set();
  for (let i = 0; i < terms.length; i++) {
    const items = await scraper.searchShows(terms[i]);
    for (const item of items) {
      if (!existing.has(item.slug)) missing.add(item.slug);
    }
    if ((i + 1) % 200 === 0) console.log('  Search ' + (i + 1) + '/' + terms.length + ' - missing: ' + missing.size);
    await new Promise(r => setTimeout(r, 60));
  }

  const todo = [...missing].sort();
  console.log('\nMissing shows: ' + todo.length);
  if (!todo.length) { console.log('Nothing to fetch.'); return; }

  // Fetch in batches with concurrency
  let done = 0;
  for (let i = 0; i < todo.length; i += BATCH_SIZE) {
    const batch = todo.slice(i, i + BATCH_SIZE);
    const results = await Promise.all(batch.map(slug => fetchOne(slug)));
    done += results.filter(Boolean).length;
    if ((done) % 20 === 0 || done === todo.length) {
      console.log('  Fetched ' + done + '/' + todo.length);
    }
    if (i + BATCH_SIZE < todo.length) await new Promise(r => setTimeout(r, DELAY));
  }

  db.rebuildFts();
  console.log('\nDone. Total shows: ' + db.getStats().showCount);

  // Sync to Algolia
  if (algolia.isAvailable()) {
    console.log('Syncing to Algolia...');
    await algolia.syncAll();
  }
}
main().catch(console.error);
