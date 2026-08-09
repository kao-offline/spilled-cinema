import { describe, expect, it } from "vitest";
import type { ImportedShow } from "../types";
import { createImportGate, findImportedShowBySource, importSourceKey, selectPrimaryImportSource } from "../import-guard";

function showFixture(overrides: Partial<ImportedShow> = {}): ImportedShow {
  return {
    slug: "bombuj-slow-horses",
    title: "Slow Horses",
    availableSeasons: [1],
    importedAt: 1,
    episodes: [],
    ...overrides,
  };
}

describe("import request scenarios", () => {
  it("normalizes source identities before guarding them", () => {
    expect(importSourceKey("bombuj", "  Slow-Horses ")).toBe("bombuj:slow-horses");
  });

  it("allows exactly one request for a rapid double click", () => {
    const gate = createImportGate();
    const key = importSourceKey("bombuj", "slow-horses");
    expect(gate.request(key)).toBe("started");
    expect(gate.request(key)).toBe("duplicate");
    expect(gate.activeKey()).toBe(key);
  });

  it("blocks a different title while an import is active, then cleanly releases", () => {
    const gate = createImportGate();
    const first = importSourceKey("svetserialu", "show-a");
    const second = importSourceKey("bombuj", "show-b");
    expect(gate.request(first)).toBe("started");
    expect(gate.request(second)).toBe("busy");
    gate.release(first);
    expect(gate.request(second)).toBe("started");
  });

  it("selects one preferred usable candidate instead of importing the whole result group", () => {
    const candidates = [
      { provider: "vidking" as const, importSlug: "tv/12", availability: "available" },
      { provider: "bombuj" as const, importSlug: "slow-horses", availability: "available" },
      { provider: "svetserialu" as const, importSlug: "slow-horses", availability: "unavailable" },
    ];
    expect(selectPrimaryImportSource(candidates, { provider: "bombuj", importSlug: "slow-horses" })).toEqual(candidates[1]);
  });

  it("returns no target when every candidate is unavailable", () => {
    expect(selectPrimaryImportSource([
      { provider: "svetserialu", importSlug: "missing", availability: "unavailable" },
    ], { provider: "svetserialu", importSlug: "missing" })).toBeNull();
  });

  it("does not release the active import when a stale request finishes", () => {
    const gate = createImportGate();
    const active = importSourceKey("bombuj", "active");
    expect(gate.request(active)).toBe("started");
    gate.release(importSourceKey("bombuj", "stale"));
    expect(gate.request(importSourceKey("svetserialu", "next"))).toBe("busy");
  });

  it("recognizes already-imported direct slugs and provider matches", () => {
    const direct = showFixture();
    const matched = showFixture({
      slug: "slow-horses",
      providerMatches: [{
        identityId: "slow-horses",
        integrationId: "svetserialu",
        providerItemId: "slow-horses-online",
        confidenceScore: 1,
        resolvedCapabilities: [],
      }],
    });
    expect(findImportedShowBySource([direct], "bombuj", "slow-horses")?.title).toBe("Slow Horses");
    expect(findImportedShowBySource([matched], "svetserialu", "slow-horses-online")?.slug).toBe("slow-horses");
    expect(findImportedShowBySource([direct], "bombuj", "different-show")).toBeNull();
  });
});
