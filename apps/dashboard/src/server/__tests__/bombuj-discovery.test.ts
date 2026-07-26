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

  it("parses the current 23px movie cards and ignores the info icon", () => {
    const html = `
      <li>
        <a href="//www.bombuj.si/online-film-72-hodin-2026">
          <span><img class="image" src="//serialy.bombuj.si/images/icon-info.png" alt="icon info"></span>
          <div><img class="image" src="//www.bombuj.si/images/covers/all/72-hodin-2026.jpg" alt="72-hodin-2026"></div>
          <div style="font-size:23px;overflow:hidden;">72 hodin</div>
        </a>
      </li>
    `;

    const items = parseBombujMovieBrowsePage(html, "newest");

    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      slug: "72-hodin-2026",
      title: "72 hodin",
      posterUrl: "https://www.bombuj.si/images/covers/all/72-hodin-2026.jpg",
      year: "2026",
    });
  });

  it("does not mistake the homepage hero slide for the newest movie", () => {
    const html = `
      <a href="//www.bombuj.si/online-film-old-featured-film">
        <img src="//www.bombuj.si/images/slide/old-featured-film.png" alt="old-featured-film">
      </a>
      <a href="//www.bombuj.si/online-film-new-film-2026">
        <img src="//www.bombuj.si/images/covers/all/new-film-2026.jpg" alt="new-film-2026">
        <div style="font-size:23px">New Film</div>
      </a>
    `;

    expect(parseBombujMovieBrowsePage(html, "newest").map((item) => item.slug)).toEqual(["new-film-2026"]);
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
    expect(items[0].importSlug).toBe("the-last-of-us-s1e02");
  });

  it("parses current serial part links as importable episode slugs", () => {
    const html = `
      <a href="//serialy.bombuj.si/serial/naruto-1x26#komentare">
        <div class="hover_serial">
          <div style="float:left;overflow:hidden;height:35px;">Naruto</div>
        </div>
      </a>
    `;
    const items = parseBombujSeriesLatestEpisodes(html, "all");

    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      slug: "naruto",
      importSlug: "naruto-1x26",
      mediaType: "serial",
    });
    expect(items[0].episode?.episodeCode).toBe("1x26");
  });
});
