export function getPrivatePlaybackOperation(path: string, body: Record<string, unknown>) {
  if (path === "/api/player/resolve") {
    return { action: "resolve", method: "player.embed.resolve", params: body };
  }
  if (path === "/api/player/clean-resolve") {
    return { action: "resolve", method: "player.clean.resolve", params: body };
  }
  if (path === "/api/player/playback-resolve") {
    return { action: "resolve", method: "player.playback.resolve", params: body };
  }
  return null;
}
