import { afterEach, describe, expect, it, vi } from "vitest";
import { resolvePlaybackStream } from "../full-download";

const originalFetch = global.fetch;

afterEach(() => {
  global.fetch = originalFetch;
  vi.restoreAllMocks();
});

describe("playback resolver", () => {
  it("resolves direct HLS players into proxied playback URLs", async () => {
    global.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("cdn.example/master.m3u8")) {
        return new Response("#EXTM3U\n#EXT-X-VERSION:3", {
          status: 200,
          headers: { "Content-Type": "application/vnd.apple.mpegurl" },
        });
      }
      throw new Error(`Unexpected fetch: ${url}`);
    }) as typeof fetch;

    const resolved = await resolvePlaybackStream({
      episodeId: "episode-1",
      activePlayerAlias: "direct",
      players: [{
        alias: "direct",
        provider: "provider",
        label: "Provider",
        sourcePageUrl: "https://provider.example/watch",
        embedUrl: "https://provider.example/embed",
        streamUrl: "https://cdn.example/master.m3u8",
      }],
    });

    expect(resolved.playerAlias).toBe("direct");
    expect(resolved.resolvedUrl).toBe("https://cdn.example/master.m3u8");
    expect(resolved.playbackUrl).toContain("/api/download-full/browser-file?");
    expect(resolved.streamType).toBe("hls");
  });

  it("tries the next player when the selected provider cannot resolve", async () => {
    global.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);

      if (url.includes("bad.example")) {
        return new Response("<html>No stream here</html>", {
          status: 404,
          headers: { "Content-Type": "text/html; charset=utf-8" },
        });
      }

      if (url.includes("good.example")) {
        return new Response('file: "https://cdn.example/video.mp4"', {
          status: 200,
          headers: { "Content-Type": "text/html; charset=utf-8" },
        });
      }

      if (url.includes("cdn.example/video.mp4")) {
        return new Response("ok", {
          status: 206,
          headers: { "Content-Type": "video/mp4", "Content-Range": "bytes 0-1/100" },
        });
      }

      throw new Error(`Unexpected fetch: ${url}`);
    }) as typeof fetch;

    const resolved = await resolvePlaybackStream({
      episodeId: "episode-2",
      activePlayerAlias: "bad",
      players: [
        {
          alias: "bad",
          provider: "bad",
          label: "Bad",
          sourcePageUrl: "https://bad.example/watch",
          embedUrl: "https://bad.example/embed",
        },
        {
          alias: "good",
          provider: "good",
          label: "Good",
          sourcePageUrl: "https://good.example/watch",
          embedUrl: "https://good.example/embed",
        },
      ],
    });

    expect(resolved.playerAlias).toBe("good");
    expect(resolved.resolvedUrl).toBe("https://cdn.example/video.mp4");
    expect(resolved.streamType).toBe("mp4");
  });

  it("does not fall back across audio language groups", async () => {
    global.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);

      if (url.includes("english.example")) {
        return new Response("<html>No stream here</html>", {
          status: 200,
          headers: { "Content-Type": "text/html; charset=utf-8" },
        });
      }

      if (url.includes("czech.example")) {
        return new Response('file: "https://cdn.example/czech.mp4"', {
          status: 200,
          headers: { "Content-Type": "text/html; charset=utf-8" },
        });
      }

      if (url.includes("cdn.example/czech.mp4")) {
        return new Response("ok", {
          status: 206,
          headers: { "Content-Type": "video/mp4", "Content-Range": "bytes 0-1/100" },
        });
      }

      throw new Error(`Unexpected fetch: ${url}`);
    }) as typeof fetch;

    await expect(resolvePlaybackStream({
      episodeId: "episode-language",
      activePlayerAlias: "english",
      players: [
        {
          alias: "english",
          provider: "english-provider",
          label: "English",
          language: "English audio + CZ/SK subtitles",
          sourcePageUrl: "https://source.example/watch",
          embedUrl: "https://english.example/embed",
        },
        {
          alias: "czech",
          provider: "czech-provider",
          label: "Czech",
          language: "Czech audio",
          sourcePageUrl: "https://source.example/watch",
          embedUrl: "https://czech.example/embed",
        },
      ],
    })).rejects.toMatchObject({
      message: expect.not.stringContaining("czech-provider"),
    });
  });

  it("extracts protocol-relative Mixdrop-style MP4 assignments", async () => {
    global.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("mixdrop.example")) {
        return new Response('<script>MDCore.wurl="//cdn.mixdrop.example/video-720.mp4?token=abc";</script>', {
          status: 200,
          headers: { "Content-Type": "text/html; charset=utf-8" },
        });
      }
      throw new Error(`Unexpected fetch: ${url}`);
    }) as typeof fetch;

    const resolved = await resolvePlaybackStream({
      episodeId: "episode-mixdrop",
      activePlayerAlias: "mixdrop",
      players: [{
        alias: "mixdrop",
        provider: "mixdrop",
        label: "Mixdrop",
        sourcePageUrl: "https://source.example/watch",
        embedUrl: "https://mixdrop.example/e/abc",
      }],
    });

    expect(resolved.resolvedUrl).toBe("https://cdn.mixdrop.example/video-720.mp4?token=abc");
    expect(resolved.streamType).toBe("mp4");
  });

  it("tries alternate Mixdrop domains when the imported domain is blocked", async () => {
    global.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("mixdrop.ag")) {
        return new Response("<html>blocked</html>", {
          status: 403,
          headers: { "Content-Type": "text/html; charset=utf-8" },
        });
      }
      if (url.includes("mixdrop.co")) {
        return new Response('<script>MDCore.wurl="//cdn.mixdrop.example/alternate.mp4";</script>', {
          status: 200,
          headers: { "Content-Type": "text/html; charset=utf-8" },
        });
      }
      if (url.includes("cdn.mixdrop.example/alternate.mp4")) {
        return new Response("ok", {
          status: 206,
          headers: { "Content-Type": "video/mp4", "Content-Range": "bytes 0-1/100" },
        });
      }
      throw new Error(`Unexpected fetch: ${url}`);
    }) as typeof fetch;

    const resolved = await resolvePlaybackStream({
      episodeId: "episode-mixdrop-alt",
      activePlayerAlias: "mixdrop",
      players: [{
        alias: "mixdrop",
        provider: "mixdrop",
        label: "Mixdrop",
        sourcePageUrl: "https://source.example/watch",
        embedUrl: "https://mixdrop.ag/e/abc",
      }],
    });

    expect(resolved.resolvedUrl).toBe("https://cdn.mixdrop.example/alternate.mp4");
  });

  it("extracts FileMoon-style source arrays from external packed player scripts", async () => {
    global.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("filemoon.example/e/abc")) {
        return new Response('<script src="/assets/player.js"></script>', {
          status: 200,
          headers: { "Content-Type": "text/html; charset=utf-8" },
        });
      }
      if (url.includes("filemoon.example/assets/player.js")) {
        return new Response('jwplayer("vplayer").setup({sources:[{file:"/hls/abc/master.m3u8",type:"hls"}]});', {
          status: 200,
          headers: { "Content-Type": "application/javascript" },
        });
      }
      if (url.includes("filemoon.example/hls/abc/master.m3u8")) {
        return new Response("#EXTM3U\n#EXT-X-VERSION:3", {
          status: 200,
          headers: { "Content-Type": "application/vnd.apple.mpegurl" },
        });
      }
      throw new Error(`Unexpected fetch: ${url}`);
    }) as typeof fetch;

    const resolved = await resolvePlaybackStream({
      episodeId: "episode-filemoon",
      activePlayerAlias: "filemoon",
      players: [{
        alias: "filemoon",
        provider: "filemoon",
        label: "FileMoon",
        sourcePageUrl: "https://svetserialu.to/sources/filemoon/abc",
        embedUrl: "https://filemoon.example/e/abc",
      }],
    });

    expect(resolved.resolvedUrl).toBe("https://filemoon.example/hls/abc/master.m3u8");
    expect(resolved.streamType).toBe("hls");
  });

  it("treats sb*.org embed shells as Byse encrypted playback hosts", async () => {
    let requestedBysePlayback = false;
    global.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("sb1254w9megshle.org/api/videos/abc123/embed/playback")) {
        requestedBysePlayback = true;
        return new Response("{}", {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      if (url.includes("sb1254w9megshle.org/e/abc123")) {
        return new Response("<html><title>Byse Frontend</title></html>", {
          status: 200,
          headers: { "Content-Type": "text/html; charset=utf-8" },
        });
      }
      throw new Error(`Unexpected fetch: ${url}`);
    }) as typeof fetch;

    await expect(resolvePlaybackStream({
      episodeId: "episode-byse-shell",
      activePlayerAlias: "byse-shell",
      players: [{
        alias: "byse-shell",
        provider: "filemoon",
        label: "File",
        sourcePageUrl: "https://svetserialu.to/watch",
        embedUrl: "https://sb1254w9megshle.org/e/abc123",
      }],
    })).rejects.toBeTruthy();

    expect(requestedBysePlayback).toBe(true);
  });

  it("extracts Vidmoly-style base64 encoded source payloads", async () => {
    const encoded = Buffer.from('sources:[{file:"https://cdn.vidmoly.example/stream/index.m3u8",type:"hls"}]', "utf8").toString("base64");
    global.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("vidmoly.example")) {
        return new Response(`<script>const payload = atob("${encoded}");</script>`, {
          status: 200,
          headers: { "Content-Type": "text/html; charset=utf-8" },
        });
      }
      if (url.includes("cdn.vidmoly.example")) {
        return new Response("#EXTM3U\n#EXT-X-VERSION:3", {
          status: 200,
          headers: { "Content-Type": "application/vnd.apple.mpegurl" },
        });
      }
      throw new Error(`Unexpected fetch: ${url}`);
    }) as typeof fetch;

    const resolved = await resolvePlaybackStream({
      episodeId: "episode-vidmoly",
      activePlayerAlias: "vidmoly",
      players: [{
        alias: "vidmoly",
        provider: "vidmoly",
        label: "Vidmoly",
        sourcePageUrl: "https://source.example/watch",
        embedUrl: "https://vidmoly.example/embed-abc.html",
      }],
    });

    expect(resolved.resolvedUrl).toBe("https://cdn.vidmoly.example/stream/index.m3u8");
    expect(resolved.streamType).toBe("hls");
  });

  it("resolves 2Embed wrappers through the Xpass playlist child instead of the self iframe", async () => {
    global.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("www.2embed.cc/embed/tt0499549")) {
        return new Response(`
          <iframe src="https://www.2embed.cc/embed/tt0499549"></iframe>
          <iframe id="iframesrc" src="about:blank" data-src="https://streamsrcs.2embed.cc/swish?id=abc"></iframe>
          <a onclick="go('https://streamsrcs.2embed.cc/xps?imdb=tt0499549')">Xps</a>
        `, {
          status: 200,
          headers: { "Content-Type": "text/html; charset=utf-8" },
        });
      }
      if (url.includes("streamsrcs.2embed.cc/xps.js")) {
        return new Response(`var myUrl = $('#framesrc').attr('src'); $('#framesrc').attr('src', "https://play.xpass.top/e/movie/" + myUrl);`, {
          status: 200,
          headers: { "Content-Type": "application/javascript" },
        });
      }
      if (url.includes("streamsrcs.2embed.cc/xps")) {
        return new Response(`
          <iframe id="framesrc" src="tt0499549?autostart=true"></iframe>
          <script src="./xps.js"></script>
        `, {
          status: 200,
          headers: { "Content-Type": "text/html; charset=utf-8" },
        });
      }
      if (url.includes("play.xpass.top/e/movie/tt0499549")) {
        return new Response(`var data={"playlist":"/mdata/movie/playlist.json"};`, {
          status: 200,
          headers: { "Content-Type": "text/html; charset=utf-8" },
        });
      }
      if (url.includes("play.xpass.top/mdata/movie/playlist.json")) {
        return new Response(`{"playlist":[{"sources":[{"file":"https://cdn.xpass.example/master.m3u8","type":"hls"}]}]}`, {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      if (url.includes("cdn.xpass.example/master.m3u8")) {
        return new Response("#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=1000\nvariant.m3u8", {
          status: 200,
          headers: { "Content-Type": "application/vnd.apple.mpegurl" },
        });
      }
      if (url.includes("cdn.xpass.example/variant.m3u8")) {
        return new Response("#EXTM3U\n#EXT-X-VERSION:3", {
          status: 200,
          headers: { "Content-Type": "application/vnd.apple.mpegurl" },
        });
      }
      throw new Error(`Unexpected fetch: ${url}`);
    }) as typeof fetch;

    const resolved = await resolvePlaybackStream({
      episodeId: "episode-2embed",
      activePlayerAlias: "2embed",
      players: [{
        alias: "2embed",
        provider: "2embed",
        label: "2Embed",
        sourcePageUrl: "https://bombuj.si/online-film-avatar",
        embedUrl: "https://www.2embed.cc/embed/tt0499549",
      }],
    });

    expect(resolved.resolvedUrl).toBe("https://cdn.xpass.example/variant.m3u8");
    expect(resolved.refererUrl).toBe("https://play.xpass.top/e/movie/tt0499549?autostart=true");
    expect(resolved.streamType).toBe("hls");
  });

  it("classifies Streamtape get_video URLs as MP4 playback", async () => {
    global.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("streamtape.example")) {
        return new Response('<script>document.getElementById("robotlink").innerHTML = "/get_video?id=abc&expires=123&token=xyz";</script>', {
          status: 200,
          headers: { "Content-Type": "text/html; charset=utf-8" },
        });
      }
      if (url.includes("streamtape.com/get_video")) {
        return new Response("ok", {
          status: 206,
          headers: { "Content-Type": "video/mp4", "Content-Range": "bytes 0-1/100" },
        });
      }
      throw new Error(`Unexpected fetch: ${url}`);
    }) as typeof fetch;

    const resolved = await resolvePlaybackStream({
      episodeId: "episode-streamtape",
      activePlayerAlias: "streamtape",
      players: [{
        alias: "streamtape",
        provider: "streamtape",
        label: "Streamtape",
        sourcePageUrl: "https://source.example/watch",
        embedUrl: "https://streamtape.example/e/abc",
      }],
    });

    expect(resolved.resolvedUrl).toBe("https://streamtape.com/get_video?id=abc&expires=123&token=xyz");
    expect(resolved.playbackUrl).toContain("episode-streamtape.mp4");
    expect(resolved.streamType).toBe("mp4");
  });

  it("decodes the current VOE application/json payload after its domain redirect", async () => {
    const streamUrl = "https://voe-cdn.example/engine/hls2/avatar/master.m3u8";
    const jsonBase64 = Buffer.from(JSON.stringify({ source: streamUrl, title: "Avatar" })).toString("base64");
    const shifted = Buffer.from(
      Uint8Array.from([...jsonBase64].reverse(), (character) => character.charCodeAt(0) + 3),
    ).toString("base64");
    const encoded = shifted.replace(/[a-z]/gi, (character) => {
      const code = character.charCodeAt(0);
      const base = code <= 90 ? 65 : 97;
      return String.fromCharCode(base + ((code - base + 13) % 26));
    });

    global.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === "https://voe.sx/e/avatar") {
        return new Response("<script>window.location.href = 'https://voe-mirror.example/e/avatar';</script>", {
          status: 200,
          headers: { "Content-Type": "text/html; charset=utf-8" },
        });
      }
      if (url === "https://voe-mirror.example/e/avatar") {
        return new Response(`<script>var source='https://test-videos.co.uk/Big_Buck_Bunny.mp4'</script><script type="application/json">${JSON.stringify([encoded])}</script>`, {
          status: 200,
          headers: { "Content-Type": "text/html; charset=utf-8" },
        });
      }
      if (url === streamUrl) {
        return new Response("#EXTM3U\n#EXT-X-VERSION:3", {
          status: 200,
          headers: { "Content-Type": "application/vnd.apple.mpegurl" },
        });
      }
      throw new Error(`Unexpected fetch: ${url}`);
    }) as typeof fetch;

    const resolved = await resolvePlaybackStream({
      episodeId: "episode-voe",
      activePlayerAlias: "voe",
      players: [{
        alias: "voe",
        provider: "voe2.sx",
        label: "VOE",
        sourcePageUrl: "https://www.bombuj.si/film/avatar",
        embedUrl: "https://voe.sx/e/avatar",
      }],
    });

    expect(resolved.resolvedUrl).toBe(streamUrl);
    expect(resolved.refererUrl).toBe("https://voe-mirror.example/e/avatar");
    expect(resolved.streamType).toBe("hls");
  });

  it("refreshes expired Streamtape direct URLs from the embed page", async () => {
    vi.spyOn(Date, "now").mockReturnValue(2_000_000 * 1000);

    global.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("streamtape.example/e/fresh")) {
        return new Response('<script>document.getElementById("robotlink").innerHTML = "/get_video?id=fresh&expires=2000200&token=new";</script>', {
          status: 200,
          headers: { "Content-Type": "text/html; charset=utf-8" },
        });
      }
      if (url.includes("id=expired")) {
        throw new Error("Expired direct URL should not be reused");
      }
      if (url.includes("streamtape.com/get_video") && url.includes("id=fresh")) {
        return new Response("ok", {
          status: 206,
          headers: { "Content-Type": "video/mp4", "Content-Range": "bytes 0-1/100" },
        });
      }
      throw new Error(`Unexpected fetch: ${url}`);
    }) as typeof fetch;

    const resolved = await resolvePlaybackStream({
      episodeId: "episode-streamtape-expired",
      activePlayerAlias: "streamtape",
      players: [{
        alias: "streamtape",
        provider: "streamtape",
        label: "Streamtape",
        embedUrl: "https://streamtape.example/e/fresh",
        streamUrl: "https://streamtape.com/get_video?id=expired&expires=1999900&token=old",
      }],
    });

    expect(resolved.resolvedUrl).toBe("https://streamtape.com/get_video?id=fresh&expires=2000200&token=new");
    expect(resolved.streamType).toBe("mp4");
  });

  it("extracts VidKing sources into universal playback", async () => {
    let sourceRequestUrl = "";
    let sourceRequestHeaders: HeadersInit | undefined;
    global.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("db.speedracelight.com/3/movie/550")) {
        return Response.json({
          title: "Fight Club",
          release_date: "1999-10-15",
          external_ids: { imdb_id: "tt0137523" },
        });
      }
      if (url.includes("api.speedracelight.com/seed?mediaId=550")) {
        return Response.json({ seed: "fixture-seed-2026", ttlMs: 30_000 });
      }
      if (url.includes("api.speedracelight.com/cdn/sources-with-title")) {
        sourceRequestUrl = url;
        sourceRequestHeaders = init?.headers;
        return new Response("rrZnGdox-VZ30uVibLhIfMvgyoE4wAkDGNK5GLW7268EnnRa4zKhUofQEl9kWoHKqbzG0WAp5HzoY1IrrmmOl4ux1be0OoiaTMqyD6LnE9UVBVpf5A", {
          status: 200,
          headers: { "Content-Type": "text/plain; charset=utf-8" },
        });
      }
      if (url === "https://cdn.example/vidking/master.m3u8") {
        return new Response("#EXTM3U\n#EXT-X-VERSION:3", {
          status: 200,
          headers: { "Content-Type": "application/vnd.apple.mpegurl" },
        });
      }
      throw new Error(`Unexpected fetch: ${url}`);
    }) as typeof fetch;

    const resolved = await resolvePlaybackStream({
      episodeId: "episode-vidking",
      activePlayerAlias: "vidking-player",
      players: [{
        alias: "vidking-player",
        provider: "vidking",
        label: "VidKing",
        sourcePageUrl: "https://www.vidking.net/embed/movie/550",
        embedUrl: "https://www.vidking.net/embed/movie/550",
      }],
    });

    expect(resolved.resolvedUrl).toBe("https://cdn.example/vidking/master.m3u8");
    expect(resolved.playbackUrl).toContain("/api/download-full/browser-file?");
    expect(resolved.streamType).toBe("hls");
    expect(sourceRequestUrl).toContain("enc=2");
    expect(sourceRequestUrl).toContain("seed=fixture-seed-2026");
    expect(new Headers(sourceRequestHeaders).get("origin")).toBe("https://www.vidking.net");
  });

  it("rejects reachable embeds that do not expose a direct stream", async () => {
    global.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("embed.example")) {
        return new Response("<html><body>provider player</body></html>", {
          status: 200,
          headers: { "Content-Type": "text/html; charset=utf-8" },
        });
      }
      throw new Error(`Unexpected fetch: ${url}`);
    }) as typeof fetch;

    await expect(resolvePlaybackStream({
      episodeId: "episode-3",
      activePlayerAlias: "embed",
      players: [{
        alias: "embed",
        provider: "embed",
        label: "Embed",
        sourcePageUrl: "https://source.example/watch",
        embedUrl: "https://embed.example/player",
      }],
    })).rejects.toMatchObject({
      message: expect.stringContaining("did not expose a direct MP4/HLS/DASH stream"),
    });
  });
});
