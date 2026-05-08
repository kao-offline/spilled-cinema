import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseSvetEpisodeCards, parseSvetLatestShowsPage } from "../svetserialu-discovery";

function readFixture(name: string) {
  return readFileSync(new URL(`../__fixtures__/${name}`, import.meta.url), "utf8");
}

describe("svetserialu discovery parsers", () => {
  it("parses latest shows from fixture html", () => {
    const html = readFixture("svet-latest-shows.html");
    const items = parseSvetLatestShowsPage(html);

    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      provider: "svetserialu",
      mediaType: "serial",
      slug: "severance",
      title: "Severance",
      year: "2022",
    });
    expect(items[0].audioBuckets).toEqual(expect.arrayContaining(["dubbing", "subtitles"]));
  });

  it("parses latest episode cards from fixture html", () => {
    const html = readFixture("svet-episode-cards.html");
    const items = parseSvetEpisodeCards(html);

    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      provider: "svetserialu",
      slug: "andor",
    });
    expect(items[0].episode?.episodeCode).toBe("s1e04");
    expect(items[0].audioBuckets).toContain("subtitles");
  });
});
