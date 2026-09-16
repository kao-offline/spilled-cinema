import { describe, expect, it } from "vitest";
import { findBestSpatialCandidate, rankSpatialCandidates, type SpatialDirection } from "../../lib/spatial-navigation";

function rect(left: number, top: number, width = 100, height = 100) {
  return { left, top, right: left + width, bottom: top + height, width, height };
}

describe("spatial navigation", () => {
  it.each([
    ["left", "left"],
    ["right", "right"],
    ["up", "up"],
    ["down", "down"],
  ] as Array<[SpatialDirection, string]>)('moves %s to the nearest control in that direction', (direction, expected) => {
    const candidates = [
      { id: "left", rect: rect(-130, 0) },
      { id: "right", rect: rect(130, 0) },
      { id: "up", rect: rect(0, -130) },
      { id: "down", rect: rect(0, 130) },
    ];

    expect(findBestSpatialCandidate(rect(0, 0), candidates, direction)?.id).toBe(expected);
  });

  it("prefers a control in the same visual row", () => {
    const candidates = [
      { id: "next-card", rect: rect(140, 0) },
      { id: "diagonal-card", rect: rect(105, 150) },
    ];

    expect(findBestSpatialCandidate(rect(0, 0), candidates, "right")?.id).toBe("next-card");
  });

  it("ranks every candidate in walk order so repeated presses advance", () => {
    const candidates = [
      { id: "card-a", rect: rect(140, 0) },
      { id: "card-b", rect: rect(280, 0) },
      { id: "other-row", rect: rect(140, 200) },
    ];

    // The other row is a different lane: right never leaves the row.
    expect(rankSpatialCandidates(rect(0, 0), candidates, "right").map((entry) => entry.id)).toEqual([
      "card-a",
      "card-b",
    ]);
  });

  it("keeps DOM order on ties instead of flickering", () => {
    const candidates = [
      { id: "first", rect: rect(140, 0) },
      { id: "second", rect: rect(140, 0) },
    ];

    expect(rankSpatialCandidates(rect(0, 0), candidates, "right").map((entry) => entry.id)).toEqual([
      "first",
      "second",
    ]);
  });

  it("ignores controls behind the cursor", () => {
    const candidates = [
      { id: "behind", rect: rect(-140, 0) },
      { id: "ahead", rect: rect(140, 0) },
    ];

    expect(rankSpatialCandidates(rect(0, 0), candidates, "right").map((entry) => entry.id)).toEqual(["ahead"]);
  });

  it("stops at the end of a row instead of dropping diagonally", () => {
    // Header edge case: nothing directly right of the last item, only a
    // card down-and-right. Right must hold still, not jump "randomly" down.
    const candidates = [
      { id: "down-right-card", rect: rect(1100, 300, 200, 120) },
    ];

    expect(rankSpatialCandidates(rect(900, 0, 80, 64), candidates, "right")).toEqual([]);
    expect(findBestSpatialCandidate(rect(900, 0, 80, 64), candidates, "right")).toBeNull();
  });

  it("never jumps sideways on a vertical press", () => {
    const candidates = [
      { id: "sideways", rect: rect(400, 110, 100, 60) },
    ];

    expect(rankSpatialCandidates(rect(0, 100, 120, 64), candidates, "down")).toEqual([]);
  });

  it("walks a column on repeated vertical presses", () => {
    const candidates = [
      { id: "below-a", rect: rect(0, 200, 120, 64) },
      { id: "below-b", rect: rect(0, 300, 120, 64) },
      { id: "side-row", rect: rect(500, 200, 120, 64) },
    ];

    expect(rankSpatialCandidates(rect(0, 100, 120, 64), candidates, "down").map((entry) => entry.id)).toEqual([
      "below-a",
      "below-b",
    ]);
  });
});
