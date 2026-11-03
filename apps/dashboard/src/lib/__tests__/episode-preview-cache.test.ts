import { afterEach, describe, expect, it, vi } from "vitest";
import { prefetchEpisodePreviewImages } from "../episode-preview-cache";

afterEach(() => vi.unstubAllGlobals());
describe("episode preview images", () => {
  it("keeps displayable cross-origin URLs instead of creating empty blobs", async () => {
    vi.stubGlobal("window", {});
    const blob = vi.fn();
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, type: "opaque", status: 0, blob })));
    const preview = { episodeNumber: 1, title: null, description: null, runtimeMinutes: null, airDate: null, stillUrl: "https://images.example/episode.jpg" };
    expect(await prefetchEpisodePreviewImages([preview])).toEqual([preview]);
    expect(blob).not.toHaveBeenCalled();
  });
  it("does not turn an HTML error page into a broken image blob", async () => {
    vi.stubGlobal("window", {});
    vi.stubGlobal("fetch", vi.fn(async () => new Response("blocked", { headers: { "Content-Type": "text/html" } })));
    const preview = { episodeNumber: 2, title: null, description: null, runtimeMinutes: null, airDate: null, stillUrl: "https://images.example/blocked.jpg" };
    expect(await prefetchEpisodePreviewImages([preview])).toEqual([preview]);
  });
});
