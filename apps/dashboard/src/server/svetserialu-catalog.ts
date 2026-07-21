import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { ExploreItem } from "../lib/types";
import { compareSearchScores, normalizeSearchText, scoreSearchCandidate } from "../lib/search-ranking";

type CatalogShowRow = {
  slug: string;
  title: string;
  alt_title?: string | null;
  description?: string | null;
  year?: string | null;
  poster_url?: string | null;
  genres?: string[] | string | null;
  audio_buckets?: string[] | string | null;
  languages?: string[] | string | null;
  network?: string | null;
  imdb_rating?: number | null;
  csfd_rating?: string | number | null;
  rank?: number;
};

type SvetSerialuCatalogDb = {
  searchShows: (query: string, limit?: number) => CatalogShowRow[];
  getAllSlugs?: () => string[];
};

const require = createRequire(import.meta.url);
const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "../../../..");
const catalogDbModulePath = join(repoRoot, "tools/svetserialu-catalog/db.js");
const catalogDbPath = join(repoRoot, "tools/svetserialu-catalog/data/catalog.db");
const catalogPackagePath = join(repoRoot, "tools/svetserialu-catalog/package.json");
const catalogEnvPath = join(repoRoot, "tools/svetserialu-catalog/.env");
const bqRequire = createRequire(catalogPackagePath);
const BQ_TABLE = "`spilledcinema.spilled_cinema.shows`";

let catalogDb: SvetSerialuCatalogDb | null | undefined;
let bqRowsPromise: Promise<CatalogShowRow[]> | null = null;

function parseStringArray(value: string[] | string | null | undefined) {
  if (Array.isArray(value)) {
    return value.filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0);
  }
  if (!value) {
    return [];
  }
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed)
      ? parsed.filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0)
      : [];
  } catch {
    return [];
  }
}

function getCatalogDb() {
  if (catalogDb !== undefined) {
    return catalogDb;
  }
  if (!existsSync(catalogDbModulePath) || !existsSync(catalogDbPath)) {
    catalogDb = null;
    return catalogDb;
  }

  try {
    catalogDb = require(catalogDbModulePath) as SvetSerialuCatalogDb;
  } catch (error) {
    console.warn("[svetserialu-catalog] unavailable", error instanceof Error ? error.message : String(error));
    catalogDb = null;
  }
  return catalogDb;
}

function loadCatalogEnv() {
  if (!existsSync(catalogEnvPath)) {
    return;
  }
  try {
    const env = readFileSync(catalogEnvPath, "utf8");
    for (const line of env.split(/\r?\n/)) {
      const match = line.match(/^\s*([A-Za-z0-9_]+)=(.*)$/);
      if (!match || process.env[match[1]]) {
        continue;
      }
      process.env[match[1]] = match[2].trim().replace(/^["']|["']$/g, "");
    }
  } catch {
    // BigQuery remains optional; SQLite is the fast local path.
  }
}

async function loadBigQueryRows(): Promise<CatalogShowRow[]> {
  if (bqRowsPromise) {
    return bqRowsPromise;
  }

  bqRowsPromise = (async () => {
    loadCatalogEnv();
    if (!process.env.GCP_PROJECT_ID) {
      return [];
    }
    try {
      const { BigQuery } = bqRequire("@google-cloud/bigquery") as {
        BigQuery: new (options: { projectId?: string }) => {
          query: (options: { query: string }) => Promise<[unknown[]]>;
        };
      };
      const bigquery = new BigQuery({ projectId: process.env.GCP_PROJECT_ID });
      const [rows] = await bigquery.query({
        query: `
          SELECT
            slug, title, alt_title, description, year, poster_url,
            genres, languages, audio_buckets, network, imdb_rating, csfd_rating
          FROM ${BQ_TABLE}
        `,
      });
      return rows as CatalogShowRow[];
    } catch (error) {
      console.warn("[svetserialu-catalog] BigQuery preload failed", error instanceof Error ? error.message : String(error));
      return [];
    }
  })();

  return bqRowsPromise;
}

if (!existsSync(catalogDbPath)) {
  void loadBigQueryRows();
}

function ratingBoost(row: CatalogShowRow) {
  const imdb = typeof row.imdb_rating === "number" ? row.imdb_rating : 0;
  const csfd = typeof row.csfd_rating === "number" ? row.csfd_rating : Number.parseFloat(String(row.csfd_rating ?? ""));
  return Math.round(Math.max(0, imdb) * 20 + (Number.isFinite(csfd) ? csfd : 0));
}

function exactTitleBoost(query: string, row: CatalogShowRow) {
  const normalizedQuery = normalizeSearchText(query);
  return [row.title, row.alt_title, row.slug.replace(/-/g, " ")]
      .some((value) => normalizeSearchText(String(value ?? "")) === normalizedQuery)
    ? 5000
    : 0;
}

function catalogShowToExploreItem(query: string, row: CatalogShowRow, index: number): ExploreItem {
  const genres = parseStringArray(row.genres);
  const languages = parseStringArray(row.languages);
  const audioBuckets = parseStringArray(row.audio_buckets);
  const matchScore = scoreSearchCandidate(query, [
    row.title,
    row.alt_title,
    row.slug.replace(/-/g, " "),
    row.year,
    row.network,
    ...genres,
  ], index) + ratingBoost(row) + exactTitleBoost(query, row);

  return {
    id: `svetserialu:catalog:${row.slug}`,
    title: row.title,
    slug: row.slug,
    importSlug: row.slug,
    provider: "svetserialu",
    mediaType: "serial",
    detailUrl: `https://svetserialu.to/serial/${row.slug}`,
    posterUrl: row.poster_url ?? null,
    backdropUrl: null,
    year: row.year ?? null,
    yearLabel: row.year ?? null,
    alternateTitles: [row.alt_title].filter((title): title is string => Boolean(title && title !== row.title)),
    description: row.description ?? null,
    genres,
    audioBuckets: audioBuckets.length > 0 ? audioBuckets as ExploreItem["audioBuckets"] : ["all"],
    languages,
    network: row.network ?? null,
    directors: [],
    actors: [],
    sectionKeys: [],
    inVault: false,
    availableNow: true,
    matchScore,
    recommendationReasons: [],
  };
}

export function isSvetSerialuCatalogAvailable() {
  return Boolean(getCatalogDb());
}

function searchRows(query: string, rows: CatalogShowRow[], limit: number) {
  return rows
    .map((row, index) => catalogShowToExploreItem(query, row, index))
    .filter((item) => (item.matchScore ?? 0) > 0)
    .sort(compareSearchScores)
    .slice(0, limit);
}

export async function searchSvetSerialuCatalog(query: string, limit = 12): Promise<ExploreItem[]> {
  const normalized = query.trim();
  const db = getCatalogDb();
  if (normalized.length < 2) {
    return [];
  }

  if (db) {
    try {
      const sqliteResults = searchRows(normalized, db.searchShows(normalized, Math.max(limit * 2, 20)), limit);
      if (sqliteResults.length > 0) {
        return sqliteResults;
      }
    } catch (error) {
      console.warn("[svetserialu-catalog] SQLite search failed", error instanceof Error ? error.message : String(error));
    }
  }

  return searchRows(normalized, await loadBigQueryRows(), limit);
}
