import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseBombujMovieBrowsePage, parseBombujSeriesLatestEpisodes } from "../bombuj-discovery";

function readFixture(name: string) {
  return readFileSync(new URL(`../__fixtures__/${name}`, import.meta.url), "utf8");
}

describe("bombuj discovery parsers", () => {
  it("parses movie browse cards from fixture html", () => {
    const html = readFixture("bombuj-movie-browse.html");
    const items = parseBombujMovieBrowsePage(html, "newest");

    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      provider: "bombuj",
      mediaType: "movie",
      slug: "the-matrix-1999",
      title: "The Matrix",
    });
  });

  it("parses latest episode cards with provider audio bucket", () => {
    const html = readFixture("bombuj-series-episodes.html");
    const items = parseBombujSeriesLatestEpisodes(html, "dubbing");

    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      provider: "bombuj",
      mediaType: "serial",
      slug: "the-last-of-us",
      sectionKeys: ["latestEpisodes"],
    });
    expect(items[0].audioBuckets).toContain("dubbing");
    expect(items[0].episode?.episodeCode).toBe("s1e02");
  });
});
