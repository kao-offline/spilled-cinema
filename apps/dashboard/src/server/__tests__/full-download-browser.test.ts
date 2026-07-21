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

  it("prefers LookMovie same-site stream manifests over protected backing CDN manifests", async () => {
    global.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);

      if (url.includes("lookmovie2.skin/e/")) {
        return new Response(`
          <script>
            jwplayer("vplayer").setup({
              sources: [
                { file: "https://cdn.auronetworkventures.online/server/hls3/01/14416/movie/master.txt" },
                { file: "https://blocked.premilkyway.com/hls/master.m3u8" },
                { file: "/stream/token/kjhhiuahiuhgihdf/1781805978/72084392/master.m3u8" }
              ]
            });
          </script>
        `, {
          status: 200,
          headers: {
            "Content-Type": "text/html; charset=utf-8",
          },
        });
      }

      if (url.includes("auronetworkventures.online") && url.includes("master.txt")) {
        return new Response(`#EXTM3U
#EXT-X-STREAM-INF:BANDWIDTH=800000
index-v1-a1.txt`, {
          status: 200,
          headers: {
            "Content-Type": "application/vnd.apple.mpegurl",
          },
        });
      }

      if (url.includes("auronetworkventures.online") && url.includes("index-v1-a1.txt")) {
        return new Response("#EXTM3U\n#EXTINF:10,\nseg-1-v1-a1.woff2", {
          status: 200,
          headers: {
            "Content-Type": "application/vnd.apple.mpegurl",
          },
        });
      }

      if (url.includes("lookmovie2.skin/stream/")) {
        if (url.includes("master.m3u8")) {
          return new Response(`#EXTM3U
#EXT-X-STREAM-INF:BANDWIDTH=100000
https://p16-ad-site-sign-sg.tiktokcdn.com/ad-site-i18n-sg/fake.image
#EXT-X-STREAM-INF:BANDWIDTH=800000
index-v1-a1.m3u8`, {
            status: 200,
            headers: {
              "Content-Type": "application/vnd.apple.mpegurl",
            },
          });
        }
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
      episodeId: "cineby-movie-1339713:s1e1",
      showTitle: "Obsession",
      seasonNumber: 1,
      episodeNumber: null,
      embedUrl: "https://lookmovie2.skin/e/puf0h2b8sb1y",
      streamCandidates: [
        {
          provider: "cineby",
          embedUrl: "https://lookmovie2.skin/e/puf0h2b8sb1y",
        },
      ],
    });

    expect(resolved.resolvedUrl).toBe("https://cdn.auronetworkventures.online/server/hls3/01/14416/movie/index-v1-a1.txt");
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

  it("extracts FileMoon-style escaped source lists for clean playback", async () => {
    global.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);

      if (url.includes("filemoon.sx")) {
        expect(init?.headers).toMatchObject({
          referer: "https://svetserialu.to/sources/filemoon/silo-first",
        });
        return new Response(`
          <script>
            player.setup({
              sources: [{"file":"https:\\/\\/moon-cdn.example\\/silo\\/master.m3u8?token=abc\\u0026expires=1"}]
            });
          </script>
        `, {
          status: 200,
          headers: {
            "Content-Type": "text/html; charset=utf-8",
          },
        });
      }

      if (url.includes("moon-cdn.example")) {
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
      episodeId: "silo-episode-1",
      showTitle: "Silo",
      seasonNumber: 1,
      episodeNumber: 1,
      embedUrl: "https://filemoon.sx/e/silo-first",
      streamCandidates: [
        {
          provider: "filemoon",
          embedUrl: "https://filemoon.sx/e/silo-first",
          sourcePageUrl: "https://svetserialu.to/sources/filemoon/silo-first",
        },
      ],
    });

    expect(resolved.resolvedUrl).toBe("https://moon-cdn.example/silo/master.m3u8?token=abc&expires=1");
  });

  it("normalizes protocol-relative FileMoon stream URLs from rotating hosts", async () => {
    global.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);

      if (url.includes("sb1254w9megshle.org")) {
        expect(init?.headers).toMatchObject({
          referer: "https://svetserialu.to/sources/filemoon/silo-first",
        });
        return new Response(`
          <script>
            window.playerOptions = {
              file: "//sb1254w9megshle.org/hls/silo/master.m3u8?sig=abc&amp;expires=1"
            };
          </script>
        `, {
          status: 200,
          headers: {
            "Content-Type": "text/html; charset=utf-8",
          },
        });
      }

      if (url.includes("/hls/silo/master.m3u8")) {
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
      episodeId: "silo-episode-1",
      showTitle: "Silo",
      seasonNumber: 1,
      episodeNumber: 1,
      embedUrl: "https://sb1254w9megshle.org/e/silo-first",
      streamCandidates: [
        {
          provider: "filemoon",
          embedUrl: "https://sb1254w9megshle.org/e/silo-first",
          sourcePageUrl: "https://svetserialu.to/sources/filemoon/silo-first",
        },
      ],
    });

    expect(resolved.resolvedUrl).toBe("https://sb1254w9megshle.org/hls/silo/master.m3u8?sig=abc&expires=1");
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
