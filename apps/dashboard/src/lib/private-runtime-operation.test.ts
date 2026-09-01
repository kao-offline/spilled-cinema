import { describe, expect, it } from "vitest";
import { getPrivateRuntimeOperation } from "./private-runtime-operation";

describe("getPrivateRuntimeOperation", () => {
  it.each([
    ["/api/search", "library.read", "library.provider.search"],
    ["/api/provider-search", "library.read", "library.provider.search"],
    ["/api/provider-feed", "library.read", "library.provider.feed"],
    ["/api/provider-import", "library.write", "library.provider.import"],
  ] as const)("routes %s through the authenticated node", (path, capability, method) => {
    expect(getPrivateRuntimeOperation(path, { fixture: true })).toMatchObject({
      capability,
      method,
      params: { fixture: true },
    });
  });

  it("keeps legacy provider import routes authenticated", () => {
    expect(getPrivateRuntimeOperation("/api/import-bombuj", {})).toMatchObject({
      capability: "library.write",
      method: "library.provider.import",
      params: { moduleId: "bombuj" },
    });
    expect(getPrivateRuntimeOperation("/api/import-svetserialu", {})).toMatchObject({
      capability: "library.write",
      method: "library.provider.import",
      params: { moduleId: "svetserialu" },
    });
  });

  it("preserves the private playback route", () => {
    expect(getPrivateRuntimeOperation("/api/player/playback-resolve", { episodeId: "ep" })).toMatchObject({
      capability: "player.resolve",
      method: "player.playback.resolve",
    });
  });
});
