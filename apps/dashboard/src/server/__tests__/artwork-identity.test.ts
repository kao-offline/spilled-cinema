import { afterEach, describe, expect, it, vi } from "vitest";
import { searchArtworkAssets } from "../artwork";

afterEach(() => vi.unstubAllGlobals());
const input = { title: "Dark Matter", mediaType: "tv" as const, apiKeys: { tmdbApiKey: "test-key" }, sources: { tmdb: true, fanart: false, tvdb: false } };
const candidates = [
  { id: 15, name: "Dark Matter", first_air_date: "2015-06-12" },
  { id: 20, name: "Dark Matter", first_air_date: "2020-01-01" },
];
function mockArtwork(results = candidates) {
  const fetcher = vi.fn(async (raw: string | URL | Request) => {
    const url = new URL(String(raw));
    const payload = url.pathname.endsWith("/search/tv") ? { results }
      : url.pathname.endsWith("/images") ? { posters: [{ file_path: `/poster-${url.pathname.split("/").at(-2)}.jpg` }] }
      : url.pathname.endsWith("/tv/15") ? candidates[0] : {};
    return new Response(JSON.stringify(payload), { status: 200 });
  });
  vi.stubGlobal("fetch", fetcher);
  return fetcher;
}
describe("artwork title identity", () => {
  it("keeps same-name series separated by their release year", async () => {
    const fetcher = mockArtwork();
    const assets = await searchArtworkAssets({ ...input, yearHint: "2015" });
    expect(assets.some((asset) => asset.url.endsWith("poster-15.jpg"))).toBe(true);
    expect(assets.some((asset) => asset.url.endsWith("poster-20.jpg"))).toBe(false);
    expect(fetcher.mock.calls.some(([url]) => String(url).includes("/movie"))).toBe(false);
  });
  it("does not fill the picker with another year's artwork when no match exists", async () => {
    mockArtwork([candidates[1]]);
    expect(await searchArtworkAssets({ ...input, yearHint: "2015" })).toEqual([]);
  });
  it("does not choose between indistinguishable same-name titles without a year", async () => {
    mockArtwork();
    expect(await searchArtworkAssets(input)).toEqual([]);
  });
  it("repairs an external ID that contradicts the imported release year", async () => {
    mockArtwork();
    const assets = await searchArtworkAssets({ ...input, yearHint: "2020", externalIds: { tmdb: "15" } });
    expect(assets.some((asset) => asset.url.endsWith("poster-20.jpg"))).toBe(true);
    expect(assets.some((asset) => asset.url.endsWith("poster-15.jpg"))).toBe(false);
  });
});
