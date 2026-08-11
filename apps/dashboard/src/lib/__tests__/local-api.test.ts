import { describe, expect, it } from "vitest";
import { getV2GatewayOperation, isHostedSameOriginApiPath } from "../local-api";

describe("isHostedSameOriginApiPath", () => {
  it("does not use hosted Vercel functions for browser download routes", () => {
    expect(isHostedSameOriginApiPath("/api/download-full/browser-start")).toBe(false);
    expect(isHostedSameOriginApiPath("/api/download-full/browser-start?episodeId=123")).toBe(false);
    expect(isHostedSameOriginApiPath("/api/download-full/browser-file")).toBe(false);
  });

  it("still restricts unrelated routes", () => {
    expect(isHostedSameOriginApiPath("/api/search")).toBe(false);
    expect(isHostedSameOriginApiPath("/api/artwork/search")).toBe(true);
  });
});

describe("authenticated mobile gateway operations", () => {
  it.each([
    ["/api/provider-search", "provider.search", "provider.search"],
    ["/api/provider-feed", "provider.feed", "provider.feed"],
    ["/api/provider-import", "provider.import", "provider.import"],
    ["/api/player/playback-resolve", "player.resolve", "player.playback.resolve"],
  ])("maps %s to a private-session-capable RPC", (path, capability, method) => {
    expect(getV2GatewayOperation(path, { fixture: true })).toMatchObject({ capability, method });
  });
});
