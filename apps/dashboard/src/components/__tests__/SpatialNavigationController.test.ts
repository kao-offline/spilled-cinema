import { describe, expect, it } from "vitest";
import { findBestSpatialCandidate, type SpatialDirection } from "../../lib/spatial-navigation";

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
});
