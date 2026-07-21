import { describe, expect, it } from "vitest";
import { isHostedSameOriginApiPath } from "../local-api";

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
