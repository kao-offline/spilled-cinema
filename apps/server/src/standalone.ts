import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { createServer as createNetServer, type Server as NetServer } from "node:net";
import { Readable } from "node:stream";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { execFile, spawn, type ChildProcess } from "node:child_process";
import { createRequire } from "node:module";
import { hostname } from "node:os";
import { createHttpHandlers, type JsonResponse, type RequestLike } from "./http-handlers";
import { ControlPlaneReporter, readControlPlaneReporterOptionsFromEnv } from "./control-plane";
import { readRelayMeshOptionsFromEnv, SecureRelayMesh } from "./mesh";
import { setNodeEndpointUrl } from "../../../packages/node-client/src/index";
import { getPrivateNodeConfigPathFromEnv, isPrivateSetupBootstrapEnabled, loadPrivateNodeConfigFromEnv, readNodeModeFromEnv } from "../../node/src/private-config";
import { ManagedGatewayLink } from "./gateway-link";
import { createV2RpcExecutor } from "./v2-rpc";
import { NodeBackupManager } from "../../node/src/backups";
import { SqliteNodeStorage } from "../../../packages/storage/src";
import { V2_CAPABILITIES, type Capability } from "../../../packages/node-protocol/src";
import { TransientDownloadScheduler } from "../../node/src/transient-downloads";
import { tmpdir } from "node:os";
import { AdaptiveResourceGovernor } from "../../node/src/resource-governor";
import { RelayOnlyBulkTransferManager } from "./bulk-webrtc";
import { renderSetupWizard } from "./setup-wizard";

type RouteHandler = (req: RequestLike, res: JsonResponse) => void | Promise<void>;

