import { afterEach, describe, expect, it, vi } from "vitest";
import { resolveBrowserDownload } from "../full-download";

const originalFetch = global.fetch;

afterEach(() => {
  global.fetch = originalFetch;
  vi.restoreAllMocks();
});

describe("browser download resolution", () => {
  it("unwraps wrapper player pages before resolving the stream URL", async () => {
    global.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);

      if (url.includes("2embed.to")) {
        return new Response('<iframe src="https://player.example/embed/abc"></iframe>', {
          status: 200,
          headers: {
            "Content-Type": "text/html; charset=utf-8",
          },
        });
      }

      if (url.includes("player.example")) {
        return new Response('<video src="https://cdn.example/video.m3u8"></video>', {
          status: 200,
          headers: {
            "Content-Type": "text/html; charset=utf-8",
          },
        });
      }

      throw new Error(`Unexpected fetch: ${url}`);
    }) as typeof fetch;

    const resolved = await resolveBrowserDownload({
      episodeId: "episode-1",
      showTitle: "Show",
      seasonNumber: 1,
      episodeNumber: 2,
      embedUrl: "https://2embed.to/embed/movie/123",
      streamCandidates: [
        {
          provider: "2embed",
          embedUrl: "https://2embed.to/embed/movie/123",
        },
      ],
    });

    expect(resolved.resolvedUrl).toBe("https://cdn.example/video.m3u8");
    expect(resolved.downloadUrl).toContain("/api/download-full/browser-file?");
  });

  it("tries JavaScript player links from server-list wrappers", async () => {
    global.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);

      if (url.includes("2embed.example")) {
        return new Response(`onclick="go('https://player.example/embed/abc')"`, {
          status: 200,
          headers: {
            "Content-Type": "text/html; charset=utf-8",
          },
        });
      }

      if (url.includes("player.example")) {
        return new Response(`file: "https://cdn.example/from-server-list.m3u8"`, {
          status: 200,
          headers: {
            "Content-Type": "text/html; charset=utf-8",
          },
        });
      }

      throw new Error(`Unexpected fetch: ${url}`);
    }) as typeof fetch;

    const resolved = await resolveBrowserDownload({
      episodeId: "episode-2",
      showTitle: "Show",
      seasonNumber: 1,
      episodeNumber: 3,
      embedUrl: "https://2embed.example/embed/movie/123",
    });

    expect(resolved.resolvedUrl).toBe("https://cdn.example/from-server-list.m3u8");
  });

  it("uses direct stream URLs from imported player state before probing providers", async () => {
    global.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("cdn.example")) {
        return new Response("#EXTM3U\n#EXTINF:10,\nsegment.ts", {
          status: 200,
          headers: {
            "Content-Type": "application/vnd.apple.mpegurl",
          },
        });
      }

      throw new Error(`Unexpected provider probe: ${url}`);
    }) as typeof fetch;

    const resolved = await resolveBrowserDownload({
      episodeId: "episode-4",
      showTitle: "Show",
      seasonNumber: 1,
      episodeNumber: 5,
      embedUrl: "https://provider.example/embed/abc",
      streamCandidates: [
        {
          provider: "provider",
          embedUrl: "https://provider.example/embed/abc",
          streamUrl: "https://cdn.example/direct.m3u8",
        },
      ],
    });

    expect(resolved.resolvedUrl).toBe("https://cdn.example/direct.m3u8");
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("follows Cloudnestra rcp pages and normalizes versioned HLS hosts", async () => {
    global.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);

      if (url.includes("vsembed.example")) {
        return new Response('<iframe src="https://cloudnestra.com/rcp/hash"></iframe>', {
          status: 200,
          headers: {
            "Content-Type": "text/html; charset=utf-8",
          },
        });
      }

      if (url.includes("cloudnestra.com/rcp/hash")) {
        return new Response('<script>const next="/prorcp/stream-hash";</script>', {
          status: 200,
          headers: {
            "Content-Type": "text/html; charset=utf-8",
          },
        });
      }

      if (url.includes("cloudnestra.com/prorcp/stream-hash")) {
        return new Response('new Playerjs({file:"https://tmstr4.{v1}/pl/token/master.m3u8"});', {
          status: 200,
          headers: {
            "Content-Type": "text/html; charset=utf-8",
          },
        });
      }

      if (url.includes("tmstr4.cloudnestra.com")) {
        return new Response("#EXTM3U\n#EXTINF:10,\nsegment.ts", {
          status: 200,
          headers: {
            "Content-Type": "application/vnd.apple.mpegurl",
          },
        });
      }

      throw new Error(`Unexpected fetch: ${url}`);
    }) as typeof fetch;

    const resolved = await resolveBrowserDownload({
      episodeId: "episode-5",
      showTitle: "Show",
      seasonNumber: 1,
      episodeNumber: 6,
      embedUrl: "https://vsembed.example/embed/movie?id=1",
    });

    expect(resolved.resolvedUrl).toBe("https://tmstr4.cloudnestra.com/pl/token/master.m3u8");
  });

  it("reports Byse download gates instead of a generic resolver failure", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);

      if (url.includes("/embed/playback")) {
        expect(init?.method).toBe("POST");
        expect(JSON.parse(String(init?.body))).toEqual({
          fingerprint: {
            token: "",
            viewer_id: "",
            device_id: "",
          },
        });
        return new Response(JSON.stringify({ error: "method not allowed" }), {
          status: 405,
          headers: {
            "Content-Type": "application/json",
          },
        });
      }

      if (url.includes("/downloads")) {
        return new Response(JSON.stringify({ recaptcha_required: true, options: [{ quality: "o" }] }), {
          status: 200,
          headers: {
            "Content-Type": "application/json",
          },
        });
      }

      throw new Error(`Unexpected fetch: ${url}`);
    });
    global.fetch = fetchMock as typeof fetch;

    await expect(
      resolveBrowserDownload({
        episodeId: "episode-3",
        showTitle: "Show",
        seasonNumber: 1,
        episodeNumber: 4,
        embedUrl: "https://bysekoze.com/e/abc123def456/",
      }),
    ).rejects.toThrow("download gate with reCAPTCHA");
    expect(fetchMock).toHaveBeenCalledWith(
      "https://bysekoze.com/api/videos/abc123def456/embed/playback",
      expect.objectContaining({ method: "POST" }),
    );
  });
});
