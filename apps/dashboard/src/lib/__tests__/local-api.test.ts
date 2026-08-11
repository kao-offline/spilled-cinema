import { describe, expect, it } from "vitest";
import { isHostedSameOriginApiPath, rebaseGatewayMediaUrls } from "../local-api";

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

describe("rebaseGatewayMediaUrls", () => {
  it("stamps browser-file playback with the selected node endpoint", () => {
    expect(rebaseGatewayMediaUrls({
      playbackUrl: "https://spilled.overload.studio/api/download-full/browser-file?url=https%3A%2F%2Fcdn.example%2Fvideo.mp4&playback=1",
    }, "https://node-abc.loca.lt")).toEqual({
      playbackUrl: "https://node-abc.loca.lt/api/download-full/browser-file?url=https%3A%2F%2Fcdn.example%2Fvideo.mp4&playback=1",
    });
  });
});
