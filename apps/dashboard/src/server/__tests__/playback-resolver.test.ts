import { afterEach, describe, expect, it, vi } from "vitest";
import { buildVidkingEquivalentUrl, resolvePlaybackStream, setPlaybackProxyEndpointUrl } from "../full-download";

const originalFetch = global.fetch;

afterEach(() => {
  global.fetch = originalFetch;
  setPlaybackProxyEndpointUrl(undefined);
  vi.restoreAllMocks();
});

describe("playback resolver", () => {
  it("maps unavailable TMDB wrapper players to a playable VidKing equivalent", () => {
    expect(buildVidkingEquivalentUrl("https://vidlink.pro/movie/19995?sub_file=x")).toBe("https://www.vidking.net/embed/movie/19995");
    expect(buildVidkingEquivalentUrl("https://moviesapi.club/movie/1318447")).toBe("https://www.vidking.net/embed/movie/1318447");
    expect(buildVidkingEquivalentUrl("https://primewire.zip/embed/movie?tmdb=157336")).toBe("https://www.vidking.net/embed/movie/157336");
  });

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
    expect(resolved.playbackUrl).toContain("playback=1");
    expect(resolved.streamType).toBe("hls");
  });

  it("uses the node's live endpoint for gateway playback", async () => {
    setPlaybackProxyEndpointUrl("https://private-node.example/");
    global.fetch = vi.fn(async () => new Response("#EXTM3U\n#EXT-X-VERSION:3", {
      status: 200,
      headers: { "Content-Type": "application/vnd.apple.mpegurl" },
    })) as typeof fetch;
    const resolved = await resolvePlaybackStream({
      episodeId: "private-episode",
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
    expect(resolved.playbackUrl).toMatch(/^https:\/\/private-node\.example\/api\/download-full\/browser-file\?/);
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

  it("uses another language only after the selected language cannot resolve", async () => {
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

    const resolved = await resolvePlaybackStream({
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
    });

    expect(resolved.playerAlias).toBe("czech");
    expect(resolved.resolvedUrl).toBe("https://cdn.example/czech.mp4");
  });

  it("extracts protocol-relative Mixdrop-style MP4 assignments", async () => {
    global.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("cdn.mixdrop.example/video-720.mp4")) {
        expect(new Headers(init?.headers).get("referer")).toBe("https://miiiixdrop.net/e/abc");
        return new Response("video", {
          status: 206,
          headers: { "Content-Type": "video/mp4", "Content-Range": "bytes 0-4/100" },
        });
      }
      if (url.includes("mixdrop.ag")) {
        const response = new Response('<script>MDCore.wurl="//cdn.mixdrop.example/video-720.mp4?token=abc";</script>', {
          status: 200,
          headers: { "Content-Type": "text/html; charset=utf-8" },
        });
        Object.defineProperty(response, "url", { value: "https://miiiixdrop.net/e/abc" });
        return response;
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
        embedUrl: "https://mixdrop.ag/e/abc",
      }],
    });

    expect(resolved.resolvedUrl).toBe("https://cdn.mixdrop.example/video-720.mp4?token=abc");
    expect(resolved.streamType).toBe("mp4");
  });

  it("uses the f16px playback endpoint even when its metadata endpoint would report 404", async () => {
    global.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("/api/videos/filemoon-code/embed/playback")) {
        return new Response("{}", {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      if (url === "https://f16px.com/e/filemoon-code") {
        return new Response("<html></html>", {
          status: 200,
          headers: { "Content-Type": "text/html" },
        });
      }
      throw new Error(`Unexpected fetch: ${url}`);
    }) as typeof fetch;

    await expect(resolvePlaybackStream({
      episodeId: "filemoon-movie",
      activePlayerAlias: "filemoon",
      players: [{
        alias: "filemoon",
        provider: "filemoon",
        embedUrl: "https://f16px.com/e/filemoon-code",
      }],
    })).rejects.toThrow();

    const requestedUrls = vi.mocked(global.fetch).mock.calls.map(([input]) => String(input));
    expect(requestedUrls).not.toContain("https://f16px.com/api/videos/filemoon-code");
    expect(requestedUrls).toContain("https://f16px.com/api/videos/filemoon-code/embed/playback");
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

  it("recognizes rotating Byse hosts from their frontend shell", async () => {
    let requestedBysePlayback = false;
    global.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === "https://rotating-file-host.example/e/abc123") {
        return new Response("<html><title>Byse Frontend</title><script>document.documentElement.classList.add('video-embed-mode')</script></html>", {
          status: 200,
          headers: { "Content-Type": "text/html; charset=utf-8" },
        });
      }
      if (url === "https://rotating-file-host.example/api/videos/abc123/embed/playback") {
        requestedBysePlayback = true;
        return new Response("{}", {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      throw new Error(`Unexpected fetch: ${url}`);
    }) as typeof fetch;

    await expect(resolvePlaybackStream({
      episodeId: "episode-rotating-byse-shell",
      activePlayerAlias: "filemoon",
      players: [{
        alias: "filemoon",
        provider: "filemoon",
        embedUrl: "https://rotating-file-host.example/e/abc123",
      }],
    })).rejects.toBeTruthy();

    expect(requestedBysePlayback).toBe(true);
  });

  it("extracts Vidmoly-style base64 encoded source payloads", async () => {
    const encoded = Buffer.from('sources:[{file:"https://cdn.vidmoly.example/stream/index.m3u8",type:"hls"}]', "utf8").toString("base64");
    global.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("cdn.vidmoly.example")) {
        return new Response("#EXTM3U\n#EXT-X-VERSION:3", {
          status: 200,
          headers: { "Content-Type": "application/vnd.apple.mpegurl" },
        });
      }
      if (url.includes("vidmoly.example")) {
        return new Response(`<script>const payload = atob("${encoded}");</script>`, {
          status: 200,
          headers: { "Content-Type": "text/html; charset=utf-8" },
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

    expect(resolved.resolvedUrl).toBe("https://cdn.xpass.example/master.m3u8");
    expect(resolved.refererUrl).toBe("https://play.xpass.top/e/movie/tt0499549?autostart=true");
    expect(resolved.streamType).toBe("hls");
  });

  it("resolves a persisted direct Xpass embed through its current playlist", async () => {
    global.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("play.xpass.top/e/movie/tt8368406")) {
        return new Response('var data={"playlist":"/mdata/vivarium/playlist.json"};', {
          status: 200,
          headers: { "Content-Type": "text/html; charset=utf-8" },
        });
      }
      if (url.includes("play.xpass.top/mdata/vivarium/playlist.json")) {
        return new Response('{"playlist":[{"sources":[{"file":"https://cdn.xpass.example/vivarium/master.m3u8","type":"hls"}]}]}', {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      if (url.includes("cdn.xpass.example/vivarium/master.m3u8")) {
        return new Response("#EXTM3U\n#EXT-X-VERSION:3", {
          status: 200,
          headers: { "Content-Type": "application/vnd.apple.mpegurl" },
        });
      }
      throw new Error(`Unexpected fetch: ${url}`);
    }) as typeof fetch;

    const resolved = await resolvePlaybackStream({
      episodeId: "vivarium-movie",
      activePlayerAlias: "2embed",
      players: [{
        alias: "2embed",
        provider: "2embed",
        embedUrl: "https://play.xpass.top/e/movie/tt8368406?autostart=true",
        streamUrl: "https://p16-sg.tiktokcdn.com/obj/tos-alisg-avt-0068/avatar-id",
        streamType: "hls",
      }],
    });

    expect(resolved.resolvedUrl).toBe("https://cdn.xpass.example/vivarium/master.m3u8");
    expect(resolved.streamType).toBe("hls");
  });

  it("prefers Xpass VIP mirrors over broken TIK mirrors", async () => {
    global.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("play.xpass.top/e/movie/tt8368406")) {
        return new Response(`var data={"playlist":"/mdata/tik/playlist.json"}; var backups=[{"url":"/vip/working/playlist.json"}];`, {
          status: 200,
          headers: { "Content-Type": "text/html; charset=utf-8" },
        });
      }
      if (url.includes("play.xpass.top/vip/working/playlist.json")) {
        return new Response('{"playlist":[{"sources":[{"file":"https://vip.example/vivarium/master.m3u8","type":"hls"}]}]}', {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      if (url.includes("play.xpass.top/mdata/tik/playlist.json")) {
        throw new Error("The TIK mirror must not be selected before VIP");
      }
      if (url.includes("vip.example/vivarium/master.m3u8")) {
        return new Response("#EXTM3U\n#EXT-X-VERSION:3", {
          status: 200,
          headers: { "Content-Type": "application/vnd.apple.mpegurl" },
        });
      }
      throw new Error(`Unexpected fetch: ${url}`);
    }) as typeof fetch;

    const resolved = await resolvePlaybackStream({
      episodeId: "vivarium-movie",
      activePlayerAlias: "xpass",
      players: [{
        alias: "xpass",
        provider: "2embed",
        embedUrl: "https://play.xpass.top/e/movie/tt8368406?autostart=true",
      }],
    });

    expect(resolved.resolvedUrl).toBe("https://vip.example/vivarium/master.m3u8");
  });

  it("rejects HLS manifests whose first video segment is forbidden", async () => {
    global.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === "https://dead.example/vivarium.m3u8") {
        return new Response("#EXTM3U\n#EXT-X-TARGETDURATION:2\n#EXTINF:2,\nsegment-0.ts", {
          status: 200,
          headers: { "Content-Type": "application/vnd.apple.mpegurl" },
        });
      }
      if (url === "https://dead.example/segment-0.ts") {
        return new Response('{"code":3403,"error":"fail to get resource"}', {
          status: 403,
          headers: { "Content-Type": "application/json" },
        });
      }
      if (url === "https://good.example/vivarium.mp4") {
        return new Response("video", {
          status: 206,
          headers: { "Content-Type": "video/mp4", "Content-Range": "bytes 0-4/100" },
        });
      }
      throw new Error(`Unexpected fetch: ${url}`);
    }) as typeof fetch;

    const resolved = await resolvePlaybackStream({
      episodeId: "vivarium-movie",
      activePlayerAlias: "dead-hls",
      players: [
        {
          alias: "dead-hls",
          provider: "xpass",
          embedUrl: "https://dead.example/vivarium.m3u8",
          streamUrl: "https://dead.example/vivarium.m3u8",
          streamType: "hls",
        },
        {
          alias: "working-mp4",
          provider: "fallback",
          embedUrl: "https://good.example/vivarium.mp4",
          streamUrl: "https://good.example/vivarium.mp4",
          streamType: "mp4",
        },
      ],
    });

    expect(resolved.playerAlias).toBe("working-mp4");
    expect(resolved.resolvedUrl).toBe("https://good.example/vivarium.mp4");
  });

  it("classifies Streamtape get_video URLs as MP4 playback", async () => {
    global.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("streamtape.example")) {
        return new Response('<script>document.getElementById("robotlink").innerHTML = "https://streamtape.to/get_video?id=abc&expires=123&token=xyz";</script>', {
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

  it("refreshes stale SvetSerialu provider embeds from their source wrapper", async () => {
    const requestedUrls: string[] = [];
    global.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      requestedUrls.push(url);
      if (url.includes("svetserialov.to/sources/filemoon")) {
        return new Response('<iframe src="https://filemoon-current.example/e/fresh"></iframe>', {
          status: 200,
          headers: { "Content-Type": "text/html; charset=utf-8" },
        });
      }
      if (url === "https://filemoon-current.example/e/fresh") {
        return new Response('file: "https://cdn.example/fresh/master.m3u8"', {
          status: 200,
          headers: { "Content-Type": "text/html; charset=utf-8" },
        });
      }
      if (url === "https://cdn.example/fresh/master.m3u8") {
        return new Response("#EXTM3U\n#EXT-X-VERSION:3", {
          status: 200,
          headers: { "Content-Type": "application/vnd.apple.mpegurl" },
        });
      }
      throw new Error(`Unexpected fetch: ${url}`);
    }) as typeof fetch;

    const resolved = await resolvePlaybackStream({
      episodeId: "episode-stale-filemoon",
      activePlayerAlias: "filemoon",
      players: [{
        alias: "filemoon",
        provider: "filemoon",
        sourcePageUrl: "https://svetserialov.to/sources/filemoon?episodeId=25",
        embedUrl: "https://f16px.com/e/deleted",
      }],
    });

    expect(resolved.resolvedUrl).toBe("https://cdn.example/fresh/master.m3u8");
    expect(resolved.refererUrl).toBe("https://filemoon-current.example/e/fresh");
    expect(requestedUrls).not.toContain("https://f16px.com/e/deleted");
  });

  it("skips a dead SvetSerialu source and validates the next mirror", async () => {
    const deadSource = Buffer.from("https://svetserialu.to/sources/dead").toString("base64");
    const goodSource = Buffer.from("https://svetserialu.to/sources/good").toString("base64");
    global.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === "https://svetserialu.to/serial/test/s01e01") {
        return new Response(
          `<button class="source_link" data-iframe="${deadSource}"></button><button class="source_link" data-iframe="${goodSource}"></button>`,
          { status: 200, headers: { "Content-Type": "text/html; charset=utf-8" } },
        );
      }
      if (url === "https://svetserialu.to/sources/dead") {
        return new Response('<iframe src="https://dead.example/embed"></iframe>', {
          status: 200,
          headers: { "Content-Type": "text/html; charset=utf-8" },
        });
      }
      if (url === "https://svetserialu.to/sources/good") {
        return new Response('<iframe src="https://good.example/embed"></iframe>', {
          status: 200,
          headers: { "Content-Type": "text/html; charset=utf-8" },
        });
      }
      if (url === "https://dead.example/embed") {
        return new Response('file: "https://cdn.example/dead.mp4"', {
          status: 200,
          headers: { "Content-Type": "text/html; charset=utf-8" },
        });
      }
      if (url === "https://cdn.example/dead.mp4") {
        return new Response("forbidden", { status: 403 });
      }
      if (url === "https://good.example/embed") {
        return new Response('file: "https://cdn.example/good.mp4"', {
          status: 200,
          headers: { "Content-Type": "text/html; charset=utf-8" },
        });
      }
      if (url === "https://cdn.example/good.mp4") {
        return new Response("video", {
          status: 206,
          headers: { "Content-Type": "video/mp4", "Content-Range": "bytes 0-4/100" },
        });
      }
      throw new Error(`Unexpected fetch: ${url}`);
    }) as typeof fetch;

    const resolved = await resolvePlaybackStream({
      episodeId: "episode-svet-mirrors",
      activePlayerAlias: "svet",
      players: [{
        alias: "svet",
        provider: "svetserialu",
        embedUrl: "https://svetserialu.to/serial/test/s01e01",
      }],
    });

    expect(resolved.resolvedUrl).toBe("https://cdn.example/good.mp4");
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

  it("does not reuse persisted Xpass artwork as a movie stream", async () => {
    const artworkUrl = "https://p16-sg.tiktokcdn.com/obj/tos-alisg-avt-0068/avatar-id";
    const requestedUrls: string[] = [];
    global.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      requestedUrls.push(url);
      if (url.includes("play.xpass.top/e/movie/tt8368406")) {
        return new Response("<html><body>provider player</body></html>", {
          status: 200,
          headers: { "Content-Type": "text/html; charset=utf-8" },
        });
      }
      throw new Error(`Unexpected fetch: ${url}`);
    }) as typeof fetch;

    await expect(resolvePlaybackStream({
      episodeId: "vivarium-movie",
      activePlayerAlias: "2embed",
      players: [{
        alias: "2embed",
        provider: "2embed",
        label: "Bombuj Vivarium",
        sourcePageUrl: "https://www.2embed.cc/embed/tt8368406",
        embedUrl: "https://play.xpass.top/e/movie/tt8368406?autostart=true",
        streamUrl: artworkUrl,
        streamType: "hls",
        resolvedAt: Date.now(),
      }],
    })).rejects.toMatchObject({
      message: expect.stringContaining("No validated MP4/HLS/DASH source"),
    });

    expect(requestedUrls).not.toContain(artworkUrl);
  });

  it("rejects image responses and uses the refreshed media type", async () => {
    global.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === "https://cdn.example/not-a-video") {
        return new Response("image", {
          status: 200,
          headers: { "Content-Type": "image/jpeg" },
        });
      }
      if (url === "https://provider.example/embed/vivarium") {
        return new Response('file: "https://cdn.example/vivarium.mp4"', {
          status: 200,
          headers: { "Content-Type": "text/html; charset=utf-8" },
        });
      }
      if (url === "https://cdn.example/vivarium.mp4") {
        return new Response("video", {
          status: 206,
          headers: { "Content-Type": "video/mp4", "Content-Range": "bytes 0-4/100" },
        });
      }
      throw new Error(`Unexpected fetch: ${url}`);
    }) as typeof fetch;

    const resolved = await resolvePlaybackStream({
      episodeId: "vivarium-movie",
      activePlayerAlias: "provider",
      players: [{
        alias: "provider",
        provider: "provider",
        embedUrl: "https://provider.example/embed/vivarium",
        streamUrl: "https://cdn.example/not-a-video",
        streamType: "hls",
      }],
    });

    expect(resolved.resolvedUrl).toBe("https://cdn.example/vivarium.mp4");
    expect(resolved.streamType).toBe("mp4");
    expect(resolved.playbackUrl).toContain("vivarium-movie.mp4");
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

  it("falls back from an unavailable VidKing movie source API to 2Embed", async () => {
    global.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("db.speedracelight.com/3/movie/550")) {
        return Response.json({
          title: "Fight Club",
          release_date: "1999-10-15",
          imdb_id: "tt0137523",
        });
      }
      if (url.includes("api.speedracelight.com/seed?mediaId=550")) {
        return Response.json({ seed: "fixture-seed-2026", ttlMs: 30_000 });
      }
      if (url.includes("api.speedracelight.com/")) {
        return new Response("unavailable", { status: 500 });
      }
      if (url === "https://www.vidking.net/embed/movie/550") {
        return new Response("<html><body>Player API unavailable</body></html>", {
          status: 200,
          headers: { "Content-Type": "text/html; charset=utf-8" },
        });
      }
      if (url.includes("db.videasy.to/3/movie/550")) {
        return Response.json({ imdb_id: "tt0137523" });
      }
      if (url === "https://www.2embed.cc/embed/tt0137523") {
        return new Response('file: "https://cdn.example/fight-club.mp4"', {
          status: 200,
          headers: { "Content-Type": "text/html; charset=utf-8" },
        });
      }
      if (url === "https://cdn.example/fight-club.mp4") {
        return new Response("video", {
          status: 206,
          headers: { "Content-Type": "video/mp4", "Content-Range": "bytes 0-4/100" },
        });
      }
      throw new Error(`Unexpected fetch: ${url}`);
    }) as typeof fetch;

    const resolved = await resolvePlaybackStream({
      episodeId: "episode-vidking-fallback",
      activePlayerAlias: "vidking-player",
      players: [{
        alias: "vidking-player",
        provider: "vidking",
        embedUrl: "https://www.vidking.net/embed/movie/550",
      }],
    });

    expect(resolved.resolvedUrl).toBe("https://cdn.example/fight-club.mp4");
    expect(resolved.streamType).toBe("mp4");
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
      message: expect.stringContaining("No validated MP4/HLS/DASH source"),
    });
  });

  it("runs fallback players concurrently and returns the first success", async () => {
    global.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === "https://active.example/player") {
        return new Response("<html><body>provider player</body></html>", {
          status: 200,
          headers: { "Content-Type": "text/html; charset=utf-8" },
        });
      }
      if (url === "https://www.2embed.cc/embed/slow-test") {
        await new Promise((resolve) => setTimeout(resolve, 400));
        return new Response('file: "https://cdn-slow.example/slow.mp4"', {
          status: 200,
          headers: { "Content-Type": "text/html; charset=utf-8" },
        });
      }
      if (url === "https://www.2embed.cc/embed/fast-test") {
        return new Response('file: "https://cdn-fast.example/fast.mp4"', {
          status: 200,
          headers: { "Content-Type": "text/html; charset=utf-8" },
        });
      }
      if (url === "https://cdn-slow.example/slow.mp4") {
        return new Response("video", {
          status: 206,
          headers: { "Content-Type": "video/mp4", "Content-Range": "bytes 0-4/100" },
        });
      }
      if (url === "https://cdn-fast.example/fast.mp4") {
        return new Response("video", {
          status: 206,
          headers: { "Content-Type": "video/mp4", "Content-Range": "bytes 0-4/100" },
        });
      }
      throw new Error(`Unexpected fetch: ${url}`);
    }) as typeof fetch;

    const resolved = await resolvePlaybackStream({
      episodeId: "episode-parallel-fallback",
      activePlayerAlias: "active",
      players: [
        {
          alias: "active",
          provider: "embed",
          embedUrl: "https://active.example/player",
        },
        {
          alias: "slow-fallback",
          provider: "2embed",
          embedUrl: "https://www.2embed.cc/embed/slow-test",
        },
        {
          alias: "fast-fallback",
          provider: "2embed",
          embedUrl: "https://www.2embed.cc/embed/fast-test",
        },
      ],
    });

    expect(resolved.playerAlias).toBe("fast-fallback");
    expect(resolved.resolvedUrl).toBe("https://cdn-fast.example/fast.mp4");
  });
});
