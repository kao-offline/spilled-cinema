const db = require('./db');
const scraper = require('./scraper');

const existing = new Set(db.getAllSlugs());
let found = new Set();

async function main() {
  const allSlugs = db.getAllSlugs();
  const searchTerms = new Set();

  // Add first 3 chars of every known show's slug
  for (const slug of allSlugs) {
    const clean = slug.replace(/[^a-z0-9]/g, '');
    if (clean.length >= 3) searchTerms.add(clean.substring(0, 3));
    if (clean.length >= 4) searchTerms.add(clean.substring(0, 4));
  }
  // Add common bigrams that might be blind spots
  for (const t of ['serial', 'film', 'novy', 'nej', 'laska', 'zivot', 'smrt', 'kral', 'krimi', 'drama', 'komedie', 'akcni', 'pribeh', 'lve', 'zije', 'misto', 'svet', 'dite', 'matka', 'otec', 'pritel', 'nepritel', 'valka', 'zbran', 'policie', 'detektiv', 'lekar', 'nemocnice', 'skola', 'trida', 'ulice', 'dum', 'byznys', 'pravnik', 'soud', 'vezeni', 'utek', 'hledani', 'ztraceny', 'tajemstvi', 'silver', 'gold', 'diamond', 'shadow', 'light', 'wolf', 'dragon', 'phoenix', 'thunder']) {
    searchTerms.add(t);
  }

  console.log('Existing shows:', existing.size);
  console.log('Search terms:', searchTerms.size);

  let count = 0;
  for (const term of searchTerms) {
    const items = await scraper.searchShows(term);
    for (const item of items) {
      if (!existing.has(item.slug)) found.add(item.slug);
    }
    count++;
    if (count % 50 === 0) {
      console.log('  Searched', count, '/', searchTerms.size, '- missing:', found.size);
    }
    await new Promise(r => setTimeout(r, 100));
    if (count >= 300) break;
  }

  console.log('\nExisting:', existing.size);
  console.log('Newly discovered missing:', found.size);
  const missingList = [...found].sort();
  console.log('Missing shows:', missingList.join(', '));
  if (missingList.length > 0) {
    console.log('\nTo fetch them:');
    for (const slug of missingList) {
      console.log('  node index.js get https://svetserialu.to/serial/' + slug);
    }
  }
}
main().catch(console.error);
