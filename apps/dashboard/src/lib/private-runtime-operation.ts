import { getPrivatePlaybackOperation } from "./private-playback-operation";

export function getPrivateRuntimeOperation(path: string, body: Record<string, unknown>) {
  const playback = getPrivatePlaybackOperation(path, body);
  if (playback) return { capability: "player.resolve" as const, ...playback };
  if (path === "/api/search" || path === "/api/provider-search") {
    return { capability: "library.read" as const, action: "provider.search", method: "library.provider.search", params: body };
  }
  if (path === "/api/provider-feed") {
    return { capability: "library.read" as const, action: "provider.feed", method: "library.provider.feed", params: body };
  }
  if (path === "/api/provider-import" || path === "/api/import-svetserialu" || path === "/api/import-bombuj") {
    const params = path === "/api/provider-import" ? body : {
      ...body, moduleId: path === "/api/import-svetserialu" ? "svetserialu" : "bombuj",
    };
    return { capability: "library.write" as const, action: "provider.import", method: "library.provider.import", params };
  }
  return null;
}
