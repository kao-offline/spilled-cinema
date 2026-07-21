import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readCachedPlayerFailure, readCachedPlayerUrl, writeCachedPlayerFailure, writeCachedPlayerUrl } from "../player-url-cache";

describe("player URL cache", () => {
  beforeEach(() => {
    const store = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => {
        store.set(key, value);
      },
      removeItem: (key: string) => {
        store.delete(key);
      },
      clear: () => {
        store.clear();
      },
    });
  });

  afterEach(() => {
    localStorage.clear();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("stores and reads resolved player URLs", () => {
    writeCachedPlayerUrl("iframe", "provider|https://player.example/embed", "https://cdn.example/embed");

    expect(readCachedPlayerUrl("iframe", "provider|https://player.example/embed")).toBe("https://cdn.example/embed");
  });

  it("ignores expired entries", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-12T10:00:00Z"));
    writeCachedPlayerUrl("clean", "provider|https://player.example/embed", "https://cdn.example/video.m3u8");

    vi.setSystemTime(new Date("2026-06-12T17:00:01Z"));

    expect(readCachedPlayerUrl("clean", "provider|https://player.example/embed")).toBeNull();
  });

  it("stores short-lived clean player failures", () => {
    writeCachedPlayerFailure("clean", "provider|https://player.example/embed", "Could not resolve direct stream URL.");

    expect(readCachedPlayerFailure("clean", "provider|https://player.example/embed")).toBe("Could not resolve direct stream URL.");
  });
});
