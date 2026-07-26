import { describe, expect, it } from "vitest";
import { hasProviderSearchTokenCoverage } from "../../../../../packages/node-client/src";

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
});
