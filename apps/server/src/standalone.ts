import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { createHttpHandlers, type JsonResponse, type RequestLike } from "./http-handlers";
import { ControlPlaneReporter, readControlPlaneReporterOptionsFromEnv } from "./control-plane";
import { readRelayMeshOptionsFromEnv, SecureRelayMesh } from "./mesh";

type RouteHandler = (req: RequestLike, res: JsonResponse) => void | Promise<void>;

const handlers = createHttpHandlers();
const port = Number.parseInt(process.env.PORT || "8787", 10);
const host = process.env.HOST || "0.0.0.0";
const mesh = new SecureRelayMesh(handlers.runtime, readRelayMeshOptionsFromEnv());
const controlPlaneOptions = readControlPlaneReporterOptionsFromEnv();
const controlPlane = controlPlaneOptions ? new ControlPlaneReporter(handlers.runtime, controlPlaneOptions) : null;

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
  { path: "/api/node/auth/private", handler: handlers.privateSessionHandler },
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
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Spilled-Node");
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
  console.log(`[spilledcinema-server] listening on http://${host}:${port}`);
  mesh.start();
  controlPlane?.start();
});

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    mesh.stop();
    controlPlane?.stop();
    server.close(() => process.exit(0));
  });
}
