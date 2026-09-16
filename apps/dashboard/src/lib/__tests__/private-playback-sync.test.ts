import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { applyPrivatePlaybackProgress, playbackIdentity, queuePrivatePlaybackProgress, startPrivatePlaybackSync } from "../private-playback-sync";
import { mergePlaybackProgress } from "../../../../../packages/storage/src/playback-progress";
import type { LibraryState } from "../types";

const connection = vi.hoisted(() => ({ nodeUrl: "https://private.example", accountId: "watcher", profileId: "main", token: "test-token", accountName: "Test", profileName: "Main" }));
vi.mock("../private-node-client", () => ({ readPrivateNodeConnection: () => ({ ...connection }) }));
function fixture(): LibraryState {
  return { shows: [{ slug: "local-film", title: "Film", mediaType: "movie", externalIds: { tmdb: "12" }, importedAt: 1, availableSeasons: [1], episodes: [{ id: "local-id", showSlug: "local-film", showTitle: "Film", seasonNumber: 1, episodeNumber: null, episodeCode: "movie", episodeTitle: "Film", episodeUrl: "https://example/film", players: [], selectedPlayerAlias: "none", importedAt: 1, playbackPositionSeconds: 210, playbackDurationSeconds: 3600, playbackUpdatedAt: 1000 }] }], settings: {}, offlineDownloads: {}, query: "" } as LibraryState;
}

describe("private playback sync", () => {
  let stop: (() => void) | undefined;
  beforeEach(() => {
    vi.useFakeTimers();
    connection.profileId = "main";
    const items = new Map<string, string>();
    vi.stubGlobal("localStorage", { getItem: (key: string) => items.get(key) ?? null, setItem: (key: string, value: string) => items.set(key, value) });
    vi.stubGlobal("window", new EventTarget());
    vi.stubGlobal("document", Object.assign(new EventTarget(), { visibilityState: "visible" }));
    vi.stubGlobal("navigator", { onLine: true });
  });
  afterEach(() => { stop?.(); stop = undefined; vi.unstubAllGlobals(); vi.useRealTimers(); });

  it("uses stable title identity across devices and restores the exact saved position", () => {
    const first = fixture();
    const show = first.shows[0];
    const key = playbackIdentity(show, show.episodes[0]);
    const other = fixture();
    other.shows[0].slug = "different-provider";
    other.shows[0].episodes[0].id = "other-device-id";
    const result = applyPrivatePlaybackProgress(other, { [key]: { key, position: 623.75, duration: 3600, watched: false, updatedAt: 2000 } });
    expect(result.shows[0].episodes[0].playbackPositionSeconds).toBe(623.75);
    expect(applyPrivatePlaybackProgress(result, { [key]: { key, position: 2, duration: 3600, watched: false, updatedAt: 900 } })).toBe(result);
  });

  it("sends only queued progress for this profile, not the local library", async () => {
    const state = fixture();
    queuePrivatePlaybackProgress(state, "local-id");
    const fetcher = vi.fn(async (_url: string, options: RequestInit) => {
      const body = JSON.parse(options.body as string);
      return new Response(JSON.stringify({ playbackProgress: mergePlaybackProgress({}, body.playbackProgress) }));
    });
    vi.stubGlobal("fetch", fetcher);
    stop = startPrivatePlaybackSync(connection, { getState: () => state, onState: vi.fn(), onError: vi.fn() });
    await vi.advanceTimersByTimeAsync(0);
    expect(fetcher).toHaveBeenCalledOnce();
    const [url, request] = fetcher.mock.calls[0];
    expect(url).toContain("profileId=main");
    expect(request.headers).toMatchObject({ Authorization: "Bearer test-token" });
    expect(Object.keys(JSON.parse(request.body as string))).toEqual(["playbackProgress"]);
    expect(request.body).not.toContain("players");
    stop();
    connection.profileId = "different-profile";
    const otherFetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ playbackProgressSupported: true, profile: {} })));
    vi.stubGlobal("fetch", otherFetch);
    stop = startPrivatePlaybackSync(connection, { getState: () => state, onState: vi.fn(), onError: vi.fn() });
    await vi.advanceTimersByTimeAsync(0);
    expect(otherFetch.mock.calls[0][1].method).toBe("GET");
  });

  it("retains offline updates and reports unsupported nodes without failing local playback", async () => {
    const state = fixture();
    queuePrivatePlaybackProgress(state, "local-id");
    const onError = vi.fn();
    const fetcher = vi.fn().mockResolvedValue(new Response("Unsupported", { status: 405 }));
    vi.stubGlobal("fetch", fetcher);
    stop = startPrivatePlaybackSync(connection, { getState: () => state, onState: vi.fn(), onError });
    await vi.advanceTimersByTimeAsync(0);
    expect(onError).toHaveBeenCalledOnce();
    expect(state.shows[0].episodes[0].playbackPositionSeconds).toBe(210);
    expect(fetcher.mock.calls[0][1].body).toContain("210");
  });
});