function loadRootEnvLocal() {
  let searchDir = process.cwd();
  let envPath = "";
  for (let index = 0; index < 6; index += 1) {
    const candidate = resolve(searchDir, ".env.local");
    if (existsSync(candidate)) {
      envPath = candidate;
      break;
    }
    const parent = dirname(searchDir);
    if (parent === searchDir) {
      break;
    }
    searchDir = parent;
  }
  if (!envPath) {
    return;
  }

  try {
    const content = readFileSync(envPath, "utf8");
    for (const line of content.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#") || !trimmed.includes("=")) {
        continue;
      }
      const [key, ...rest] = trimmed.split("=");
      if (!key || process.env[key] !== undefined) {
        continue;
      }
      process.env[key] = rest.join("=").trim().replace(/^["']|["']$/g, "");
    }
  } catch {
    // Running without a repo .env.local is supported.
  }
}

loadRootEnvLocal();

function applyHeadlessWindowsDefaults() {
  if (process.platform !== "win32") return;
  const localData = process.env.LOCALAPPDATA || process.env.APPDATA;
  if (!localData) return;
  const root = resolve(localData, "SpilledCinema", "Server");
  const data = resolve(root, "data");
  const vault = resolve(root, "vault");
  const temporary = resolve(root, "temp");
  for (const path of [root, data, vault, temporary]) {
    mkdirSync(path, { recursive: true });
  }
  process.env.SPILLED_NODE_DATABASE ||= resolve(data, "node.db");
  process.env.SPILLED_SECRET_RECORDS_FILE ||= resolve(data, "secrets.json");
  process.env.SPILLED_PRIVATE_CONFIG ||= resolve(data, "spilled.private.json");
  process.env.SPILLED_VAULT_PATH ||= vault;
  process.env.SPILLED_PUBLIC_TEMP_PATH ||= temporary;
  process.env.SPILLED_OPEN_SETUP_BROWSER ||= "1";
}

applyHeadlessWindowsDefaults();

const handlers = createHttpHandlers();
const requestedNodeMode = readNodeModeFromEnv();
const privateConfig = loadPrivateNodeConfigFromEnv(requestedNodeMode);
const nodeMode = privateConfig && !process.env.SPILLED_NODE_MODE ? "full" : requestedNodeMode;
const privateSetupEnabled = (isPrivateSetupBootstrapEnabled() || process.env.SPILLED_DISABLE_PRIVATE_SETUP !== "1") && !privateConfig;
const port = Number.parseInt(process.env.PORT || "8787", 10);
const host = process.env.HOST || "127.0.0.1";
handlers.runtime.configure({
  mode: nodeMode,
  privateConfig,
  privateSetupEnabled,
  privateConfigPath: getPrivateNodeConfigPathFromEnv(),
  v2PublicCapabilities: process.env.SPILLED_PUBLIC_CAPABILITIES === undefined ? undefined : new Set(
    process.env.SPILLED_PUBLIC_CAPABILITIES
      .split(",")
      .map((entry) => entry.trim())
      .filter((entry): entry is Capability => V2_CAPABILITIES.includes(entry as Capability)),
  ),
  passkeyOrigin: process.env.SPILLED_PASSKEY_ORIGIN?.trim(),
});
const mesh = new SecureRelayMesh(handlers.runtime, readRelayMeshOptionsFromEnv());
const controlPlaneOptions = readControlPlaneReporterOptionsFromEnv();
const controlPlane = controlPlaneOptions ? new ControlPlaneReporter(handlers.runtime, controlPlaneOptions) : null;
const managedGatewayEnabled = process.env.SPILLED_DISABLE_MANAGED_GATEWAY !== "1";
const controlPlaneUrl = (
  process.env.SPILLED_CONTROL_PLANE_URL?.trim() ||
  (managedGatewayEnabled ? "https://cheerful-lynx-4.convex.site/server" : "")
).replace(/\/$/, "");
const gatewayUrl = process.env.SPILLED_GATEWAY_URL?.trim() ||
  (managedGatewayEnabled ? "https://spilled-node-gateway.4thsj85ywn.workers.dev" : "");
const gatewayJwksUrl = process.env.SPILLED_CONTROL_PLANE_JWKS_URL?.trim() ||
  (controlPlaneUrl ? `${controlPlaneUrl}/v2/jwks` : "");
const publicTempRoot = resolve(process.env.SPILLED_PUBLIC_TEMP_PATH || tmpdir(), "spilled-public-jobs");
const resourceGovernor = new AdaptiveResourceGovernor(publicTempRoot);
const transientDownloads = new TransientDownloadScheduler(
  publicTempRoot,
  2,
  async () => await resourceGovernor.decision("bulk"),
);
const bulkTransfers = new RelayOnlyBulkTransferManager(
  async () => await resourceGovernor.decision("bulk"),
);
let gatewayLink: ManagedGatewayLink | null = null;
let gatewayEnrollmentTimer: NodeJS.Timeout | null = null;
let refreshManagedGatewayApplication: (() => Promise<void>) | null = null;
const backupManager = handlers.runtime.storage instanceof SqliteNodeStorage && process.env.SPILLED_NODE_DATABASE
  ? new NodeBackupManager(handlers.runtime.storage, resolve(process.env.SPILLED_NODE_DATABASE))
  : null;
let publicTunnel: { url: string; close: () => void } | null = null;
let publicTunnelMonitor: NodeJS.Timeout | null = null;
let restartingPublicTunnel: Promise<void> | null = null;
let publicTunnelFailureCount = 0;

const PUBLIC_TUNNEL_HEALTH_FAILURE_LIMIT = Number.parseInt(process.env.SPILLED_PUBLIC_TUNNEL_HEALTH_FAILURE_LIMIT || "3", 10);
const PUBLIC_TUNNEL_START_TIMEOUT_MS = Number.parseInt(process.env.SPILLED_PUBLIC_TUNNEL_START_TIMEOUT_MS || "15000", 10);
let nativePipeServer: NetServer | null = null;

const routes: Array<{ path: string; handler: RouteHandler }> = [
  { path: "/api/status", handler: handlers.statusHandler },
  { path: "/api/tmdb-to-imdb", handler: handlers.tmdbToImdbHandler },
  { path: "/api/tmdb-search", handler: handlers.tmdbSearchHandler },
  { path: "/api/server", handler: handlers.controlPlaneProxyHandler },
  { path: "/api/import-svetserialu", handler: handlers.importSvetSerialuHandler },
  { path: "/api/svetserialu/auth/verify", handler: handlers.svetSerialuAuthVerifyHandler },
  { path: "/api/import-bombuj", handler: handlers.importBombujHandler },
  { path: "/api/search", handler: handlers.searchHandler },
  { path: "/api/vidking/availability", handler: handlers.vidkingAvailabilityHandler },
  { path: "/api/provider-modules", handler: handlers.providerModulesHandler },
  { path: "/api/provider-feed", handler: handlers.providerFeedHandler },
  { path: "/api/provider-search", handler: handlers.providerSearchHandler },
  { path: "/api/provider-import", handler: handlers.providerImportHandler },
  { path: "/api/integrations/catalog", handler: handlers.integrationsCatalogHandler },
  { path: "/api/integrations/refresh", handler: handlers.integrationsRefreshHandler },
  { path: "/api/integrations/config", handler: handlers.integrationsConfigHandler },
  { path: "/api/title/search", handler: handlers.titleSearchHandler },
  { path: "/api/title/resolve", handler: handlers.titleResolveHandler },
  { path: "/api/title/import", handler: handlers.titleImportHandler },
  { path: "/api/explore/feed", handler: handlers.exploreFeedHandler },
  { path: "/api/explore/people", handler: handlers.explorePeopleHandler },
  { path: "/api/trending/feed", handler: handlers.trendingFeedHandler },
  { path: "/api/artwork/refresh", handler: handlers.refreshArtworkHandler },
  { path: "/api/artwork/search", handler: handlers.searchArtworkHandler },
  { path: "/api/artwork/title-metadata", handler: handlers.titleMetadataArtworkHandler },
  { path: "/api/artwork/episode-previews", handler: handlers.episodePreviewsArtworkHandler },
  { path: "/api/artwork/cast", handler: handlers.castArtworkHandler },
  { path: "/api/artwork/person-credits", handler: handlers.personCreditsArtworkHandler },
  { path: "/api/download-full/start", handler: handlers.startDownloadHandler },
  { path: "/api/download-full/browser-start", handler: handlers.browserStartHandler },
  { path: "/api/player/resolve", handler: handlers.playerResolveHandler },
  { path: "/api/player/frame", handler: handlers.playerFrameHandler },
  { path: "/api/player/clean-resolve", handler: handlers.cleanPlayerResolveHandler },
  { path: "/api/player/playback-resolve", handler: handlers.playbackResolveHandler },
  { path: "/cdn-cgi/rum", handler: handlers.quietBeaconHandler },
  { path: "/_next/static", handler: handlers.cinebyAssetHandler },
  { path: "/scripts", handler: handlers.cinebyAssetHandler },
  { path: "/api/cineby-api", handler: handlers.cinebyApiHandler },
  { path: "/api/download-full/browser-file", handler: handlers.browserFileHandler },
  { path: "/api/download-full/status", handler: handlers.downloadStatusHandler },
  { path: "/api/download-full/check", handler: handlers.downloadCheckHandler },
  { path: "/api/download-full/list", handler: handlers.downloadListHandler },
  { path: "/api/download-full/delete", handler: handlers.deleteDownloadHandler },
  { path: "/api/download-full/cancel", handler: handlers.cancelDownloadHandler },
  { path: "/api/download-full/file", handler: handlers.downloadFileHandler },
  { path: "/api/download-full/subtitles", handler: handlers.subtitleListHandler },
  { path: "/api/download-full/subtitle-file", handler: handlers.subtitleFileHandler },
  { path: "/api/subtitle-proxy", handler: handlers.subtitleProxyHandler },
  { path: "/api/node/auth/anonymous", handler: handlers.anonymousGrantHandler },
  { path: "/api/node/setup/status", handler: handlers.privateSetupStatusHandler },
  { path: "/api/node/setup/complete", handler: handlers.privateSetupCompleteHandler },
  { path: "/api/node/local-credentials", handler: handlers.localCredentialRecoveryHandler },
  { path: "/api/node/admin/auth/login", handler: handlers.adminAuthHandler },
  { path: "/api/node/admin/auth/logout", handler: handlers.adminAuthHandler },
  { path: "/api/node/admin/auth/me", handler: handlers.adminAuthHandler },
  { path: "/api/node/admin/status", handler: handlers.adminStatusHandler },
  { path: "/api/node/admin/settings/capabilities", handler: handlers.adminCapabilitiesHandler },
  { path: "/api/node/admin/accounts/watchers", handler: handlers.adminWatchersHandler },
  { path: "/api/node/watcher/auth/login", handler: handlers.watcherAuthHandler },
  { path: "/api/node/watcher/auth/logout", handler: handlers.watcherAuthHandler },
  { path: "/api/node/watcher/auth/me", handler: handlers.watcherAuthHandler },
  { path: "/api/node/auth/accounts", handler: handlers.privateAccountsHandler },
  { path: "/api/node/auth/me", handler: handlers.privateMeHandler },
  { path: "/api/node/auth/logout", handler: handlers.privateMeHandler },
  { path: "/api/node/auth/passkey/register-options", handler: handlers.passkeyRegisterOptionsHandler },
  { path: "/api/node/auth/passkey/register-verify", handler: handlers.passkeyRegisterVerifyHandler },
  { path: "/api/node/auth/passkey/login-options", handler: handlers.passkeyLoginOptionsHandler },
  { path: "/api/node/auth/passkey/login-verify", handler: handlers.passkeyLoginVerifyHandler },
  { path: "/api/node/auth/oidc/providers", handler: handlers.oidcProvidersHandler },
  { path: "/api/node/auth/oidc/start", handler: handlers.oidcStartHandler },
  { path: "/api/node/auth/oidc/callback", handler: handlers.oidcFinishHandler },
  { path: "/api/node/auth/oidc/finish", handler: handlers.oidcFinishHandler },
  { path: "/api/node/auth/private", handler: handlers.privateSessionHandler },
  { path: "/api/node/private/profiles", handler: handlers.privateProfilesHandler },
  { path: "/api/node/private/profile/select", handler: handlers.privateProfileSelectHandler },
  { path: "/api/node/private/library", handler: handlers.privateLibraryHandler },
  { path: "/api/node/private/storage", handler: handlers.privateStorageHandler },
  { path: "/api/node/private/downloads", handler: handlers.privateDownloadsHandler },
  { path: "/api/node/private/downloads/file", handler: handlers.privateDownloadFileHandler },
  { path: "/api/node/pairing/start", handler: handlers.pairingStartHandler },
  { path: "/api/node/pairing/approve", handler: handlers.pairingApproveHandler },
  { path: "/api/node/passkey/register-options", handler: handlers.passkeyRegistrationHandler },
  { path: "/api/node/passkey/authenticate-options", handler: handlers.passkeyAuthenticationHandler },
  { path: "/api/node/spillshare/find", handler: handlers.spillshareLookupHandler },
  { path: "/api/node/mesh/announce", handler: handlers.meshAnnounceHandler },
  { path: "/api/node/mesh/snapshot", handler: handlers.meshSnapshotHandler },
  { path: "/api/node/mesh/nodes", handler: handlers.meshNodesHandler },
];

const DEFAULT_DASHBOARD_ORIGINS = [
  "http://localhost:5173",
  "http://127.0.0.1:5173",
  "http://localhost:4173",
  "http://127.0.0.1:4173",
  "https://spilled.overload.studio",
];

function configuredDashboardOrigins() {
  return new Set(
    (process.env.CORS_ORIGIN?.split(",") ?? [
      ...DEFAULT_DASHBOARD_ORIGINS,
      `http://127.0.0.1:${port}`,
      `http://localhost:${port}`,
    ])
      .map((origin) => origin.trim().replace(/\/$/, ""))
      .filter(Boolean),
  );
}

function applyCors(req: IncomingMessage, res: ServerResponse) {
  const origin = req.headers.origin?.replace(/\/$/, "");
  if (!origin) {
    return true;
  }
  if (origin === "null" || !configuredDashboardOrigins().has(origin)) {
    return false;
  }
  res.setHeader("Vary", "Origin");
  res.setHeader("Access-Control-Allow-Origin", origin);
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,HEAD,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Spilled-Node, bypass-tunnel-reminder, Range, If-None-Match, If-Modified-Since");
  res.setHeader("Access-Control-Expose-Headers", "Content-Length, Content-Range, Accept-Ranges, Content-Disposition, Content-Type");
  res.setHeader("Access-Control-Allow-Private-Network", "true");
  return true;
}

function applyPermissiveCors(req: IncomingMessage, res: ServerResponse) {
  const origin = req.headers.origin?.replace(/\/$/, "");
  res.setHeader("Vary", "Origin");
  res.setHeader("Access-Control-Allow-Origin", origin || "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,HEAD,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Spilled-Node, bypass-tunnel-reminder, Range, If-None-Match, If-Modified-Since");
  res.setHeader("Access-Control-Expose-Headers", "Content-Length, Content-Range, Accept-Ranges, Content-Disposition, Content-Type");
  res.setHeader("Access-Control-Allow-Private-Network", "true");
}

function notFound(res: ServerResponse) {
  res.statusCode = 404;
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify({ error: "Not found." }));
}

