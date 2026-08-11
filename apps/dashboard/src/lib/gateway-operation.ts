export function getV2GatewayOperation(path: string, body: Record<string, unknown>) {
  if (path === "/api/search" || path === "/api/provider-search") {
    return { capability: "provider.search" as const, action: "search", method: "provider.search", params: body };
  }
  if (path === "/api/provider-feed") {
    return { capability: "provider.feed" as const, action: "feed", method: "provider.feed", params: body };
  }
  if (path === "/api/provider-import") {
    return { capability: "provider.import" as const, action: "import", method: "provider.import", params: body };
  }
  if (path === "/api/import-svetserialu" || path === "/api/import-bombuj") {
    return {
      capability: "provider.import" as const,
      action: "import",
      method: "provider.import",
      params: { ...body, moduleId: path.endsWith("svetserialu") ? "svetserialu" : "bombuj" },
    };
  }
  if (path === "/api/player/resolve") {
    return { capability: "player.resolve" as const, action: "resolve", method: "player.embed.resolve", params: body };
  }
  if (path === "/api/player/clean-resolve") {
    return { capability: "player.resolve" as const, action: "resolve", method: "player.clean.resolve", params: body };
  }
  if (path === "/api/player/playback-resolve") {
    return { capability: "player.resolve" as const, action: "resolve", method: "player.playback.resolve", params: body };
  }
  return null;
}
