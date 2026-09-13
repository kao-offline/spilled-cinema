import { describe, expect, it, vi } from "vitest";
import { getPrivateRuntimeOperation } from "../private-runtime-operation";
import { createV2RpcExecutor } from "../../../../server/src/v2-rpc";

describe("private provider routing", () => {
  it.each([
    ["/api/search", "provider.search", "library.read", "library.provider.search"],
    ["/api/provider-search", "provider.search", "library.read", "library.provider.search"],
    ["/api/provider-feed", "provider.feed", "library.read", "library.provider.feed"],
    ["/api/provider-import", "provider.import", "library.write", "library.provider.import"],
    ["/api/import-svetserialu", "provider.import", "library.write", "library.provider.import"],
    ["/api/import-bombuj", "provider.import", "library.write", "library.provider.import"],
  ])("routes %s through the private gateway", (path, action, capability, method) => {
    expect(getPrivateRuntimeOperation(path, { query: "test" })).toMatchObject({ capability, action, method });
  });
  it("preserves provider aliases and leaves unrelated routes alone", () => {
    expect(getPrivateRuntimeOperation("/api/import-bombuj", { slug: "film", moduleId: "wrong" })?.params).toEqual({ slug: "film", moduleId: "bombuj" });
    expect(getPrivateRuntimeOperation("/api/import-svetserialu", { slug: "film" })?.params).toEqual({ slug: "film", moduleId: "svetserialu" });
    expect(getPrivateRuntimeOperation("/api/artwork/search", {})).toBeNull();
    expect(getPrivateRuntimeOperation("/api/player/resolve", {})?.capability).toBe("player.resolve");
  });
  it.each([
    ["library.provider.search", "searchHandler"],
    ["library.provider.feed", "providerFeedHandler"],
    ["library.provider.import", "providerImportHandler"],
  ] as const)("executes private %s on the node", async (method, handlerName) => {
    const handler = vi.fn(async (_req, res) => res.end(JSON.stringify({ results: ["fixture"] })));
    const handlers = {
      searchHandler: vi.fn(),
      providerSearchHandler: vi.fn(),
      providerFeedHandler: vi.fn(),
      providerImportHandler: vi.fn(),
      [handlerName]: handler,
    };
    const execute = createV2RpcExecutor(handlers as never, {} as never, {} as never);
    const capability = method === "library.provider.import" ? "library.write" : "library.read";
    await expect(execute({
      method,
      capability: capability as never,
      params: { accessToken: "fixture-token" },
      ticketId: "fixture",
      limits: { maxResponseBytes: 1024, maxDurationMs: 30000 },
    })).resolves.toEqual({ results: ["fixture"] });
    expect(handler).toHaveBeenCalledOnce();
  });
});
