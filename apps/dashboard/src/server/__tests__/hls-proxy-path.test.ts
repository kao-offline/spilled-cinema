import { expect, it } from "vitest";
import { buildBrowserFileProxyPath } from "../../../../server/src/http-handlers";

it.each([["variant.m3u8", "m3u8"], ["chunk.ts", "ts"], ["init.mp4", "mp4"], ["chunk.m4s", "m4s"], ["chunk.jpg", "ts"], ["chunk", "ts"]])("keeps %s readable by FFmpeg through the proxy", (file, extension) => {
  const upstream = `https://media.example/${file}?signed=example`;
  const path = new URL(buildBrowserFileProxyPath(upstream, "episode.m3u8", "https://provider.example/watch", true), "http://node.example");
  expect(path.pathname).toBe(`/api/download-full/browser-file/stream.${extension}`);
  expect(path.searchParams.get("url")).toBe(upstream);
  expect(path.searchParams.get("referer")).toBe("https://provider.example/watch");
  expect(path.searchParams.get("playback")).toBe("1");
});
