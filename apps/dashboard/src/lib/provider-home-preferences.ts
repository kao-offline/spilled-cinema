export type ProviderHomeId = "svetserialu" | "bombuj";
export type ProviderHomeAudioFilter = "all" | "subtitles" | "dubbing";
export type ProviderHomeAnimeFilter = "all" | "anime" | "no-anime";
export type HomepageTab = "home" | ProviderHomeId;

export const HOMEPAGE_SOURCE_TABS: ReadonlyArray<{ id: HomepageTab; label: string }> = [
  { id: "home", label: "Home" },
  { id: "svetserialu", label: "SvetSerialu" },
  { id: "bombuj", label: "Bombuj" },
];

export type ProviderHomePreference = {
  feedId: string;
  audioFilter: ProviderHomeAudioFilter;
  animeFilter: ProviderHomeAnimeFilter;
};

type StorageLike = Pick<Storage, "getItem" | "setItem">;

const FILTERS_KEY = "spilled.provider-home-filters.v2";
const LEGACY_FILTERS_KEY = "spilled.provider-home-filters.v1";
const TAB_KEY = "spilled.homepage-tab.v1";

function availableStorage(storage?: StorageLike | null) {
  if (storage !== undefined) return storage;
  return typeof localStorage === "undefined" ? null : localStorage;
}

export function readProviderHomePreference(
  provider: ProviderHomeId,
  validFeedIds: readonly string[],
  storage?: StorageLike | null,
): ProviderHomePreference {
  const fallbackFeedId = validFeedIds[0] ?? "";
  try {
    const target = availableStorage(storage);
    const raw = target?.getItem(FILTERS_KEY) ?? target?.getItem(LEGACY_FILTERS_KEY);
    const saved = raw ? JSON.parse(raw) as Record<string, Partial<ProviderHomePreference>> : {};
    const preference = saved[provider];
    return {
      feedId: validFeedIds.includes(preference?.feedId ?? "") ? preference?.feedId ?? fallbackFeedId : fallbackFeedId,
      audioFilter: preference?.audioFilter === "subtitles" || preference?.audioFilter === "dubbing" ? preference.audioFilter : "all",
      animeFilter: preference?.animeFilter === "anime" || preference?.animeFilter === "no-anime" ? preference.animeFilter : "all",
    };
  } catch {
    return { feedId: fallbackFeedId, audioFilter: "all", animeFilter: "all" };
  }
}

export function writeProviderHomePreference(
  provider: ProviderHomeId,
  preference: ProviderHomePreference,
  storage?: StorageLike | null,
) {
  const target = availableStorage(storage);
  if (!target) return;
  try {
    const raw = target.getItem(FILTERS_KEY);
    const saved = raw ? JSON.parse(raw) as Record<string, ProviderHomePreference> : {};
    saved[provider] = preference;
    target.setItem(FILTERS_KEY, JSON.stringify(saved));
  } catch {
    // Preferences are best-effort when browser storage is unavailable.
  }
}

export function readHomepageTab(storage?: StorageLike | null): HomepageTab {
  try {
    const value = availableStorage(storage)?.getItem(TAB_KEY);
    return value === "svetserialu" || value === "bombuj" ? value : "home";
  } catch {
    return "home";
  }
}

export function writeHomepageTab(tab: HomepageTab, storage?: StorageLike | null) {
  try {
    availableStorage(storage)?.setItem(TAB_KEY, tab);
  } catch {
    // Homepage remains usable without persistent storage.
  }
}