function findHandler(url = "") {
  const pathname = url.split("?")[0] || "/";
  return routes.find((route) => route.path === pathname || (
    (route.path === "/_next/static" || route.path === "/scripts" || route.path === "/api/cineby-api") && pathname.startsWith(`${route.path}/`)
  ))?.handler;
}

async function invokeNativeRoute(message: {
  version?: number;
  requestId?: string;
  path?: string;
  method?: string;
  body?: unknown;
}) {
  if (message.version !== 2 || !message.requestId || !message.path?.startsWith("/")) {
    throw new Error("Invalid native RPC envelope.");
  }
  const handler = findHandler(message.path);
  if (!handler) throw new Error("Native RPC route was not found.");
  const body = message.body === undefined ? "" : JSON.stringify(message.body);
  const request = Readable.from(body ? [Buffer.from(body)] : []) as RequestLike;
  request.method = message.method ?? "GET";
  request.url = message.path;
  request.headers = { "content-type": "application/json", origin: "spilled-native://desktop" };
  return await new Promise<{ status: number; data: unknown }>((resolvePromise, rejectPromise) => {
    const response: JsonResponse = {
      statusCode: 200,
      setHeader: () => undefined,
      end: (chunk) => {
        try {
          const data = chunk ? JSON.parse(chunk) : null;
          resolvePromise({ status: response.statusCode, data });
        } catch (error) {
          rejectPromise(error);
        }
      },
    };
    Promise.resolve(handler(request, response)).catch(rejectPromise);
  });
}

