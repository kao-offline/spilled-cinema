import { describe, expect, it } from "vitest";
import { sanitizeEnabledProviderFeeds, toggleEnabledProviderFeed, uniqueEnabledProviderFeeds } from "./provider-feed-storage";
import { DEFAULT_PROVIDER_MODULES } from "./provider-modules-shared";

describe("provider feed storage helpers", () => {
  it("deduplicates enabled provider feeds", () => {
    expect(
      uniqueEnabledProviderFeeds([
        { moduleId: "svetserialu", feedId: "new-episodes" },
        { moduleId: "svetserialu", feedId: "new-episodes" },
      ]),
    ).toEqual([{ moduleId: "svetserialu", feedId: "new-episodes" }]);
  });

  it("removes unknown feeds when sanitizing", () => {
    expect(
      sanitizeEnabledProviderFeeds(
        [
          { moduleId: "svetserialu", feedId: "new-episodes" },
          { moduleId: "missing", feedId: "ghost" },
        ],
        DEFAULT_PROVIDER_MODULES,
      ),
    ).toEqual([{ moduleId: "svetserialu", feedId: "new-episodes" }]);
  });

  it("toggles provider feed membership", () => {
    const feed = { moduleId: "svetserialu", feedId: "new-episodes" };
    const enabled = toggleEnabledProviderFeed([], feed);
    expect(enabled).toEqual([feed]);
    expect(toggleEnabledProviderFeed(enabled, feed)).toEqual([]);
  });
});
