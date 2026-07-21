import { describe, expect, it } from "vitest";
import { classifyWideArtworkKind, limitArtworkAssets, type ArtworkAsset } from "../artwork";

function asset(index: number, source: ArtworkAsset["source"] = "tvdb"): ArtworkAsset {
  return {
    kind: "banner",
    source,
    url: `https://images.example/${source}/${index}.jpg`,
    label: `${source} banner`,
  };
}

describe("limitArtworkAssets", () => {
  it("bounds very large provider groups without dropping the current artwork", () => {
    const current = asset(0, "current");
    const assets = [current, ...Array.from({ length: 579 }, (_, index) => asset(index))];

    const limited = limitArtworkAssets(assets, 36);

    expect(limited.filter((entry) => entry.source === "tvdb")).toHaveLength(36);
    expect(limited).toContain(current);
  });

  it("limits each artwork kind and provider independently", () => {
    const assets: ArtworkAsset[] = [
      ...Array.from({ length: 5 }, (_, index) => asset(index, "tmdb")),
      ...Array.from({ length: 5 }, (_, index) => ({ ...asset(index, "tmdb"), kind: "poster" as const })),
      ...Array.from({ length: 5 }, (_, index) => asset(index, "fanart")),
    ];

    const limited = limitArtworkAssets(assets, 2);

    expect(limited).toHaveLength(6);
  });
});

describe("classifyWideArtworkKind", () => {
  it("routes localized TMDB-style backdrops to WLogo banners", () => {
    expect(classifyWideArtworkKind(undefined, "en")).toBe("wlogo-banner");
    expect(classifyWideArtworkKind(undefined, "cs")).toBe("wlogo-banner");
  });

  it("routes explicit TVDB text artwork to WLogo banners", () => {
    expect(classifyWideArtworkKind(true, null)).toBe("wlogo-banner");
  });

  it("keeps language-neutral wide artwork as clean banners", () => {
    expect(classifyWideArtworkKind(false, null)).toBe("banner");
    expect(classifyWideArtworkKind(undefined, "")).toBe("banner");
  });
});
