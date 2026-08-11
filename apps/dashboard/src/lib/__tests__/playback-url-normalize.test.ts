import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { normalizePlaybackUrlForClient } from "../player-url-cache";

const DASHBOARD_ORIGIN = "https://spilled.test";

function stubClient(mobile: boolean) {
  vi.stubGlobal("window", {
    location: { origin: DASHBOARD_ORIGIN },
  });
  vi.stubGlobal("navigator", mobile
    ? {
        userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)",
        platform: "iPhone",
        maxTouchPoints: 5,
      }
    : {
        userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
        platform: "Win32",
        maxTouchPoints: 0,
      });
}

describe("normalizePlaybackUrlForClient", () => {
  beforeEach(() => {
    stubClient(false);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("leaves non-browser-file media URLs untouched", () => {
    expect(normalizePlaybackUrlForClient("https://cdn.example/video.m3u8")).toBe("https://cdn.example/video.m3u8");
  });

  it("leaves same-origin browser-file playback URLs untouched", () => {
    const url = `${DASHBOARD_ORIGIN}/api/download-full/browser-file?url=https%3A%2F%2Fcdn.example%2Fmaster.m3u8&playback=1`;
    expect(normalizePlaybackUrlForClient(url)).toBe(url);
  });

  it("rebases same-origin playback onto a reachable gateway node endpoint", () => {
    const url = `${DASHBOARD_ORIGIN}/api/download-full/browser-file?url=https%3A%2F%2Fcdn.example%2Fmaster.m3u8&playback=1`;
    expect(normalizePlaybackUrlForClient(url, "https://node-abc.loca.lt")).toBe(
      "https://node-abc.loca.lt/api/download-full/browser-file?url=https%3A%2F%2Fcdn.example%2Fmaster.m3u8&playback=1",
    );
  });

  it("routes local-runtime playback URLs through the dashboard proxy on any device", () => {
    expect(normalizePlaybackUrlForClient(
      "http://127.0.0.1:8787/api/download-full/browser-file?url=https%3A%2F%2Fcdn.example%2Fmaster.m3u8&playback=1",
    )).toBe(`${DASHBOARD_ORIGIN}/api/download-full/browser-file?url=https%3A%2F%2Fcdn.example%2Fmaster.m3u8&playback=1`);
  });

  it("keeps reachable node-tunnel playback URLs on desktop (node origin is reachable)", () => {
    const url = "https://node-abc.loca.lt/api/download-full/browser-file?url=https%3A%2F%2Fcdn.example%2Fmaster.m3u8&playback=1";
    expect(normalizePlaybackUrlForClient(url)).toBe(url);
  });

  it("keeps reachable node-tunnel playback URLs on mobile (do not reroute tunneled media through the Vercel proxy)", () => {
    stubClient(true);
    const url = "https://node-abc.trycloudflare.com/api/download-full/browser-file?url=https%3A%2F%2Fcdn.example%2Fmaster.m3u8&playback=1";
    expect(normalizePlaybackUrlForClient(url)).toBe(url);
  });

  it("repairs stale node-id-prefixed browser-file URLs on any device", () => {
    const stale = "spillednode_abc/api/download-full/browser-file?url=https%3A%2F%2Fcdn.example%2Fmaster.m3u8&playback=1";
    expect(normalizePlaybackUrlForClient(stale)).toBe(
      `${DASHBOARD_ORIGIN}/api/download-full/browser-file?url=https%3A%2F%2Fcdn.example%2Fmaster.m3u8&playback=1`,
    );
  });
});
