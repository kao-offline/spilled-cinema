import { describe, expect, it, vi } from "vitest";
import { buildProxyUrl, fetchBinary, fetchText } from "../browser-ffmpeg";

describe("buildProxyUrl", () => {
  it("keeps HLS asset requests on the selected node proxy", () => {
    vi.stubGlobal("window", {
      location: {
        origin: "https://spilled.overload.studio",
      },
    });

    const url = buildProxyUrl(
      "https://edge.example/hls/segment-1.ts",
      "https://bysekoze.com/e/abc123/",
      "segment-0001.ts",
      "https://spilled.overload.studio/api/node-proxy?node=https%3A%2F%2Ffetch-node.loca.lt&path=%2Fapi%2Fdownload-full%2Fbrowser-file%3Furl%3Dhttps%253A%252F%252Fedge.example%252Fmaster.m3u8",
    );

    const parsed = new URL(url);
    expect(parsed.origin).toBe("https://spilled.overload.studio");
    expect(parsed.pathname).toBe("/api/node-proxy");
    expect(parsed.searchParams.get("node")).toBe("https://fetch-node.loca.lt");
    expect(parsed.searchParams.get("path")).toContain("/api/download-full/browser-file?");
    expect(parsed.searchParams.get("path")).toContain(encodeURIComponent("https://edge.example/hls/segment-1.ts"));
  });

  it("uses the direct browser-file route for non-proxied runtimes", () => {
    vi.stubGlobal("window", {
      location: {
        origin: "https://spilled.overload.studio",
      },
    });

    const url = buildProxyUrl(
      "https://edge.example/hls/master.m3u8",
      "https://bysekoze.com/e/abc123/",
      "playlist.m3u8",
      "https://fetch-node.example/api/download-full/browser-file?url=old",
    );

    expect(url).toContain("https://fetch-node.example/api/download-full/browser-file?");
    expect(url).toContain("playlist.m3u8");
  });

  it("retries transient proxy failures while reading HLS assets", async () => {
    vi.useFakeTimers();
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response("temporary tunnel failure", { status: 502 }))
      .mockResolvedValueOnce(new Response(new Uint8Array([1, 2, 3]), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const pending = fetchBinary("https://spilled.overload.studio/api/node-proxy?path=segment-0006.ts");
    await vi.advanceTimersByTimeAsync(750);
    await expect(pending).resolves.toEqual(new Uint8Array([1, 2, 3]));
    expect(fetchMock).toHaveBeenCalledTimes(2);

    vi.useRealTimers();
  });

  it("retries transient proxy failures while reading playlists", async () => {
    vi.useFakeTimers();
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response("temporary tunnel failure", { status: 502 }))
      .mockResolvedValueOnce(new Response("#EXTM3U", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const pending = fetchText("https://spilled.overload.studio/api/node-proxy?path=playlist.m3u8");
    await vi.advanceTimersByTimeAsync(750);
    await expect(pending).resolves.toBe("#EXTM3U");
    expect(fetchMock).toHaveBeenCalledTimes(2);

    vi.useRealTimers();
  });
});
