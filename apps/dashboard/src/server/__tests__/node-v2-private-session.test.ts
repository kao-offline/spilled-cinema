import { describe, expect, it, vi } from "vitest";
import { createV2RpcExecutor, privateSessionScopeForRemoteMethod } from "../../../../server/src/v2-rpc";

function executorFixture() {
  const handler = vi.fn((_req, res) => res.end(JSON.stringify({ ok: true })));
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

const request = {
  method: "provider.search",
  params: { query: "Silo", accessToken: "watcher-access" },
  capability: "provider.search" as const,
  principalKind: "private" as const,
  ticketId: "ticket-private-search",
  limits: { maxResponseBytes: 4 * 1024 * 1024, maxDurationMs: 30_000 },
};

describe("private mobile provider authorization", () => {
  it("validates a watcher session before executing a private provider request", async () => {
    const { executor, handler, validatePrivateSession } = executorFixture();
    await executor(request);
    expect(validatePrivateSession).toHaveBeenCalledWith("watcher-access", "library");
    expect(handler).toHaveBeenCalledOnce();
  });

  it("rejects a private provider request without an access token", async () => {
    const { executor, handler } = executorFixture();
    await expect(executor({ ...request, params: { query: "Silo" } })).rejects.toThrow("Missing private session token");
    expect(handler).not.toHaveBeenCalled();
  });

  it("keeps public provider requests on the existing ticket-only policy", async () => {
    const { executor, validatePrivateSession } = executorFixture();
    await executor({ ...request, principalKind: "public", params: { query: "Silo" } });
    expect(validatePrivateSession).not.toHaveBeenCalled();
  });

  it("does not require a session before the watcher login RPC", () => {
    expect(privateSessionScopeForRemoteMethod("auth.watcher.password.login")).toBeNull();
  });
});