function startNativePipe() {
  const pipePath = process.env.SPILLED_NATIVE_PIPE?.trim();
  if (!pipePath || process.platform !== "win32") return;
  nativePipeServer = createNetServer((socket) => {
    let buffered = "";
    socket.setEncoding("utf8");
    socket.on("data", (chunk) => {
      buffered += chunk;
      if (Buffer.byteLength(buffered) > 1024 * 1024) {
        socket.destroy(new Error("Native RPC frame is too large."));
        return;
      }
      const newline = buffered.indexOf("\n");
      if (newline < 0) return;
      const line = buffered.slice(0, newline);
      buffered = "";
      void Promise.resolve()
        .then(() => invokeNativeRoute(JSON.parse(line)))
        .then((result) => socket.end(`${JSON.stringify({ ok: true, ...result })}\n`))
        .catch((error) => socket.end(`${JSON.stringify({
          ok: false,
          status: 500,
          error: error instanceof Error ? error.message : "Native RPC failed.",
        })}\n`));
    });
  });
  nativePipeServer.listen(pipePath);
}

function isLoopbackRequest(req: IncomingMessage) {
  const remote = req.socket.remoteAddress ?? "";
  return remote === "127.0.0.1" || remote === "::1" || remote === "::ffff:127.0.0.1";
}

