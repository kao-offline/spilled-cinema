import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchTmdbTrailer } from "../artwork";
afterEach(() => vi.unstubAllGlobals());
describe("official TMDB trailers", () => {
  const input = { title: "Example", mediaType: "tv" as const, externalIds: { tmdb: "123" }, apiKeys: { tmdbApiKey: "test-key" } };
  it("only selects official, valid YouTube trailers", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url: string) => new Response(JSON.stringify(url.includes("/videos") ? { results: [
      { official: false, site: "YouTube", type: "Trailer", key: "abcdefghijk" },
      { official: true, site: "YouTube", type: "Teaser", key: "abcdefghijk" },
      { official: true, site: "YouTube", type: "Trailer", key: "invalid?key" },
      { official: true, site: "YouTube", type: "Trailer", key: "Abcdefghij1" },
    ] } : { id: 123 }), { status: 200 })));
    expect(await fetchTmdbTrailer(input)).toBe("Abcdefghij1");
  });
  it("returns a poster fallback when upstream is unavailable", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("", { status: 503 })));
    expect(await fetchTmdbTrailer(input)).toBeNull();
  });
});
