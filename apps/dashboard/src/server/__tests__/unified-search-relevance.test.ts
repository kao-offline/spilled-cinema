import { describe, expect, it } from "vitest";
import { hasProviderSearchTokenCoverage } from "../../../../../packages/node-client/src";
import { hasRequiredSearchTokenCoverage, scoreSearchCandidate } from "../../lib/search-ranking";

describe("unified provider search relevance", () => {
  it("keeps an exact Silo title", () => {
    expect(hasProviderSearchTokenCoverage("silo", {
      title: "Silo",
      slug: "silo",
    })).toBe(true);
  });

  it("rejects Silo as a substring inside an unrelated Czech title", () => {
    expect(hasProviderSearchTokenCoverage("silo", {
      title: "Zběsilost",
      slug: "zbesilost",
    })).toBe(false);
  });

  it("supports multi-word prefixes", () => {
    expect(hasProviderSearchTokenCoverage("game thro", {
      title: "Game of Thrones",
      slug: "game-of-thrones",
    })).toBe(true);
  });

  it("tolerates small typos in provider titles", () => {
    expect(hasProviderSearchTokenCoverage("avengrs endgame", {
      title: "Avengers: Endgame",
      slug: "avengers-endgame",
    })).toBe(true);
  });

  it("tolerates a one-letter omission", () => {
    expect(hasProviderSearchTokenCoverage("game of thron", {
      title: "Game of Thrones",
      slug: "game-of-thrones",
    })).toBe(true);
  });

  it("ignores filler words like the/movie/show in the query", () => {
    expect(hasProviderSearchTokenCoverage("the avengers movie", {
      title: "Avengers: Endgame",
      slug: "avengers-endgame",
    })).toBe(true);
  });

  it("rejects unrelated titles even with shared filler", () => {
    expect(hasProviderSearchTokenCoverage("the office", {
      title: "Spider-Man",
      slug: "spider-man",
    })).toBe(false);
  });

  it("matches split words against glued titles", () => {
    expect(hasProviderSearchTokenCoverage("spider man", {
      title: "Spider-Man: No Way Home",
      slug: "spider-man-no-way-home",
    })).toBe(true);
  });

  it("matches glued words against split titles", () => {
    expect(hasRequiredSearchTokenCoverage("spiderman no way home", [
      "Spider-Man: No Way Home",
    ])).toBe(true);
  });

  it("requires every significant token for short queries", () => {
    expect(hasRequiredSearchTokenCoverage("breaking bad", [
      "Breaking",
    ])).toBe(false);
  });

  it("tolerates one misspelled token in a longer query", () => {
    expect(hasRequiredSearchTokenCoverage("game of thronz season one", [
      "Game of Thrones Season 1",
    ])).toBe(true);
  });

  it("scores exact titles far above typos", () => {
    const exact = scoreSearchCandidate("avengers", ["Avengers: Endgame"]);
    const typo = scoreSearchCandidate("avngeers", ["Avengers: Endgame"]);
    expect(exact).toBeGreaterThan(typo);
    expect(typo).toBeGreaterThan(0);
  });

  it("scores word-order swaps similarly", () => {
    const forward = scoreSearchCandidate("lord of the rings", ["The Lord of the Rings"]);
    const swapped = scoreSearchCandidate("rings lord", ["The Lord of the Rings"]);
    expect(forward).toBeGreaterThan(0);
    expect(swapped).toBeGreaterThan(0);
    expect(forward).toBeGreaterThan(swapped);
  });
});