const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
  const pathname = req.url?.split("?")[0];
  const isBrowserFile = pathname === "/api/download-full/browser-file";
  if (!isBrowserFile && !applyCors(req, res)) {
    res.statusCode = 403;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ error: "Origin is not allowed." }));
    return;
  }
  if (isBrowserFile) {
    applyPermissiveCors(req, res);
  }

  if (req.method === "OPTIONS") {
    res.statusCode = 204;
    res.end();
    return;
  }

  if (pathname === "/setup" && req.method === "GET") {
    if (!isLoopbackRequest(req)) {
      res.statusCode = 403;
      res.setHeader("Content-Type", "text/plain; charset=utf-8");
      res.end("Initial setup is available only from this computer.");
      return;
    }
    const setup = await handlers.runtime.getSetupCodeForTerminal();
    const status = await handlers.runtime.getStatus();
    const credentialRecovery = setup ? null : await handlers.runtime.createLocalCredentialRecovery();
    res.statusCode = 200;
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("Content-Security-Policy", "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'self'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'");
    res.end(renderSetupWizard({
      setupCode: setup?.setupCode ?? "",
      setupRequired: Boolean(setup?.setupCode),
      suggestedNodeName: `${hostname() || "Home"} Server`,
      connectionCode: status.node.connectionCode ?? "",
      credentialRecovery,
    }));
    return;
  }
  if (pathname === "/api/node/local-credentials" && !isLoopbackRequest(req)) {
    res.statusCode = 403;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ error: "Password recovery is available only from this computer." }));
    return;
  }
  if (pathname === "/v2/health/live" || pathname === "/v2/health/ready") {
    res.statusCode = 200;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ status: "ok" }));
    return;
  }
  if (pathname === "/v2/protocol") {
    res.statusCode = 200;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ protocolVersion: 2, transports: ["loopback-http"] }));
    return;
  }
  if (pathname === "/v2/node/identity" && req.method === "GET") {
    res.statusCode = 200;
    res.setHeader("Content-Type", "application/json");
    res.setHeader("Cache-Control", "no-store");
    res.end(JSON.stringify(await handlers.runtime.getTransportIdentityRecord()));
    return;
  }

  const handler = findHandler(req.url);
  if (!handler) {
    notFound(res);
    return;
  }

  try {
    await handler(req as RequestLike, res as JsonResponse);
    if (pathname === "/api/node/setup/complete" && res.statusCode >= 200 && res.statusCode < 300) {
      void refreshManagedGatewayApplication?.();
    }
  } catch (error) {
    res.statusCode = 500;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ error: error instanceof Error ? error.message : "Unhandled server error." }));
  }
});

server.on("error", (error: NodeJS.ErrnoException) => {
  if (error.code === "EADDRINUSE") {
    console.error(`[spilledcinema-server] port ${port} is already in use on ${host}`);
    process.exit(1);
  }

  console.error("[spilledcinema-server] fatal server error", error);
  process.exit(1);
});

server.listen(port, host, () => {
  void handlers.runtime.getSetupCodeForTerminal().then((setup) => {
    if (!setup?.setupCode) {
      return;
    }
    console.log("");
    console.log("[spilledcinema-server] private node setup is waiting");
    console.log(`[spilledcinema-server] open: http://127.0.0.1:${port}/setup`);
    console.log(`[spilledcinema-server] local node: http://127.0.0.1:${port}`);
    console.log(`[spilledcinema-server] setup code: ${setup.setupCode}`);
    console.log("[spilledcinema-server] this code expires in 15 minutes");
    console.log(`[spilledcinema-server] config will be written to: ${setup.configPath}`);
    console.log("");
    if (process.platform === "win32" && process.env.SPILLED_OPEN_SETUP_BROWSER === "1") {
      execFile("rundll32.exe", ["url.dll,FileProtocolHandler", `http://127.0.0.1:${port}/setup`], () => undefined);
    }
  });
  void startServerServices();
});

function withStartTimeout<T>(promise: Promise<T>, label: string) {
  let timeout: NodeJS.Timeout | null = null;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeout = setTimeout(() => {
      reject(new Error(`${label} did not return a tunnel URL within ${PUBLIC_TUNNEL_START_TIMEOUT_MS}ms`));
    }, PUBLIC_TUNNEL_START_TIMEOUT_MS);
  });

  return Promise.race([promise, timeoutPromise]).finally(() => {
    if (timeout) {
      clearTimeout(timeout);
    }
  });
}

