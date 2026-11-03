import { describe, expect, it } from "vitest";
import { applyArtworkRepair, needsArtworkRepair } from "../artwork-repair";
import { getHomeHeroArtwork, getHeroArtwork, getShowArtwork } from "../media-library";
import type { ImportedShow } from "../types";

function imported(): ImportedShow {
  return { slug: "slow-horses", title: "Slow Horses", years: "2022", mediaType: "serial", importedAt: 1,
    isFavorite: true, availableSeasons: [1], posterUrl: "old-poster", bannerUrl: "old-poster", homepageBannerUrl: "old-poster",
    artwork: { posterUrl: "old-poster", bannerUrl: "old-poster", bannerWithLogoUrl: "old-poster" },
    episodes: [{ id: "s1e1", showSlug: "slow-horses", showTitle: "Slow Horses", seasonNumber: 1, episodeNumber: 1, episodeCode: "s1e1", episodeUrl: "https://provider.example/1", players: [], selectedPlayerAlias: "", importedAt: 1, posterUrl: "old-poster", watched: true, playbackPositionSeconds: 120 }],
  };
}
describe("artwork reset on library load", () => {
  it("replaces every saved artwork alias without changing the library or progress", () => {
    const old = imported();
    const repaired = applyArtworkRepair(old, { posterUrl: "poster", bannerUrl: "banner", clearLogoUrl: "logo", bannerWithLogoUrl: "wlogo" }, 7);
    expect(getHomeHeroArtwork(repaired)).toEqual({ imageUrl: "banner", logoUrl: "logo" });
    expect(getHeroArtwork(repaired)).toEqual({ imageUrl: "poster", logoUrl: "logo" });
    expect(repaired.homepagePosterUrl).toBe("poster");
    expect(repaired.homepageBannerUrl).toBe("wlogo");
    expect(repaired.episodes[0]).toEqual({ ...old.episodes[0], posterUrl: undefined });
    expect(repaired.isFavorite).toBe(true);
    expect(repaired.importedAt).toBe(old.importedAt);
    expect(needsArtworkRepair(repaired)).toBe(false);
  });
  it("repairs each loaded library independently and rechecks a changed identity", () => {
    const firstAccount = imported();
    const secondAccount = imported();
    const repaired = applyArtworkRepair(firstAccount, { bannerUrl: "banner" }, 7);
    expect(needsArtworkRepair(secondAccount)).toBe(true);
    expect(needsArtworkRepair(repaired)).toBe(false);
    expect(needsArtworkRepair({ ...repaired, years: "2023" })).toBe(true);
  });
  it("clears obsolete slots rather than borrowing a logo or WLogo from an old title", () => {
    const repaired = applyArtworkRepair(imported(), { posterUrl: "fresh-poster", bannerUrl: "fresh-banner" }, 7);
    expect(repaired.clearLogoUrl).toBeNull();
    expect(repaired.bannerWithLogoUrl).toBeNull();
    expect(repaired.homepageBannerUrl).toBeNull();
  });
  it("never displays a poster saved in a wide slot, including resized TMDB aliases", () => {
    const show = imported();
    expect(getHomeHeroArtwork(show).imageUrl).toBeNull();
    expect(getShowArtwork(show).bannerWithLogoUrl).toBeNull();
    show.artwork = { posterUrl: "https://image.tmdb.org/t/p/w500/same.jpg", bannerUrl: "https://image.tmdb.org/t/p/w1280/same.jpg" };
    expect(getHomeHeroArtwork(show).imageUrl).toBeNull();
  });
});
