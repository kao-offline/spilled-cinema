import { describe, expect, it } from "vitest";
import { findSmallBufferGapTarget, formatHlsQualityLabel, getBufferedAheadSeconds, isAppleTouchDevice, isAutoplayPolicyError, selectHlsBufferProfile, shouldPreferNativeHls } from "../../lib/hls-buffering";

describe("HLS buffer profile", () => {
  it("keeps a substantial rolling buffer on phones", () => {
    expect(selectHlsBufferProfile({ compactViewport: true, effectiveType: "4g" })).toMatchObject({
      aheadSeconds: 75,
      maximumAheadSeconds: 180,
    });
  });

  it("respects reduced-data and slow-network connections", () => {
    expect(selectHlsBufferProfile({ compactViewport: true, saveData: true })).toMatchObject({
      aheadSeconds: 30,
      maximumAheadSeconds: 75,
    });
    expect(selectHlsBufferProfile({ effectiveType: "2g" }).bandwidthEstimate).toBe(800_000);
  });

  it("allows a larger ahead buffer on unconstrained desktops", () => {
    expect(selectHlsBufferProfile({ compactViewport: false, effectiveType: "4g" })).toMatchObject({
      aheadSeconds: 120,
      maximumAheadSeconds: 300,
    });
  });

  it("steps into a nearby decoded range instead of stalling before it", () => {
    expect(findSmallBufferGapTarget(525.382809, [{ start: 525.537232, end: 540.54 }]))
      .toBeCloseTo(525.547232, 6);
    expect(findSmallBufferGapTarget(525, [{ start: 527, end: 540 }])).toBeNull();
  });

  it("only counts contiguous media as usable playback headroom", () => {
    expect(getBufferedAheadSeconds(10, [
      { start: 9, end: 24 },
      { start: 24.2, end: 35 },
      { start: 38, end: 50 },
    ])).toBeCloseTo(25);
    expect(getBufferedAheadSeconds(10, [{ start: 12, end: 30 }])).toBe(0);
  });

  it("labels cropped cinematic encodes by their standard source tier", () => {
    expect(formatHlsQualityLabel({ width: 1920, height: 800 }, 2)).toBe("1080p");
    expect(formatHlsQualityLabel({ width: 1280, height: 534 }, 1)).toBe("720p");
    expect(formatHlsQualityLabel({ width: 640, height: 266 }, 0)).toBe("360p");
  });

  it("does not mistake an interrupted or broken source for autoplay blocking", () => {
    expect(isAutoplayPolicyError({ name: "NotAllowedError" })).toBe(true);
    expect(isAutoplayPolicyError({ name: "AbortError" })).toBe(false);
    expect(isAutoplayPolicyError({ name: "NotSupportedError" })).toBe(false);
  });
});

describe("native mobile HLS selection", () => {
  it("uses the native media stack on iPhones", () => {
    expect(shouldPreferNativeHls({
      canPlayNativeHls: true,
      userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)",
      platform: "iPhone",
      maxTouchPoints: 5,
    })).toBe(true);
  });

  it("detects iPads that identify as Macs", () => {
    expect(shouldPreferNativeHls({
      canPlayNativeHls: true,
      userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15)",
      platform: "MacIntel",
      maxTouchPoints: 5,
    })).toBe(true);
  });

  it("keeps Hls.js on desktop and Android", () => {
    expect(shouldPreferNativeHls({
      canPlayNativeHls: true,
      userAgent: "Mozilla/5.0 (Linux; Android 15; Pixel 9)",
      platform: "Linux armv8l",
      maxTouchPoints: 5,
    })).toBe(false);
  });

  it("detects Apple touch devices without requiring native HLS", () => {
    expect(isAppleTouchDevice({
      userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)",
      platform: "iPhone",
      maxTouchPoints: 5,
    })).toBe(true);
    expect(isAppleTouchDevice({
      userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15)",
      platform: "MacIntel",
      maxTouchPoints: 5,
    })).toBe(true);
    expect(isAppleTouchDevice({
      userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
      platform: "Win32",
      maxTouchPoints: 0,
    })).toBe(false);
  });
});
