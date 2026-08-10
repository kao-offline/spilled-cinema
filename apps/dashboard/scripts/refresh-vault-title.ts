import { copyFile, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { mergeImportedShowIntoState } from "../src/lib/storage";
import type { ImportedShow, LibraryState } from "../src/lib/types";

function option(name: string, fallback = "") {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] ?? fallback : fallback;
}

const vaultRoot = option("--vault");
const moduleId = option("--module");
const slug = option("--slug");
const targetSlug = option("--target", slug);
const baseUrl = option("--base-url", "http://127.0.0.1:8787").replace(/\/$/, "");

if (!vaultRoot || !moduleId || !slug) {
  throw new Error("Pass --vault, --module, and --slug.");
}

const snapshotPath = path.join(vaultRoot, "library-state.json");
const backupPath = path.join(vaultRoot, "library-state.pre-title-refresh.bak.json");
const rawText = await readFile(snapshotPath, "utf8");
const snapshot = JSON.parse(rawText) as {
  libraryState?: LibraryState;
  updatedAt?: number;
  [key: string]: unknown;
};
const libraryState = snapshot.libraryState ?? snapshot as unknown as LibraryState;
const existing = libraryState.shows.find((show) => show.slug === targetSlug);

if (!existing) {
  throw new Error(`Target title "${targetSlug}" is not in the vault.`);
}

const response = await fetch(`${baseUrl}/api/provider-import`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({
    moduleId,
    slug,
    mediaType: existing.mediaType ?? "serial",
    repositoryUrls: [],
  }),
});
const payload = await response.json().catch(() => null) as { show?: ImportedShow; error?: string } | null;
if (!response.ok || !payload?.show) {
  throw new Error(payload?.error ?? `Provider import failed with HTTP ${response.status}.`);
}

const merged = mergeImportedShowIntoState(libraryState, payload.show, targetSlug);
const updated = merged.shows.find((show) => show.slug === targetSlug);
if (!updated) {
  throw new Error(`Merged title "${targetSlug}" disappeared from the library.`);
}

await copyFile(snapshotPath, backupPath);
const updatedAt = Date.now();
const nextSnapshot = snapshot.libraryState
  ? { ...snapshot, updatedAt, libraryState: merged }
  : merged;
await writeFile(snapshotPath, `${JSON.stringify(nextSnapshot, null, 2)}\n`, "utf8");

console.log(JSON.stringify({
  title: updated.title,
  slug: updated.slug,
  before: {
    seasons: existing.availableSeasons,
    episodes: existing.episodes.length,
  },
  after: {
    seasons: updated.availableSeasons,
    episodes: updated.episodes.length,
  },
  backupPath,
}, null, 2));
