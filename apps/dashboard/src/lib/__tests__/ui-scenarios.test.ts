import { describe, expect, it } from "vitest";
import { balanceImageResolution, shouldUseEconomyArtwork } from "../image-resolution";
import {
  readHomepageTab,
  readProviderHomePreference,
  writeHomepageTab,
  writeProviderHomePreference,
} from "../provider-home-preferences";
import { applyTvMode, readTvMode, writeTvMode } from "../tv-mode";

function memoryStorage(initial: Record<string, string> = {}) {
  const values = new Map(Object.entries(initial));
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
  };
}

describe("responsive UI scenario matrix", () => {
  it.each([
    { name: "phone", viewportWidth: 390, memory: 4, economy: true, heroSize: "w780" },
    { name: "desktop", viewportWidth: 1366, memory: 8, economy: false, heroSize: "w1280" },
    { name: "1080p display with TV mode off", viewportWidth: 1920, memory: 8, tvMode: false, economy: false, heroSize: "w1280" },
    { name: "1080p display with TV mode on", viewportWidth: 1920, memory: 8, tvMode: true, economy: true, heroSize: "w780" },
    { name: "4K display with TV mode off", viewportWidth: 3840, memory: 8, tvMode: false, economy: false, heroSize: "w1280" },
    { name: "4K display with TV mode on", viewportWidth: 3840, memory: 8, tvMode: true, economy: true, heroSize: "w780" },
    { name: "data saver desktop", viewportWidth: 1366, memory: 8, saveData: true, economy: true, heroSize: "w780" },
  ])("selects the expected artwork tier for $name", ({ viewportWidth, memory, saveData, tvMode, economy, heroSize }) => {
    const scenario = { viewportWidth, deviceMemoryGb: memory, saveData, tvMode };
    expect(shouldUseEconomyArtwork(scenario)).toBe(economy);
    expect(balanceImageResolution("https://image.tmdb.org/t/p/original/hero.jpg", "backdrop-hero", scenario)).toContain(`/${heroSize}/`);
  });

  it("keeps provider filters isolated and persistent across remounts", () => {
    const storage = memoryStorage();
    writeProviderHomePreference("svetserialu", { feedId: "new-series", audioFilter: "all", animeFilter: "no-anime" }, storage);
    writeProviderHomePreference("bombuj", { feedId: "latest-movies", audioFilter: "subtitles", animeFilter: "all" }, storage);

    expect(readProviderHomePreference("svetserialu", ["new-episodes", "new-series"], storage)).toEqual({
      feedId: "new-series", audioFilter: "all", animeFilter: "no-anime",
    });
    expect(readProviderHomePreference("bombuj", ["latest-movies", "latest-series"], storage)).toEqual({
      feedId: "latest-movies", audioFilter: "subtitles", animeFilter: "all",
    });
  });

  it("falls back safely for malformed or stale preferences", () => {
    const storage = memoryStorage({ "spilled.provider-home-filters.v2": "{broken" });
    expect(readProviderHomePreference("svetserialu", ["new-episodes"], storage)).toEqual({
      feedId: "new-episodes", audioFilter: "all", animeFilter: "all",
    });
  });

  it("migrates existing v1 provider preferences without losing the user's filters", () => {
    const storage = memoryStorage({
      "spilled.provider-home-filters.v1": JSON.stringify({
        svetserialu: { feedId: "new-series", audioFilter: "subtitles", animeFilter: "no-anime" },
      }),
    });
    expect(readProviderHomePreference("svetserialu", ["new-episodes", "new-series"], storage)).toEqual({
      feedId: "new-series", audioFilter: "subtitles", animeFilter: "no-anime",
    });
  });

  it("restores the last homepage provider tab and rejects invalid values", () => {
    const storage = memoryStorage();
    writeHomepageTab("bombuj", storage);
    expect(readHomepageTab(storage)).toBe("bombuj");
    storage.setItem("spilled.homepage-tab.v1", "invalid");
    expect(readHomepageTab(storage)).toBe("home");
  });

  it("keeps TV mode opt-in, persistent, and reflected on the document root", () => {
    const storage = memoryStorage();
    const classes = new Set<string>();
    const classList = { toggle: (name: string, force?: boolean) => {
      if (force) classes.add(name);
      else classes.delete(name);
      return Boolean(force);
    } };

    expect(readTvMode(storage)).toBe(false);
    writeTvMode(true, storage);
    applyTvMode(readTvMode(storage), classList);
    expect(classes.has("tv-mode")).toBe(true);

    writeTvMode(false, storage);
    applyTvMode(readTvMode(storage), classList);
    expect(classes.has("tv-mode")).toBe(false);
  });
});
