import type { Plugin } from "vite";
import { createHttpHandlers, type JsonResponse, type RequestLike } from "../../../apps/server/src/http-handlers";

export function createDashboardApiPlugin(): Plugin {
  const handlers = createHttpHandlers();
  const attach = (server: { middlewares: { use: (path: string, handler: (req: RequestLike, res: JsonResponse) => void | Promise<void>) => void } }) => {
    server.middlewares.use("/api/status", handlers.statusHandler);
    server.middlewares.use("/api/import-svetserialu", handlers.importSvetSerialuHandler);
    server.middlewares.use("/api/import-bombuj", handlers.importBombujHandler);
    server.middlewares.use("/api/search", handlers.searchHandler);
    server.middlewares.use("/api/explore/feed", handlers.exploreFeedHandler);
    server.middlewares.use("/api/explore/people", handlers.explorePeopleHandler);
    server.middlewares.use("/api/trending/feed", handlers.trendingFeedHandler);
    server.middlewares.use("/api/artwork/refresh", handlers.refreshArtworkHandler);
    server.middlewares.use("/api/artwork/search", handlers.searchArtworkHandler);
    server.middlewares.use("/api/download-full/start", handlers.startDownloadHandler);
    server.middlewares.use("/api/download-full/browser-start", handlers.browserStartHandler);
    server.middlewares.use("/api/player/resolve", handlers.playerResolveHandler);
    server.middlewares.use("/api/download-full/browser-file", handlers.browserFileHandler);
    server.middlewares.use("/api/download-full/status", handlers.downloadStatusHandler);
    server.middlewares.use("/api/download-full/check", handlers.downloadCheckHandler);
    server.middlewares.use("/api/download-full/list", handlers.downloadListHandler);
    server.middlewares.use("/api/download-full/delete", handlers.deleteDownloadHandler);
    server.middlewares.use("/api/download-full/cancel", handlers.cancelDownloadHandler);
    server.middlewares.use("/api/download-full/file", handlers.downloadFileHandler);
    server.middlewares.use("/api/download-full/subtitles", handlers.subtitleListHandler);
    server.middlewares.use("/api/download-full/subtitle-file", handlers.subtitleFileHandler);
    server.middlewares.use("/api/subtitle-proxy", handlers.subtitleProxyHandler);
    server.middlewares.use("/api/node/auth/anonymous", handlers.anonymousGrantHandler);
    server.middlewares.use("/api/node/auth/private", handlers.privateSessionHandler);
    server.middlewares.use("/api/node/pairing/start", handlers.pairingStartHandler);
    server.middlewares.use("/api/node/pairing/approve", handlers.pairingApproveHandler);
    server.middlewares.use("/api/node/passkey/register-options", handlers.passkeyRegistrationHandler);
    server.middlewares.use("/api/node/passkey/authenticate-options", handlers.passkeyAuthenticationHandler);
    server.middlewares.use("/api/node/spillshare/find", handlers.spillshareLookupHandler);
    server.middlewares.use("/api/node/mesh/announce", handlers.meshAnnounceHandler);
    server.middlewares.use("/api/node/mesh/snapshot", handlers.meshSnapshotHandler);
    server.middlewares.use("/api/node/mesh/nodes", handlers.meshNodesHandler);
  };

  return {
    name: "spilledcinema-dashboard-node-api",
    configureServer(server) {
      attach(server);
    },
    configurePreviewServer(server) {
      attach(server);
    },
  };
}
