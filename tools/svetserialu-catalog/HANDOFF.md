# svetserialu-catalog

Standalone CLI tool that scrapes the complete **svetserialu.to** catalog (2299+ shows), enriches it with TMDB + CSFD metadata, and stores it in **Google BigQuery** using a compact nested schema with checksum-based incremental sync.

## Location

```
tools/svetserialu-catalog/
├── index.js          CLI entry point (all commands)
├── scraper.js        Discovery, detail, episode & player scraping
├── enricher.js       TMDB (actors/crew/companies) + CSFD rating enrichment
├── db.js             Local SQLite cache (better-sqlite3)
├── bq.js             BigQuery sync module (compact nested schema, checksums)
├── .env              Credentials (gitignored): GCP_PROJECT_ID, TMDB_API_KEY
├── gcp-key.json      Service account key (gitignored)
├── package.json      Dependencies: @google-cloud/bigquery, better-sqlite3, node-csfd-api
└── HANDOFF.md        This file
```

## Credentials (already configured in `.env`)

| Variable | Value |
|---|---|
| `GCP_PROJECT_ID` | `spilledcinema` |
| `GOOGLE_APPLICATION_CREDENTIALS` | `tools/svetserialu-catalog/gcp-key.json` |
| `TMDB_API_KEY` | `95a41d8368dc612f1abb0ddcda715a2d` |

## BigQuery Schema (single table `spilled_cinema.shows`)

Compact nested format — no text duplication:

```
slug: STRING REQUIRED
checksum: STRING REQUIRED (SHA256 for incremental sync)
title, alt_title, description, year, poster_url: STRING
genres, languages, audio_buckets: REPEATED STRING
status, network, country: STRING
imdb_id, csfd_id: STRING
imdb_rating: FLOAT, csfd_rating: FLOAT
runtime: INTEGER
seasons: REPEATED RECORD {
  season_number: INTEGER,
  episodes: REPEATED RECORD {
    code: STRING,
    title, url, air_date: STRING,
    duration: INTEGER,
    director_tmdb: INTEGER (TMDB person ID, not name),
    players: REPEATED RECORD { provider, language, embed_url, subtitles_url: STRING }
  }
}
actors: REPEATED RECORD { tmdb_id: INTEGER, character: STRING, episode_count, position: INTEGER }
crew: REPEATED RECORD { tmdb_id: INTEGER, job, department: STRING }
production_companies: REPEATED INTEGER (just TMDB IDs)
fetched_at, updated_at: TIMESTAMP
```

**Rationale**: Actors/crew stored by TMDB ID instead of name (saves ~60% space, names can be looked up via TMDB API). Directors stored as TMDB person ID. Production companies as TMDB ID array.

## Commands

| Command | What it does |
|---|---|
| `get [--bq] <url>` | Scrape one show: detail + episodes + players + TMDB enrich + CSFD rating. With `--bq`, also syncs to BigQuery. |
| `fetch [--bq]` | Full discovery (aa-zz search, ~2299 shows), save details + episodes for all. With `--bq`, syncs at end. |
| `refresh` | Quick check for new shows since last full fetch. |
| `watch [--interval-minutes N]` | Continuously discover new shows, refresh the oldest existing batch, and incrementally sync Algolia/BigQuery. Defaults to every 15 minutes. |
| `enrich [--skip] [--limit N]` | TMDB enrich all shows (actors, crew, companies, episode durations). `--skip` skips already enriched. |
| `sync` | Sync all SQLite → BigQuery (checksum-based — only changed/new shows) |
| `bq-verify` | Full verification report: counts, averages, enrichment quality, random sample, storage used |
| `bq-init` | Create BigQuery dataset `spilled_cinema` and table `shows` |
| `bq-stats` | Storage size and row count |
| `search <query>` | FTS search across local SQLite (shows, episodes, actors) |
| `search engine` | **Interactive search engine REPL** — type queries, get live BigQuery results, adjustable limit. Commands: `:q` quit, `:h` help, `:limit N`, `:stats`. |
| `search-bq <query> [--limit N]` | **Live BigQuery search** over the internet — title, alt title, description, genres. ~1s response. |
| `show <slug>` | Print full details for a show |
| `list [limit]` | List all shows in SQLite |
| `stats` | SQLite statistics |

## Typical Workflow

### Initial full scrape (~1-2 hours total)

```bash
cd tools/svetserialu-catalog
node index.js fetch           # discover + detail + episodes (30-60 min)
node index.js enrich           # TMDB actors/crew/ratings (30+ min)
node index.js enrich           # second pass for CSFD ratings + previously errored
node index.js sync             # push to BigQuery (2 sec)
node index.js bq-verify        # check the data
```

### Continuous updates (recommended)

```bash
cd tools/svetserialu-catalog
npm start
```

The watcher prevents overlapping cycles. Tune it with `--interval-minutes N`,
`SVETSERIALU_REFRESH_INTERVAL_MINUTES`, and `SVETSERIALU_REFRESH_BATCH_SIZE`.
Set `SVETSERIALU_SYNC_BIGQUERY=0` to keep BigQuery syncing disabled while still
maintaining SQLite and Algolia.

### One-off update

```bash
node index.js refresh          # add new shows + refresh a bounded stale batch
node index.js enrich --skip    # TMDB enrich only new/missing
node index.js sync             # push changes to BQ
node index.js bq-verify        # verify
```

### Interactive per-show

```bash
node index.js get --bq https://svetserialu.to/serial/nazev-serialu
```

## Cost/Fit

- **BigQuery free tier**: 10 GB storage, 1 TB queries/month
- **Current usage**: ~14 MB for 2299 shows (0.14% of free tier)
- **Projected max**: ~50 MB at full enrichment (still 0.5% of free tier)
- **TMDB API**: free tier allows ~40 requests/10 sec — scraper respects this

## Architecture Notes

1. **SQLite is a local cache**, BigQuery is the primary store. The `sync` command does checksum-based delta detection: queries BigQuery for existing checksums, compares with newly computed SHA256, and only writes changed/new rows.

2. **Shows with zero episodes** (no accordion IDs or empty seasons) are still saved as rows — they just have empty seasons arrays.

3. **Player links are only scraped in `get`**, not in `fetch` (too many HTTP requests). Run `node index.js players <slug>` for a specific show, or write a script to batch-scrape players for popular shows.

4. **HTTP 500 errors** for certain shows/accordions are logged and skipped — the site occasionally returns 500 for deep accordion IDs or malformed show pages.

5. **CSFD ratings** use the `node-csfd-api` package (CSFD.cz blocks direct scraping). Only fetched once per show (skips if already present).

## Data Volume (as of 2026-06-18)

| Metric | Count |
|---|---|
| Shows | 2,299 |
| Episodes | 69,049 |
| Actors (TMDB) | 11,339 |
| Crew (TMDB) | 7,084 |
| Production companies | 2,678 |
| Player links | 33 (only from `get` runs) |
| With IMDB ID | 2,299 (100%) |
| With CSFD ID | 2,294 (99.8%) |
| With TMDB actors | 1,916 (83.3%) |
| Avg episodes/show | 30 |
| Avg actors/show | 4.9 |
| BQ storage | 14.23 MB |
