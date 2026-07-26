import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

function option(name, fallback) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : fallback;
}

const vaultRoot = option("--vault", "");
const baseUrl = option("--base-url", "http://127.0.0.1:5173").replace(/\/$/, "");
const concurrency = Math.max(1, Number(option("--concurrency", "6")) || 6);
const timeoutMs = Math.max(5_000, Number(option("--timeout-ms", "15000")) || 15_000);
const reportPath = option("--report", "");
const perProvider = Math.max(0, Number(option("--per-provider", "0")) || 0);
const providerFilter = option("--provider", "").trim().toLowerCase();
const titleFilter = option("--title", "").trim().toLowerCase();
const episodeFilter = option("--episode", "").trim().toLowerCase();
const episodeFallback = process.argv.includes("--episode-fallback");
const perTitle = Math.max(0, Number(option("--per-title", "0")) || 0);

if (!vaultRoot) {
  throw new Error("Pass --vault with the spilled-library folder path.");
}

const snapshot = JSON.parse(await readFile(path.join(vaultRoot, "library-state.json"), "utf8"));
const libraryState = snapshot.libraryState ?? snapshot;
const shows = Array.isArray(libraryState.shows) ? libraryState.shows : [];
const checks = [];
const providerCounts = new Map();

for (const show of shows) {
  if (
    titleFilter &&
    !String(show.slug ?? "").toLowerCase().includes(titleFilter) &&
    !String(show.title ?? "").toLowerCase().includes(titleFilter)
  ) {
    continue;
  }
  let titleChecks = 0;
  for (const episode of show.episodes ?? []) {
    if (episodeFilter && !String(episode.id ?? "").toLowerCase().includes(episodeFilter)) {
      continue;
    }
    if (episodeFallback) {
      const players = (episode.players ?? []).filter((player) =>
        player?.embedUrl && player.provider !== "local" && player.provider !== "spillsave"
      );
      if (players.length > 0 && (perTitle === 0 || titleChecks < perTitle)) {
        checks.push({ show, episode, player: players[0], players, playerIndex: 0 });
        titleChecks += 1;
      }
      continue;
    }
    for (const [playerIndex, player] of (episode.players ?? []).entries()) {
      if (!player?.embedUrl || player.provider === "local" || player.provider === "spillsave") continue;
      const provider = player.provider ?? "unknown";
      if (providerFilter && provider.toLowerCase() !== providerFilter) continue;
      const providerCount = providerCounts.get(provider) ?? 0;
      if (perProvider > 0 && providerCount >= perProvider) continue;
      providerCounts.set(provider, providerCount + 1);
      checks.push({ show, episode, player, playerIndex });
    }
  }
}

const results = new Array(checks.length);
let cursor = 0;
let completed = 0;
const startedAt = Date.now();

async function checkPlayer(entry, index) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  const started = Date.now();
  try {
    const response = await fetch(`${baseUrl}/api/player/playback-resolve`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        episodeId: entry.episode.id,
        showTitle: entry.episode.showTitle ?? entry.show.title,
        episodeTitle: entry.episode.episodeTitle,
        seasonNumber: entry.episode.seasonNumber,
        episodeNumber: entry.episode.episodeNumber,
        activePlayerAlias: entry.players ? (entry.episode.selectedPlayerAlias ?? entry.players[0].alias) : `audit-${index}`,
        players: entry.players ?? [{ ...entry.player, alias: `audit-${index}` }],
      }),
      signal: controller.signal,
    });
    const payload = await response.json().catch(() => null);
    return {
      ok: response.ok && Boolean(payload?.resolvedUrl),
      title: entry.show.title,
      showSlug: entry.show.slug,
      episodeId: entry.episode.id,
      playerIndex: entry.playerIndex,
      alias: entry.player.alias,
      provider: entry.players ? "episode-fallback" : entry.player.provider ?? "unknown",
      embedUrl: entry.player.embedUrl,
      streamType: payload?.streamType ?? null,
      resolvedUrl: payload?.resolvedUrl ?? null,
      error: response.ok ? null : payload?.error ?? `HTTP ${response.status}`,
      failures: payload?.failures ?? [],
      elapsedMs: Date.now() - started,
    };
  } catch (error) {
    return {
      ok: false,
      title: entry.show.title,
      showSlug: entry.show.slug,
      episodeId: entry.episode.id,
      playerIndex: entry.playerIndex,
      alias: entry.player.alias,
      provider: entry.players ? "episode-fallback" : entry.player.provider ?? "unknown",
      embedUrl: entry.player.embedUrl,
      streamType: null,
      resolvedUrl: null,
      error: error instanceof Error ? error.message : String(error),
      failures: [],
      elapsedMs: Date.now() - started,
    };
  } finally {
    clearTimeout(timeout);
  }
}

async function worker() {
  while (cursor < checks.length) {
    const index = cursor++;
    results[index] = await checkPlayer(checks[index], index);
    completed += 1;
    if (completed % 25 === 0 || completed === checks.length) {
      const passed = results.filter((entry) => entry?.ok).length;
      const elapsedSeconds = Math.round((Date.now() - startedAt) / 1000);
      console.log(`[audit] ${completed}/${checks.length} checked, ${passed} passed, ${completed - passed} failed, ${elapsedSeconds}s elapsed`);
    }
  }
}

console.log(`[audit] Checking ${checks.length} players across ${shows.length} titles with concurrency ${concurrency}.`);
await Promise.all(Array.from({ length: concurrency }, () => worker()));

const providerSummary = Object.values(results.reduce((summary, result) => {
  const current = summary[result.provider] ?? { provider: result.provider, total: 0, passed: 0, failed: 0 };
  current.total += 1;
  if (result.ok) current.passed += 1;
  else current.failed += 1;
  summary[result.provider] = current;
  return summary;
}, {})).sort((left, right) => right.total - left.total);

const titleSummary = shows.map((show) => {
  const titleResults = results.filter((result) => result.showSlug === show.slug);
  return {
    title: show.title,
    slug: show.slug,
    total: titleResults.length,
    passed: titleResults.filter((result) => result.ok).length,
    failed: titleResults.filter((result) => !result.ok).length,
  };
});

const report = {
  generatedAt: new Date().toISOString(),
  vaultRoot,
  baseUrl,
  durationMs: Date.now() - startedAt,
  totals: {
    titles: shows.length,
    players: results.length,
    passed: results.filter((result) => result.ok).length,
    failed: results.filter((result) => !result.ok).length,
  },
  providerSummary,
  titleSummary,
  failures: results.filter((result) => !result.ok),
};

console.log(JSON.stringify({ totals: report.totals, providerSummary, titleSummary }, null, 2));
if (reportPath) {
  await writeFile(reportPath, JSON.stringify(report, null, 2));
  console.log(`[audit] Full report written to ${reportPath}`);
}
