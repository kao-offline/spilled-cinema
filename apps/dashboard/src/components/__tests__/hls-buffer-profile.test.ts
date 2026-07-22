import { describe, expect, it } from "vitest";
import { findSmallBufferGapTarget, selectHlsBufferProfile } from "../../lib/hls-buffering";

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
});
