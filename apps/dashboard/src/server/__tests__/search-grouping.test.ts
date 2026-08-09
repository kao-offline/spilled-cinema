import { describe, expect, it } from "vitest";
import { buildRemoteCommandResults, type RemoteCommandResult } from "../../lib/command-search";

function result(overrides: Partial<RemoteCommandResult> & Pick<RemoteCommandResult, "title" | "slug" | "platform">): RemoteCommandResult {
  return { mediaType: "movie", alternateTitles: [], ...overrides };
}

function group(query: string, results: RemoteCommandResult[]) {
  return buildRemoteCommandResults({ query, results, shows: [], downloadedCountByShow: {} });
}

describe("cross-provider search grouping", () => {
  it("merges the same title across providers", () => {
    const grouped = group("dune", [
      result({ title: "Dune", slug: "dune", platform: "bombuj", year: "2021" }),
      result({ title: "Dune", slug: "movie/438631", platform: "vidking", year: "2021" }),
    ]);
    expect(grouped).toHaveLength(1);
    expect(grouped[0].kind === "remote-title" && grouped[0].sourceMatches).toHaveLength(2);
  });

  it("keeps remakes with distant years separate", () => {
    expect(group("dune", [
      result({ title: "Dune", slug: "dune-1984", platform: "bombuj", year: "1984" }),
      result({ title: "Dune", slug: "movie/438631", platform: "vidking", year: "2021" }),
    ])).toHaveLength(2);
  });

  it("never merges a movie and series with the same title", () => {
    expect(group("watchmen", [
      result({ title: "Watchmen", slug: "watchmen-film", platform: "bombuj", mediaType: "movie", year: "2009" }),
      result({ title: "Watchmen", slug: "tv/79788", platform: "vidking", mediaType: "serial", year: "2019" }),
    ])).toHaveLength(2);
  });

  it("merges translated titles transitively through a bilingual source", () => {
    const grouped = group("game of thrones", [
      result({ title: "Game of Thrones", slug: "tv/1399", platform: "vidking", mediaType: "serial", year: "2011" }),
      result({ title: "Hra o trůny", alternateTitles: ["Game of Thrones"], slug: "hra-o-truny", platform: "svetserialu", mediaType: "serial", year: "2011" }),
      result({ title: "Hra o trůny", slug: "hra-o-truny", platform: "bombuj", mediaType: "serial", year: "2011" }),
    ]);
    expect(grouped).toHaveLength(1);
    expect(grouped[0].kind === "remote-title" && grouped[0].sourceMatches).toHaveLength(3);
  });

  it("deduplicates repeated provider slugs", () => {
    const duplicate = result({ title: "Alien", slug: "alien", platform: "bombuj", year: "1979" });
    expect(group("alien", [duplicate, duplicate])).toHaveLength(1);
  });
});
