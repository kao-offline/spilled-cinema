import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { scheduleEpisodeRefresh } from "../episode-refresh";

describe("episode refresh scheduling", () => {
  const page = Object.assign(new EventTarget(), { visibilityState: "visible" });
  const browser = new EventTarget();
  const network = { onLine: true };
  let stop: (() => void) | undefined;
  beforeEach(() => {
    vi.useFakeTimers();
    page.visibilityState = "visible";
    network.onLine = true;
    vi.stubGlobal("window", browser);
    vi.stubGlobal("document", page);
    vi.stubGlobal("navigator", network);
  });
  afterEach(() => { stop?.(); vi.unstubAllGlobals(); vi.useRealTimers(); });

  it("coalesces focus/online events and does not overlap pending scans", async () => {
    let finish!: (value: boolean) => void;
    const run = vi.fn(() => new Promise<boolean>((resolve) => { finish = resolve; }));
    stop = scheduleEpisodeRefresh(run);
    await vi.advanceTimersByTimeAsync(0);
    for (let i = 0; i < 5; i++) browser.dispatchEvent(new Event("focus"));
    await vi.advanceTimersByTimeAsync(300_000);
    expect(run).toHaveBeenCalledOnce();
    finish(true);
    await vi.advanceTimersByTimeAsync(0);
    browser.dispatchEvent(new Event("online"));
    await vi.advanceTimersByTimeAsync(119_999);
    expect(run).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(1);
    expect(run).toHaveBeenCalledTimes(2);
  });

  it("pauses hidden/offline and checks overdue updates on return", async () => {
    const run = vi.fn().mockResolvedValue(true);
    page.visibilityState = "hidden";
    stop = scheduleEpisodeRefresh(run);
    await vi.advanceTimersByTimeAsync(300_000);
    expect(run).not.toHaveBeenCalled();
    page.visibilityState = "visible";
    network.onLine = false;
    page.dispatchEvent(new Event("visibilitychange"));
    await vi.advanceTimersByTimeAsync(0);
    expect(run).not.toHaveBeenCalled();
    network.onLine = true;
    browser.dispatchEvent(new Event("online"));
    await vi.advanceTimersByTimeAsync(0);
    expect(run).toHaveBeenCalledOnce();
  });

  it("backs off errors and removes scheduled work on cleanup", async () => {
    const run = vi.fn().mockRejectedValue(new Error("offline"));
    stop = scheduleEpisodeRefresh(run);
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(run).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(59_999);
    expect(run).toHaveBeenCalledTimes(2);
    stop();
    await vi.advanceTimersByTimeAsync(300_000);
    expect(run).toHaveBeenCalledTimes(2);
  });
});
