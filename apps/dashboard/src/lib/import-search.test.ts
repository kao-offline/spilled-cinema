import { describe, expect, it } from "vitest";
import { prioritizeImportSearchResults, resolveImportInput } from "./import-search";

describe("direct provider import input", () => {
  const cases = [
    ["https://www.bombuj.si/online-film-duna-cast-druha", { platform: "bombuj", slug: "duna-cast-druha", mediaType: "movie" }],
    ["https://serialy.bombuj.si/serial-the-last-of-us#serial", { platform: "bombuj", slug: "the-last-of-us", mediaType: "serial" }],
    ["serialy.bombuj.si/online-serial-silo/", { platform: "bombuj", slug: "silo", mediaType: "serial" }],
    ["https://svetserialu.to/serial/game-of-thrones", { platform: "svetserialu", slug: "game-of-thrones", mediaType: "serial" }],
    ["https://svetserialov.to/serial/Hra-o-tr%C5%AFny/?ref=search", { platform: "svetserialu", slug: "hra-o-trůny", mediaType: "serial" }],
    ["svetserialu.io/serial/silo", { platform: "svetserialu", slug: "silo", mediaType: "serial" }],
  ] as const;

  for (const [input, expected] of cases) {
    it(`parses ${input}`, () => {
      expect(resolveImportInput(input)).toMatchObject({ mode: "direct", ...expected });
    });
  }

  it("keeps an ordinary title as a search query", () => {
    expect(resolveImportInput("Dune Part Two")).toEqual({ mode: "search", query: "Dune Part Two" });
  });

  it("does not treat an unsupported URL as a provider slug", () => {
    expect(resolveImportInput("https://example.com/serial/silo")).toEqual({ mode: "search", query: "https://example.com/serial/silo" });
  });
});

describe("import search provider diversity", () => {
  it("keeps Bombuj visible when higher-ranked providers fill the initial window", () => {
    const results = [
      ...Array.from({ length: 6 }, (_, index) => ({ platform: "vidking" as const, title: `VidKing ${index}` })),
      { platform: "svetserialu" as const, title: "Svet result" },
      { platform: "bombuj" as const, title: "Bombuj result" },
    ];
    const visible = prioritizeImportSearchResults(results, 6);
    expect(visible.map((result) => result.platform)).toContain("bombuj");
    expect(visible.map((result) => result.platform)).toContain("svetserialu");
    expect(visible).toHaveLength(6);
  });

  it("preserves ranking order while filling remaining slots", () => {
    const results = [
      { platform: "vidking" as const, title: "A" },
      { platform: "vidking" as const, title: "B" },
      { platform: "bombuj" as const, title: "C" },
    ];
    expect(prioritizeImportSearchResults(results, 3).map((result) => result.title)).toEqual(["A", "C", "B"]);
  });
});
