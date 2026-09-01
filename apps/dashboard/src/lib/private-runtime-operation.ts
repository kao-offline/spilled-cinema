import type { PrivateCapability } from "./v2-gateway-client";
import { getPrivatePlaybackOperation } from "./private-playback-operation";

export type PrivateRuntimeOperation = {
  capability: PrivateCapability;
  action: string;
  method: string;
  params: Record<string, unknown>;
};

/** Routes logged-in runtime work to the user's own node with a private ticket. */
export function getPrivateRuntimeOperation(
  path: string,
  body: Record<string, unknown>,
): PrivateRuntimeOperation | null {
  const playback = getPrivatePlaybackOperation(path, body);
  if (playback) {
    return { capability: "player.resolve", ...playback };
  }

  if (path === "/api/search") {
    return { capability: "library.read", action: "provider.search", method: "library.provider.search", params: body };
  }
  if (path === "/api/provider-search") {
    return { capability: "library.read", action: "provider.search", method: "library.provider.search", params: body };
  }
  if (path === "/api/provider-feed") {
    return { capability: "library.read", action: "provider.feed", method: "library.provider.feed", params: body };
  }
  if (path === "/api/provider-import") {
    return { capability: "library.write", action: "provider.import", method: "library.provider.import", params: body };
  }
  if (path === "/api/import-svetserialu") {
    return {
      capability: "library.write",
      action: "provider.import",
      method: "library.provider.import",
      params: { ...body, moduleId: "svetserialu" },
    };
  }
  if (path === "/api/import-bombuj") {
    return {
      capability: "library.write",
      action: "provider.import",
      method: "library.provider.import",
      params: { ...body, moduleId: "bombuj" },
    };
  }
  return null;
}