function sanitizeTunnelSubdomain(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 63);
}

async function getPreferredTunnelSubdomain() {
  const explicit = process.env.SPILLED_PUBLIC_TUNNEL_SUBDOMAIN?.trim();
  if (explicit) {
    return sanitizeTunnelSubdomain(explicit);
  }

  const record = await handlers.runtime.getNodeRecord();
  return sanitizeTunnelSubdomain(`spilled-${record.nodeId.slice(0, 18)}`);
}

async function startPublicTunnel(): Promise<{ url: string; close: () => void } | null> {
  if (process.env.SPILLED_NODE_ENDPOINT_URL || process.env.SPILLED_DISABLE_AUTO_TUNNEL === "1") {
    return null;
  }

  const providers = process.env.SPILLED_PUBLIC_TUNNEL_PROVIDERS?.split(",").map((provider) => provider.trim().toLowerCase()).filter(Boolean) ?? ["cloudflared", "localtunnel"];

  for (const provider of providers) {
    try {
      if (provider === "cloudflared" || provider === "cloudflare") {
        return await startCloudflaredTunnel();
      }
      if (provider === "localtunnel") {
        return await startLocalTunnel();
      }
      console.warn(`[spilledcinema-server] unknown public tunnel provider ${provider}`);
    } catch (error) {
      console.warn(`[spilledcinema-server] ${provider} public fetch tunnel failed`, error instanceof Error ? error.message : String(error));
    }
  }

  return null;
}

async function startLocalTunnel() {
  const localtunnelModule = await import("localtunnel");
  const createTunnel = localtunnelModule.default ?? localtunnelModule;

  async function openTunnel(subdomain?: string) {
    const label = subdomain ? `localtunnel subdomain ${subdomain}` : "localtunnel random subdomain";
    return await withStartTimeout(createTunnel({
      port,
      local_host: "127.0.0.1",
      ...(subdomain ? { subdomain } : {}),
    }), label);
  }

  const subdomain = await getPreferredTunnelSubdomain();
  let tunnel: Awaited<ReturnType<typeof openTunnel>>;
  try {
    tunnel = await openTunnel(subdomain);
  } catch (error) {
    console.warn("[spilledcinema-server] preferred localtunnel fetch tunnel failed", error instanceof Error ? error.message : String(error));
    tunnel = await openTunnel();
  }
  const tunnelUrl = String(tunnel.url).replace(/\/$/, "");

  tunnel.on?.("close", () => {
    console.warn("[spilledcinema-server] public fetch tunnel closed");
    if (publicTunnel?.url === tunnelUrl) {
      void restartPublicTunnel();
    }
  });
  tunnel.on?.("error", (error: unknown) => {
    console.warn("[spilledcinema-server] public fetch tunnel error", error instanceof Error ? error.message : String(error));
  });

  return {
    url: tunnelUrl,
    close: () => tunnel.close(),
  };
}

function resolveCloudflaredBinaryPath() {
  try {
    const libraryPath = createRequire(import.meta.url).resolve("cloudflared/lib/lib.js");
    const binaryName = process.platform === "win32" ? "cloudflared.exe" : "cloudflared";
    const resolved = resolve(dirname(libraryPath), "..", "bin", binaryName);
    // Inside an Electron asar archive the native binary cannot be spawned
    // directly; point at the unpacked copy electron-builder provides.
    return resolved.replace(/\.asar([\\/]|$)/, ".asar.unpacked$1");
  } catch {
    // Fall back to the workspace layout used by the legacy dev scripts.
    const binaryName = process.platform === "win32" ? "cloudflared.exe" : "cloudflared";
    return resolve(process.cwd(), "..", "..", "node_modules", "cloudflared", "bin", binaryName);
  }
}

