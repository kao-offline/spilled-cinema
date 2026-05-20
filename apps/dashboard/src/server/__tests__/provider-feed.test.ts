import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { loadProviderFeed } from "../provider-feed";

function readFixture(name: string) {
  return readFileSync(new URL(`../__fixtures__/${name}`, import.meta.url), "utf8");
}

const originalFetch = global.fetch;

afterEach(() => {
  global.fetch = originalFetch;
  vi.restoreAllMocks();
});

describe("provider feed adapters", () => {
  it("returns SvetSerialu episode items without collapsing repeated shows", async () => {
    const html = readFixture("svet-episode-cards.html");
    const duplicatedHtml = `${html}\n${html.replace(/s1e04/gi, "s1e05")}`;

    global.fetch = vi.fn(async () =>
      new Response(duplicatedHtml, {
        status: 200,
        headers: {
          "Content-Type": "text/html; charset=utf-8",
        },
      }),
    ) as typeof fetch;

    const feed = await loadProviderFeed({
      moduleId: "svetserialu",
      feedId: "new-episodes",
      limit: 10,
    });

    expect(feed.moduleId).toBe("svetserialu");
    expect(feed.feedId).toBe("new-episodes");
    expect(feed.items).toHaveLength(2);
    expect(feed.items.map((item) => item.slug)).toEqual(["andor", "andor"]);
    expect(feed.items.map((item) => item.episode?.episodeCode)).toEqual(["s1e04", "s1e05"]);
    expect(feed.items[0]?.sectionKeys).toContain("latestEpisodes");
  });
});
