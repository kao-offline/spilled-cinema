import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

function option(name, fallback = "") {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : fallback;
}

function numberOption(name, fallback) {
  const value = Number(option(name, String(fallback)));
  return Number.isFinite(value) ? value : fallback;
}

function percentile(values, fraction) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * fraction) - 1))];
}

function summarize(results) {
  const successful = results.filter((result) => result.ok);
  const timings = successful.map((result) => result.elapsedMs);
  return {
    total: results.length,
    passed: successful.length,
    failed: results.length - successful.length,
    successRate: results.length ? successful.length / results.length : 0,
    p50Ms: percentile(timings, 0.5),
    p90Ms: percentile(timings, 0.9),
    p95Ms: percentile(timings, 0.95),
    p99Ms: percentile(timings, 0.99),
    maxMs: timings.length ? Math.max(...timings) : null,
  };
}

function sanitizeError(error) {
  return String(error instanceof Error ? error.message : error)
    .replace(/([?&](?:token|sig|signature|expires|auth|key)=[^&\s]+)/gi, "$1<redacted>")
    .slice(0, 2_000);
}

async function postJson(url, body, timeoutMs) {
  const startedAt = performance.now();
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
    const payload = await response.json().catch(() => null);
    return {
      ok: response.ok,
      status: response.status,
      payload,
      elapsedMs: Math.round(performance.now() - startedAt),
      responseBytes: Buffer.byteLength(JSON.stringify(payload ?? null)),
      error: response.ok ? null : sanitizeError(payload?.error ?? `HTTP ${response.status}`),
    };
  } catch (error) {
    return {
      ok: false,
      status: 0,
      payload: null,
      elapsedMs: Math.round(performance.now() - startedAt),
      responseBytes: 0,
      error: sanitizeError(error),
    };
  }
}

const live = process.argv.includes("--live");
if (!live) throw new Error("Live provider access is explicit: pass --live.");

const mode = option("--mode", "playback");
let baseUrl = option("--base-url", "http://127.0.0.1:8787").replace(/\/$/, "");
const vaultRoot = option("--vault");
const titleFilter = option("--title").toLowerCase();
const providerFilter = option("--provider").toLowerCase();
const slugOption = option("--slug");
const runs = Math.max(1, numberOption("--runs", 1));
const warmup = Math.max(0, numberOption("--warmup", 0));
const concurrency = Math.max(1, numberOption("--concurrency", 1));
const timeoutMs = Math.max(1_000, numberOption("--timeout-ms", 12_000));
const reportPath = option("--report");
const expectedP50 = numberOption("--assert-p50-ms", 3_000);
const expectedP95 = numberOption("--assert-p95-ms", 10_000);
const expectedSuccessRate = numberOption("--assert-success-rate", 0.99);
const spawnServer = process.argv.includes("--spawn-server");
let spawnedServer = null;
let spawnedRoot = null;

