import { describe, expect, it, vi } from "vitest";
import { createV2RpcExecutor, isPlayerResolveMethod } from "../../../../server/src/v2-rpc";
import { getPrivatePlaybackOperation } from "../../lib/private-playback-operation";

function fixture() {
  const handler = vi.fn((_request, response) => response.end(JSON.stringify({ playbackUrl: "https://node.example/media" })));
  const validatePrivateSession = vi.fn(async (token?: string) => {
    if (!token) throw new Error("Missing private session token.");
    return {};
  });
  const executor = createV2RpcExecutor({
    searchHandler: handler,
    providerSearchHandler: handler,
    providerFeedHandler: handler,
    providerImportHandler: handler,
    playerResolveHandler: handler,
    cleanPlayerResolveHandler: handler,
    playbackResolveHandler: handler,
    startDownloadHandler: handler,
    downloadStatusHandler: handler,
    cancelDownloadHandler: handler,
  }, {} as never, { validatePrivateSession } as never);
  return { executor, handler, validatePrivateSession };
}

describe("authenticated private playback", () => {
  it("maps every player route to the private player capability", () => {
    expect(getPrivatePlaybackOperation("/api/player/resolve", {})).toMatchObject({ method: "player.embed.resolve" });
    expect(getPrivatePlaybackOperation("/api/player/clean-resolve", {})).toMatchObject({ method: "player.clean.resolve" });
    expect(getPrivatePlaybackOperation("/api/player/playback-resolve", {})).toMatchObject({ method: "player.playback.resolve" });
    expect(getPrivatePlaybackOperation("/api/provider-search", {})).toBeNull();
  });

  it("validates the watcher session before resolving playback", async () => {
    const { executor, handler, validatePrivateSession } = fixture();
    await executor({
      method: "player.playback.resolve",
      params: { accessToken: "watcher-access" },
      capability: "player.resolve",
      principalKind: "private",
      ticketId: "ticket",
      limits: { maxResponseBytes: 4 * 1024 * 1024, maxDurationMs: 90_000 },
    });
    expect(validatePrivateSession).toHaveBeenCalledWith("watcher-access", "library");
    expect(handler).toHaveBeenCalledOnce();
  });

  it("rejects a missing private session before the handler", async () => {
    const { executor, handler } = fixture();
    await expect(executor({
      method: "player.playback.resolve",
      params: {},
      capability: "player.resolve",
      principalKind: "private",
      ticketId: "ticket",
      limits: { maxResponseBytes: 4 * 1024 * 1024, maxDurationMs: 90_000 },
    })).rejects.toThrow("Missing private session token");
    expect(handler).not.toHaveBeenCalled();
  });

  it("does not broaden private routing beyond player methods", () => {
    expect(isPlayerResolveMethod("player.playback.resolve")).toBe(true);
    expect(isPlayerResolveMethod("provider.search")).toBe(false);
  });
});