async function startCloudflaredTunnel() {
  const cloudflaredBinaryPath = resolveCloudflaredBinaryPath();
  const child = spawn(cloudflaredBinaryPath, ["tunnel", "--url", `http://127.0.0.1:${port}`, "--no-autoupdate"], {
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
  let resolved = false;
  let stderrBuffer = "";

  let tunnel: { url: string; child: ChildProcess };
  try {
    tunnel = await withStartTimeout(new Promise<{ url: string; child: ChildProcess }>((resolvePromise, rejectPromise) => {
    child.once("error", rejectPromise);
    child.once("exit", (code, signal) => {
      if (!resolved) {
        rejectPromise(new Error(`cloudflared exited before publishing a tunnel URL (${signal ?? code ?? "unknown"})`));
      }
    });

    function inspectOutput(chunk: Buffer) {
      const text = chunk.toString("utf8");
      stderrBuffer = `${stderrBuffer}${text}`.slice(-8_000);
      const match = stderrBuffer.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/i);
      if (!match) {
        return;
      }
      resolved = true;
      resolvePromise({ url: match[0].replace(/\/$/, ""), child });
    }

    child.stdout?.on("data", inspectOutput);
    child.stderr?.on("data", inspectOutput);
    }), "cloudflared");
  } catch (error) {
    if (!child.killed) child.kill();
    throw error;
  }

  child.on("exit", (code, signal) => {
    console.warn(`[spilledcinema-server] public fetch tunnel closed (${signal ?? code ?? "unknown"})`);
    if (publicTunnel?.url === tunnel.url) {
      void restartPublicTunnel();
    }
  });

  return {
    url: tunnel.url,
    close: () => {
      if (!child.killed) {
        child.kill();
      }
    },
  };
}

async function checkPublicTunnel(url: string) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8_000);
  try {
    const response = await fetch(`${url}/api/status`, {
      headers: { "bypass-tunnel-reminder": "true" },
      signal: controller.signal,
    });
    return response.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timeout);
  }
}

function stopPublicTunnelMonitor() {
  if (publicTunnelMonitor) {
    clearInterval(publicTunnelMonitor);
    publicTunnelMonitor = null;
  }
}

function startPublicTunnelMonitor() {
  stopPublicTunnelMonitor();
  if (process.env.SPILLED_NODE_ENDPOINT_URL || process.env.SPILLED_DISABLE_AUTO_TUNNEL === "1") {
    return;
  }

  publicTunnelMonitor = setInterval(() => {
    if (!publicTunnel) {
      void restartPublicTunnel();
      return;
    }

    void checkPublicTunnel(publicTunnel.url).then((healthy) => {
      if (healthy) {
        publicTunnelFailureCount = 0;
        return;
      }

      publicTunnelFailureCount += 1;
      console.warn(`[spilledcinema-server] public fetch tunnel unhealthy ${publicTunnel?.url ?? ""} (${publicTunnelFailureCount}/${PUBLIC_TUNNEL_HEALTH_FAILURE_LIMIT})`);
      if (publicTunnelFailureCount >= PUBLIC_TUNNEL_HEALTH_FAILURE_LIMIT) {
        publicTunnelFailureCount = 0;
        void restartPublicTunnel();
      }
    });
  }, 30_000);
}

async function restartPublicTunnel() {
  if (restartingPublicTunnel) {
    return restartingPublicTunnel;
  }

  restartingPublicTunnel = (async () => {
    const previous = publicTunnel;
    publicTunnel = null;
    handlers.runtime.setEndpointUrl(undefined);
    setNodeEndpointUrl(undefined);
    try {
      previous?.close();
    } catch {
      // The tunnel may already be closed.
    }

    const nextTunnel = await startPublicTunnel();
    if (!nextTunnel) {
      console.warn("[spilledcinema-server] no public fetch tunnel available; this node is local-only");
      return;
    }

    publicTunnel = nextTunnel;
    publicTunnelFailureCount = 0;
    handlers.runtime.setEndpointUrl(nextTunnel.url);
    setNodeEndpointUrl(nextTunnel.url);
    console.log(`[spilledcinema-server] public fetch server ${nextTunnel.url}`);
    void handlers.runtime.getSetupCodeForTerminal().then((setup) => {
      if (setup?.setupCode) {
        console.log(`[spilledcinema-server] setup URL: https://spilled.overload.studio/node/setup?node=${encodeURIComponent(nextTunnel.url)}`);
      }
    });
    void refreshManagedGatewayApplication?.();
  })().finally(() => {
    restartingPublicTunnel = null;
  });

  return restartingPublicTunnel;
}

async function startServerServices() {
  console.log(`[spilledcinema-server] listening on http://${host}:${port}`);
  await transientDownloads.initialize();
  startNativePipe();
  resourceGovernor.start();
  publicTunnel = await startPublicTunnel();
  if (publicTunnel) {
    handlers.runtime.setEndpointUrl(publicTunnel.url);
    setNodeEndpointUrl(publicTunnel.url);
    console.log(`[spilledcinema-server] public fetch server ${publicTunnel.url}`);
    void handlers.runtime.getSetupCodeForTerminal().then((setup) => {
      if (setup?.setupCode) {
        console.log(`[spilledcinema-server] setup URL: https://spilled.overload.studio/node/setup?node=${encodeURIComponent(publicTunnel!.url)}`);
      }
    });
  } else if (process.env.SPILLED_NODE_ENDPOINT_URL) {
    handlers.runtime.setEndpointUrl(process.env.SPILLED_NODE_ENDPOINT_URL);
    setNodeEndpointUrl(process.env.SPILLED_NODE_ENDPOINT_URL);
    console.log(`[spilledcinema-server] public fetch server ${process.env.SPILLED_NODE_ENDPOINT_URL}`);
  } else {
    console.warn("[spilledcinema-server] no public fetch tunnel available; this node is local-only");
  }

  mesh.start();
  backupManager?.start();
  await startManagedGateway();
  const connectionStatus = await handlers.runtime.getStatus();
  console.log(`[spilledcinema-server] connection code: ${connectionStatus.node.connectionCode}`);
  console.log(`[spilledcinema-server] connect: https://spilled.overload.studio/connect?code=${encodeURIComponent(connectionStatus.node.connectionCode)}`);
  if (
    process.env.SPILLED_ENABLE_LEGACY_CONTROL_PLANE === "1" &&
    (publicTunnel || process.env.SPILLED_NODE_ENDPOINT_URL)
  ) {
    controlPlane?.start();
  } else {
    console.warn("[control-plane] legacy public registration is disabled");
  }
  startPublicTunnelMonitor();
}