async function startDisposableServer() {
  const port = Math.max(1_024, numberOption("--server-port", 18_788));
  const repositoryRoot = fileURLToPath(new URL("../../../", import.meta.url));
  spawnedRoot = await mkdtemp(join(tmpdir(), "spilled-resolver-audit-"));
  const privateConfigPath = join(spawnedRoot, "spilled.private.json");
  await writeFile(privateConfigPath, JSON.stringify({ privateNode: { enabled: false } }), "utf8");
  spawnedServer = spawn(process.execPath, [join(repositoryRoot, "apps/server/dist/standalone.mjs")], {
    cwd: repositoryRoot,
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"],
    env: {
      ...process.env,
      NODE_ENV: "production",
      HOST: "127.0.0.1",
      PORT: String(port),
      SPILLED_NODE_MODE: "local",
      SPILLED_DISABLE_AUTO_TUNNEL: "1",
      SPILLED_DISABLE_PRIVATE_SETUP: "1",
      SPILLED_OPEN_SETUP_BROWSER: "0",
      SPILLED_PRIVATE_CONFIG: privateConfigPath,
      SPILLED_CONTROL_PLANE_URL: "http://127.0.0.1:9/server",
      SPILLED_GATEWAY_URL: "ws://127.0.0.1:9",
      SPILLED_NODE_DATABASE: join(spawnedRoot, "node.db"),
      SPILLED_SECRET_RECORDS_FILE: join(spawnedRoot, "secrets.json"),
      SPILLED_VAULT_PATH: join(spawnedRoot, "vault"),
      SPILLED_PUBLIC_TEMP_PATH: join(spawnedRoot, "temp"),
    },
  });
  let output = "";
  spawnedServer.stdout.on("data", (chunk) => { output += chunk.toString(); });
  spawnedServer.stderr.on("data", (chunk) => { output += chunk.toString(); });
  baseUrl = `http://127.0.0.1:${port}`;
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try {
      const response = await fetch(`${baseUrl}/api/status`, { signal: AbortSignal.timeout(500) });
      if (response.ok) return;
    } catch {
      // Wait for the compiled node to bind.
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Disposable resolver node did not become ready. ${output.slice(-2_000)}`);
}

async function stopDisposableServer() {
  if (spawnedServer && spawnedServer.exitCode === null) {
    const exited = once(spawnedServer, "exit");
    spawnedServer.kill("SIGTERM");
    await Promise.race([
      exited,
      new Promise((resolve) => setTimeout(resolve, 3_000)),
    ]);
  }
  if (spawnedRoot) {
    for (let attempt = 0; attempt < 10; attempt += 1) {
      try {
        await rm(spawnedRoot, { recursive: true, force: true });
        break;
      } catch (error) {
        if (error?.code !== "EBUSY" || attempt === 9) throw error;
        await new Promise((resolve) => setTimeout(resolve, 100 * (attempt + 1)));
      }
    }
  }
}

if (spawnServer) await startDisposableServer();
process.once("exit", () => {
  if (spawnedServer && spawnedServer.exitCode === null) spawnedServer.kill("SIGTERM");
});

let libraryState = { shows: [] };
if (vaultRoot) {
  const snapshot = JSON.parse(await readFile(join(vaultRoot, "library-state.json"), "utf8"));
  libraryState = snapshot.libraryState ?? snapshot;
}

const scenarios = [];
if (mode === "playback" || mode === "all") {
  if (!vaultRoot) throw new Error("Playback mode requires --vault with a spilled-library folder.");
  for (const show of libraryState.shows ?? []) {
    if (titleFilter && !`${show.title} ${show.slug}`.toLowerCase().includes(titleFilter)) continue;
    for (const episode of show.episodes ?? []) {
      const players = (episode.players ?? []).filter((player) =>
        player?.embedUrl && player.provider !== "local" && player.provider !== "spillsave" &&
        (!providerFilter || String(player.provider).toLowerCase() === providerFilter));
      if (players.length === 0) continue;
      scenarios.push({ kind: "playback", show, episode, players });
    }
  }
}

if (mode === "import" || mode === "all") {
  const slugs = slugOption
    ? slugOption.split(",").map((entry) => entry.trim()).filter(Boolean)
    : (libraryState.shows ?? [])
      .filter((show) => !titleFilter || `${show.title} ${show.slug}`.toLowerCase().includes(titleFilter))
      .map((show) => show.slug)
      .filter(Boolean);
  if (slugs.length === 0) throw new Error("Import mode requires --slug or a matching --vault/--title.");
  for (const slug of slugs) scenarios.push({ kind: "import", slug });
}

if (scenarios.length === 0) throw new Error("No live resolver scenarios matched the supplied filters.");

const username = process.env.SPILLED_TEST_SVETSERIALU_USERNAME;
const password = process.env.SPILLED_TEST_SVETSERIALU_PASSWORD;
const results = [];
let cursor = 0;

async function executeScenario(scenario, measuredRun) {
  if (scenario.kind === "import") {
    const result = await postJson(`${baseUrl}/api/provider-import`, {
      moduleId: "svetserialu",
      slug: scenario.slug,
      mediaType: "serial",
      resolverDiagnostics: true,
      resolverBenchmark: true,
      ...(username && password ? { svetserialuCredentials: { username, password } } : {}),
    }, timeoutMs);
    const show = result.payload?.show;
    const episodes = Array.isArray(show?.episodes) ? show.episodes : [];
    const players = episodes.flatMap((episode) => episode.players ?? []);
    const externalPlayers = players.filter((player) => {
      try { return !new URL(player.embedUrl).pathname.includes("/sources/"); } catch { return false; }
    });
    return {
      ...result,
      measuredRun,
      kind: "import",
      slug: scenario.slug,
      episodeCount: episodes.length,
      playerCount: players.length,
      externalPlayerCount: externalPlayers.length,
      diagnostics: result.payload?.resolverDiagnostics ?? null,
      payload: undefined,
      ok: result.ok && episodes.length > 0 && players.length > 0 && externalPlayers.length === players.length,
    };
  }

  const { show, episode, players } = scenario;
  const result = await postJson(`${baseUrl}/api/player/playback-resolve`, {
    episodeId: episode.id,
    showTitle: episode.showTitle ?? show.title,
    episodeTitle: episode.episodeTitle,
    seasonNumber: episode.seasonNumber,
    episodeNumber: episode.episodeNumber,
    activePlayerAlias: episode.selectedPlayerAlias ?? players[0].alias,
    players,
    resolverDiagnostics: true,
  }, timeoutMs);
  return {
    ...result,
    measuredRun,
    kind: "playback",
    title: show.title,
    showSlug: show.slug,
    episodeId: episode.id,
    provider: result.payload?.playerAlias
      ? players.find((player) => player.alias === result.payload.playerAlias)?.provider ?? "unknown"
      : players[0]?.provider ?? "unknown",
    streamType: result.payload?.streamType ?? null,
    diagnostics: result.payload?.resolverDiagnostics ?? null,
    payload: undefined,
    ok: result.ok && typeof result.payload?.resolvedUrl === "string",
  };
}

const scheduled = [];
for (let run = -warmup; run < runs; run += 1) {
  for (const scenario of scenarios) scheduled.push({ scenario, measuredRun: run >= 0 ? run : null });
}

async function worker() {
  while (cursor < scheduled.length) {
    const index = cursor++;
    const { scenario, measuredRun } = scheduled[index];
    const result = await executeScenario(scenario, measuredRun);
    if (measuredRun !== null) results.push(result);
    const label = scenario.kind === "import" ? scenario.slug : scenario.episode.id;
    console.log(`[resolver-audit] ${index + 1}/${scheduled.length} ${scenario.kind} ${label}: ${result.ok ? "ok" : "failed"} ${result.elapsedMs}ms`);
  }
}

const startedAt = new Date();
await Promise.all(Array.from({ length: Math.min(concurrency, scheduled.length) }, () => worker()));

const summary = summarize(results);
const report = {
  generatedAt: new Date().toISOString(),
  startedAt: startedAt.toISOString(),
  gitCommit: process.env.GIT_COMMIT ?? null,
  node: process.version,
  platform: `${process.platform}-${process.arch}`,
  configuration: { mode, baseUrl, runs, warmup, concurrency, timeoutMs, titleFilter, providerFilter },
  targets: { p50Ms: expectedP50, p95Ms: expectedP95, successRate: expectedSuccessRate },
  summary,
  results,
};

console.log(JSON.stringify({ summary, targets: report.targets }, null, 2));
if (reportPath) {
  const normalizedPath = reportPath.endsWith(".json") ? reportPath : `${reportPath}.json`;
  await mkdir(dirname(normalizedPath), { recursive: true });
  await writeFile(normalizedPath, JSON.stringify(report, null, 2));
  await writeFile(normalizedPath.replace(/\.json$/i, ".jsonl"), results.map((entry) => JSON.stringify(entry)).join("\n") + "\n");
  console.log(`[resolver-audit] report written to ${normalizedPath}`);
}

const passed = summary.total > 0 && summary.successRate >= expectedSuccessRate &&
  summary.p50Ms !== null && summary.p50Ms <= expectedP50 &&
  summary.p95Ms !== null && summary.p95Ms <= expectedP95;
if (!passed) process.exitCode = 1;
await stopDisposableServer();
