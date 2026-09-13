import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { loadSubtitleTrack } from "../subtitle-track";

class FakeTrack extends EventTarget {
  kind = "";
  default = false;
  label = "";
  srclang = "";
  src = "";
  dataset: Record<string, string> = {};
  track = { mode: "disabled", cues: [{ text: "Hello" }] };
  remove = vi.fn();
}
const definition = { id: "cs:source", src: "https://node.example/subtitles", label: "Czech", srclang: "cs" };
const valid = "WEBVTT\n\n00:00:01.000 --> 00:00:02.000\nHello";

describe("selected subtitle lifecycle", () => {
  let track: FakeTrack;
  let cleanup: (() => void) | undefined;
  const appendChild = vi.fn();
  const video = { appendChild, currentTime: 42, src: "unchanged.mp4" } as unknown as HTMLVideoElement;
  const onError = vi.fn();
  const onReady = vi.fn();
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    track = new FakeTrack();
    vi.stubGlobal("document", { createElement: () => track });
    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:captions");
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
  });
  afterEach(() => { cleanup?.(); cleanup = undefined; vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers(); });

  it("attaches late captions without reinitializing or seeking the video", async () => {
    let resolve!: (response: Response) => void;
    const fetcher = vi.fn(() => new Promise<Response>((done) => { resolve = done; }));
    vi.stubGlobal("fetch", fetcher);
    cleanup = loadSubtitleTrack(video, definition, { onError, onReady });
    expect(appendChild).not.toHaveBeenCalled();
    resolve(new Response(valid));
    await vi.advanceTimersByTimeAsync(0);
    expect(appendChild).toHaveBeenCalledWith(track);
    expect(track.default).toBe(true);
    expect(track.track.mode).toBe("showing");
    track.dispatchEvent(new Event("load"));
    expect(onReady).toHaveBeenCalledOnce();
    expect(fetcher).toHaveBeenCalledOnce();
    expect(video.currentTime).toBe(42);
    expect(video.src).toBe("unchanged.mp4");
    expect(onError).not.toHaveBeenCalled();
  });

  it.each(["", "<!doctype html><h1>Denied</h1>", "WEBVTT\n\nnot captions", "{bad json}"])("reports invalid payload %j without breaking video", async (payload) => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(payload)));
    cleanup = loadSubtitleTrack(video, definition, { onError });
    await vi.advanceTimersByTimeAsync(0);
    expect(onError).toHaveBeenCalledOnce();
    expect(appendChild).not.toHaveBeenCalled();
    expect(video.src).toBe("unchanged.mp4");
  });

  it("aborts stale requests and never attaches or leaks an object URL after Off/unmount", async () => {
    let resolve!: (response: Response) => void;
    const fetcher = vi.fn((_url: string, _options: RequestInit) => new Promise<Response>((done) => { resolve = done; }));
    vi.stubGlobal("fetch", fetcher);
    cleanup = loadSubtitleTrack(video, definition, { onError });
    cleanup();
    cleanup = undefined;
    resolve(new Response(valid));
    await vi.advanceTimersByTimeAsync(0);
    expect(fetcher.mock.calls[0][1].signal?.aborted).toBe(true);
    expect(URL.createObjectURL).not.toHaveBeenCalled();
    expect(appendChild).not.toHaveBeenCalled();
    expect(onError).not.toHaveBeenCalled();
  });

  it("times out a missing response once and supports a fresh retry", async () => {
    vi.stubGlobal("fetch", vi.fn(() => new Promise(() => {})));
    cleanup = loadSubtitleTrack(video, definition, { onError });
    await vi.advanceTimersByTimeAsync(20_000);
    expect(onError).toHaveBeenCalledWith(expect.stringContaining("timed out"));
    expect(track.track.mode).toBe("disabled");
    cleanup();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(valid)));
    cleanup = loadSubtitleTrack(video, definition, { onError, onReady });
    await vi.advanceTimersByTimeAsync(0);
    track.dispatchEvent(new Event("load"));
    expect(onReady).toHaveBeenCalledOnce();
  });

  it("reports native parsing failures and revokes blob URLs on cleanup", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(valid)));
    cleanup = loadSubtitleTrack(video, definition, { onError });
    await vi.advanceTimersByTimeAsync(0);
    track.dispatchEvent(new Event("error"));
    expect(onError).toHaveBeenCalledWith(expect.stringContaining("browser could not read"));
    cleanup();
    cleanup = undefined;
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:captions");
  });
});
