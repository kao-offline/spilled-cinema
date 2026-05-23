import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { createHttpHandlers, type JsonResponse, type RequestLike } from "./http-handlers";
import { ControlPlaneReporter, readControlPlaneReporterOptionsFromEnv } from "./control-plane";
import { readRelayMeshOptionsFromEnv, SecureRelayMesh } from "./mesh";
import { setNodeEndpointUrl } from "../../../packages/node-client/src/index";
import { loadPrivateNodeConfigFromEnv, readNodeModeFromEnv } from "../../node/src/private-config";

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

const handlers = createHttpHandlers();
const nodeMode = readNodeModeFromEnv();
const privateConfig = loadPrivateNodeConfigFromEnv(nodeMode);
const port = Number.parseInt(process.env.PORT || "8787", 10);
const host = process.env.HOST || "0.0.0.0";
handlers.runtime.configure({
  mode: nodeMode,
  privateConfig,
});
const mesh = new SecureRelayMesh(handlers.runtime, readRelayMeshOptionsFromEnv());
const controlPlaneOptions = readControlPlaneReporterOptionsFromEnv();
const controlPlane = controlPlaneOptions ? new ControlPlaneReporter(handlers.runtime, controlPlaneOptions) : null;
let publicTunnel: { url: string; close: () => void } | null = null;
let publicTunnelMonitor: NodeJS.Timeout | null = null;
let restartingPublicTunnel: Promise<void> | null = null;

const routes: Array<{ path: string; handler: RouteHandler }> = [
  { path: "/api/status", handler: handlers.statusHandler },
  { path: "/api/import-svetserialu", handler: handlers.importSvetSerialuHandler },
  { path: "/api/import-bombuj", handler: handlers.importBombujHandler },
  { path: "/api/search", handler: handlers.searchHandler },
  { path: "/api/provider-modules", handler: handlers.providerModulesHandler },
  { path: "/api/provider-feed", handler: handlers.providerFeedHandler },
  { path: "/api/provider-search", handler: handlers.providerSearchHandler },
  { path: "/api/explore/feed", handler: handlers.exploreFeedHandler },
  { path: "/api/explore/people", handler: handlers.explorePeopleHandler },
  { path: "/api/trending/feed", handler: handlers.trendingFeedHandler },
  { path: "/api/artwork/refresh", handler: handlers.refreshArtworkHandler },
  { path: "/api/artwork/search", handler: handlers.searchArtworkHandler },
  { path: "/api/download-full/start", handler: handlers.startDownloadHandler },
  { path: "/api/download-full/browser-start", handler: handlers.browserStartHandler },
  { path: "/api/player/resolve", handler: handlers.playerResolveHandler },
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

function applyCors(res: ServerResponse) {
  res.setHeader("Access-Control-Allow-Origin", process.env.CORS_ORIGIN || "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,HEAD,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Spilled-Node, bypass-tunnel-reminder");
}

function notFound(res: ServerResponse) {
  res.statusCode = 404;
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify({ error: "Not found." }));
}

function findHandler(url = "") {
  const pathname = url.split("?")[0] || "/";
  return routes.find((route) => route.path === pathname)?.handler;
}

const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
  applyCors(res);

  if (req.method === "OPTIONS") {
    res.statusCode = 204;
    res.end();
    return;
  }

  const handler = findHandler(req.url);
  if (!handler) {
    notFound(res);
    return;
  }

  try {
    await handler(req as RequestLike, res as JsonResponse);
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
  void startServerServices();
});

async function startPublicTunnel() {
  if (process.env.SPILLED_NODE_ENDPOINT_URL || process.env.SPILLED_DISABLE_AUTO_TUNNEL === "1") {
    return null;
  }

  try {
    const localtunnelModule = await import("localtunnel");
    const createTunnel = localtunnelModule.default ?? localtunnelModule;
    const tunnel = await createTunnel({
      port,
      local_host: "127.0.0.1",
    });

    tunnel.on?.("close", () => {
      console.warn("[spilledcinema-server] public fetch tunnel closed");
      void restartPublicTunnel();
    });
    tunnel.on?.("error", (error: unknown) => {
      console.warn("[spilledcinema-server] public fetch tunnel error", error instanceof Error ? error.message : String(error));
    });

    return {
      url: String(tunnel.url).replace(/\/$/, ""),
      close: () => tunnel.close(),
    };
  } catch (error) {
    console.warn("[spilledcinema-server] auto public fetch tunnel failed", error instanceof Error ? error.message : String(error));
    return null;
  }
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
      if (!healthy) {
        console.warn(`[spilledcinema-server] public fetch tunnel unhealthy ${publicTunnel?.url ?? ""}`);
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
    setNodeEndpointUrl(nextTunnel.url);
    console.log(`[spilledcinema-server] public fetch server ${nextTunnel.url}`);
    await controlPlane?.register().catch((error) => {
      console.warn("[control-plane] register failed", error instanceof Error ? error.message : String(error));
    });
  })().finally(() => {
    restartingPublicTunnel = null;
  });

  return restartingPublicTunnel;
}

async function startServerServices() {
  console.log(`[spilledcinema-server] listening on http://${host}:${port}`);
  publicTunnel = await startPublicTunnel();
  if (publicTunnel) {
    setNodeEndpointUrl(publicTunnel.url);
    console.log(`[spilledcinema-server] public fetch server ${publicTunnel.url}`);
  } else if (process.env.SPILLED_NODE_ENDPOINT_URL) {
    console.log(`[spilledcinema-server] public fetch server ${process.env.SPILLED_NODE_ENDPOINT_URL}`);
  } else {
    console.warn("[spilledcinema-server] no public fetch tunnel available; this node is local-only");
  }

  mesh.start();
  if (publicTunnel || process.env.SPILLED_NODE_ENDPOINT_URL) {
    controlPlane?.start();
  } else {
    console.warn("[control-plane] not registering a local-only node");
  }
  startPublicTunnelMonitor();
}

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    mesh.stop();
    controlPlane?.stop();
    stopPublicTunnelMonitor();
    publicTunnel?.close();
    server.close(() => process.exit(0));
  });
}
