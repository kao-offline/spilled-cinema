import { describe, expect, it } from "vitest";
import { planAutoRailStep } from "../tv-auto-rail";

describe("tv auto-rail step planner", () => {
  it("stays put when the rail fits on screen", () => {
    expect(planAutoRailStep({ scrollLeft: 0, max: 4, dir: 1, step: 300 })).toEqual({
      next: 0,
      dir: 1,
      settled: true,
    });
  });

  it("drifts forward one page", () => {
    expect(planAutoRailStep({ scrollLeft: 0, max: 1000, dir: 1, step: 300 })).toEqual({
      next: 300,
      dir: 1,
      settled: false,
    });
  });

  it("reverses at the far end instead of jumping back", () => {
    expect(planAutoRailStep({ scrollLeft: 800, max: 1000, dir: 1, step: 300 })).toEqual({
      next: 1000,
      dir: -1,
      settled: false,
    });
  });

  it("reverses at the start", () => {
    expect(planAutoRailStep({ scrollLeft: 100, max: 1000, dir: -1, step: 300 })).toEqual({
      next: 0,
      dir: 1,
      settled: false,
    });
  });

  it("keeps drifting backward mid-rail", () => {
    expect(planAutoRailStep({ scrollLeft: 600, max: 1000, dir: -1, step: 300 })).toEqual({
      next: 300,
      dir: -1,
      settled: false,
    });
  });
});
