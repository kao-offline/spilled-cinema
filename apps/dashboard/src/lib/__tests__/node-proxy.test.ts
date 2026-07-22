import { describe, expect, it } from "vitest";
// @ts-expect-error The Vercel API route is plain JavaScript.
import { buildNodeMediaUrl, isAllowedNodeOrigin, isAllowedNodePath, rewriteNodePlaylistUrls } from "../../../api/node-proxy.js";

describe("node proxy allowlist", () => {
  it("allows public localtunnel fetch node origins", () => {
    expect(isAllowedNodeOrigin("https://fetch-node.loca.lt")).toBe(true);
    expect(isAllowedNodeOrigin("https://fetch-node.trycloudflare.com")).toBe(true);
    expect(isAllowedNodeOrigin("http://fetch-node.loca.lt")).toBe(false);
    expect(isAllowedNodeOrigin("https://example.com")).toBe(false);
  });

  it("allows public fetch server routes used by hosted search", () => {
    expect(isAllowedNodePath("/api/search")).toBe(true);
    expect(isAllowedNodePath("/api/provider-search")).toBe(true);
    expect(isAllowedNodePath("/api/provider-feed")).toBe(true);
    expect(isAllowedNodePath("/api/import-svetserialu")).toBe(true);
    expect(isAllowedNodePath("/api/player/resolve")).toBe(true);
    expect(isAllowedNodePath("/api/player/clean-resolve")).toBe(true);
    expect(isAllowedNodePath("/api/player/playback-resolve")).toBe(true);
  });

  it("rejects private node routes", () => {
    expect(isAllowedNodePath("/api/node/admin/status")).toBe(false);
    expect(isAllowedNodePath("/api/node/private/library")).toBe(false);
  });

  it("keeps nested HLS requests on the selected fetch node", () => {
    const child = "/api/download-full/browser-file?url=https%3A%2F%2Fcdn.example%2Fsegment.ts&name=movie.m3u8";
    const rewritten = rewriteNodePlaylistUrls(
      `#EXTM3U\n#EXT-X-KEY:METHOD=AES-128,URI="${child}"\n#EXTINF:2,\n${child}`,
      "https://fetch-node.trycloudflare.com",
      "https://spilled.overload.studio",
    );
    const paths = (rewritten as string).split("\n").filter((line: string) => line.includes("node-proxy"));
    expect(paths).toHaveLength(2);
    expect(rewritten).toContain("node=https%3A%2F%2Ffetch-node.trycloudflare.com");
    expect(rewritten).toContain("path=%2Fapi%2Fdownload-full%2Fbrowser-file%3Furl%3D");
  });

  it("streams media directly from CORS-capable Cloudflare nodes", () => {
    expect(buildNodeMediaUrl(
      "https://fetch-node.trycloudflare.com",
      "/api/download-full/browser-file?url=https%3A%2F%2Fcdn.example%2Fsegment.ts",
      "https://spilled.overload.studio",
    )).toBe("https://fetch-node.trycloudflare.com/api/download-full/browser-file?url=https%3A%2F%2Fcdn.example%2Fsegment.ts");

    expect(buildNodeMediaUrl(
      "https://fetch-node.loca.lt",
      "/api/download-full/browser-file?url=https%3A%2F%2Fcdn.example%2Fsegment.ts",
      "https://spilled.overload.studio",
    )).toContain("/api/node-proxy?node=");
  });
});