async function startManagedGateway() {
  if (!gatewayUrl || !gatewayJwksUrl || !controlPlaneUrl) {
    console.warn("[managed-gateway] disabled; the node remains local-only");
    return;
  }

  const createLink = (enrollmentCredential: string) => {
    if (gatewayLink) return;
    gatewayLink = new ManagedGatewayLink({
      gatewayUrl,
      enrollmentCredential,
      jwksUrl: gatewayJwksUrl,
      runtime: handlers.runtime,
      execute: createV2RpcExecutor(handlers, transientDownloads, handlers.runtime, bulkTransfers),
      onReconnectStalled: () => {
        console.log("[managed-gateway] reconnect stalled; refreshing enrollment application");
        void refreshManagedGatewayApplication?.();
      },
    });
    gatewayLink.start();
  };

  // Establish the link immediately with the persisted credential so the node
  // stays reachable even if the control-plane apply is temporarily down.
  const storedCredential = await handlers.runtime.storage.getProtectedSecret?.("gateway.enrollmentCredential");
  if (storedCredential) {
    createLink(storedCredential);
    console.log("[managed-gateway] node link started with stored enrollment credential");
  }

  const applyOnce = async (forceReconnect = false) => {
    const application = await handlers.runtime.createGatewayEnrollmentApplication({
      enrollmentCredential: process.env.SPILLED_GATEWAY_ENROLLMENT?.trim() || undefined,
    });
    const response = await fetch(`${controlPlaneUrl}/v2/nodes/apply`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(application),
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) {
      throw new Error(`application returned ${response.status}`);
    }
    createLink(application.enrollmentCredential);
    gatewayLink?.setEnrollmentCredential(application.enrollmentCredential);
    if (forceReconnect || !gatewayLink?.getStatus().connected) {
      gatewayLink?.reconnectNow("Enrollment accepted.");
    }
    console.log("[managed-gateway] node application accepted; verification is pending");
  };

  let refreshInFlight: Promise<void> | null = null;
  const apply = (forceReconnect = false) => {
    if (refreshInFlight) return refreshInFlight;
    refreshInFlight = applyOnce(forceReconnect)
      .catch((error) => {
        console.warn(`[managed-gateway] enrollment refresh failed; retrying shortly (${error instanceof Error ? error.message : "unknown error"})`);
      })
      .finally(() => {
        refreshInFlight = null;
      });
    return refreshInFlight;
  };
  refreshManagedGatewayApplication = () => apply(true);

  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      await applyOnce();
      break;
    } catch (error) {
      if (attempt < 2) {
        const delay = 2_000 * 2 ** attempt;
        console.warn(`[managed-gateway] apply attempt ${attempt + 1} failed; retrying in ${delay / 1000}s (${error instanceof Error ? error.message : "unknown error"})`);
        await new Promise((resolve) => setTimeout(resolve, delay));
      } else {
        console.warn(`[managed-gateway] all apply attempts failed; node link continues with stored credential (${error instanceof Error ? error.message : "unknown error"})`);
      }
    }
  }

  let lastPeriodicEnrollmentAt = Date.now();
  gatewayEnrollmentTimer = setInterval(() => {
    const disconnected = !gatewayLink?.getStatus().connected;
    const periodicRefreshDue = Date.now() - lastPeriodicEnrollmentAt >= 30 * 60_000;
    if (!disconnected && !periodicRefreshDue) return;
    if (periodicRefreshDue) lastPeriodicEnrollmentAt = Date.now();
    void apply(disconnected);
  }, 30_000);
  gatewayEnrollmentTimer.unref?.();
}

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    mesh.stop();
    backupManager?.stop();
    gatewayLink?.stop();
    if (gatewayEnrollmentTimer) clearInterval(gatewayEnrollmentTimer);
    refreshManagedGatewayApplication = null;
    resourceGovernor.stop();
    bulkTransfers.close();
    controlPlane?.stop();
    stopPublicTunnelMonitor();
    publicTunnel?.close();
    nativePipeServer?.close();
    server.close(() => process.exit(0));
  });
}
