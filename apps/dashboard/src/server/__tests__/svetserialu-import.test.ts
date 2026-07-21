import { Buffer } from "node:buffer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../artwork", () => ({
  enrichArtwork: async (input: { currentPosterUrl?: string | null }) => ({
    posterUrl: input.currentPosterUrl ?? null,
    backdropUrl: null,
    clearLogoUrl: null,
  }),
}));

describe("SvetSerialu import", () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    const encodedSource = Buffer.from("/sources/filemoon/abc", "utf8").toString("base64");
    global.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);

      if (url.endsWith("/serial/test-show")) {
        return new Response(`
          <h1 class="nunito">Test Show</h1>
          <span class="alt-name nunito">Alt Test</span>
          <div class="show-text nunito">Description</div>
          <div class="show-image"><img src="/posters/test.jpg"></div>
          <span class="year nunito">2024</span>
          <a href="/serial/test-show/s1e1" class="button starwatch">Watch</a>
        `, { status: 200 });
      }

      if (url.endsWith("/serial/test-show/s1e1")) {
        return new Response(`
          <a href="/episodes-list?tvShowId=123">Episodes</a>
          <div class="LangGroup">
            <div class="LangHeader">CZ/SK + EN titulky</div>
            <div class="tabshe">
              <a class="source_link filemoon" data-iframe="${encodedSource}" title="CZ dabing">FileMoon</a>
            </div>
          </div>
        `, { status: 200 });
      }

      if (url.includes("/episodes-list?tvShowId=123&season=1&episode=1")) {
        return new Response(`
          <option value="1">1</option>
          <a href="/serial/test-show/s1e1" class="seasonLinks">
            <span class="ep_numb">1</span>
            <span class="ep_name">Pilot</span>
          </a>
        `, { status: 200 });
      }

      if (url.endsWith("/sources/filemoon/abc")) {
        return new Response('<iframe src="https://filemoon.sx/e/abc?sub.info=https%3A%2F%2Fsubs.example%2Fcz.vtt"></iframe>', {
          status: 200,
        });
      }

      throw new Error(`Unexpected fetch: ${url}`);
    }) as typeof fetch;
  });

  afterEach(() => {
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("imports resolved external episode players instead of a SvetSerialu iframe fallback", async () => {
    const { fetchSvetSerialuShow } = await import("../svetserialu");

    const show = await fetchSvetSerialuShow("test-show");
    const episode = show.episodes[0];

    expect(episode.players).toHaveLength(1);
    expect(episode.players[0]).toMatchObject({
      provider: "filemoon",
      label: "File",
      language: "English audio + CZ/SK subtitles",
      sourcePageUrl: "https://svetserialu.to/sources/filemoon/abc",
      embedUrl: "https://filemoon.sx/e/abc?sub.info=https%3A%2F%2Fsubs.example%2Fcz.vtt",
      subtitlesUrl: "https://subs.example/cz.vtt",
    });
    expect(episode.selectedPlayerAlias).toBe(episode.players[0].alias);
  });
});
