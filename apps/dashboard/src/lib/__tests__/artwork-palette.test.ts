import { describe, expect, it } from "vitest";
import { deriveArtworkPalette } from "../artwork-palette";
describe("artwork ambient palette", () => {
  it("preserves the three image regions while keeping the backlight dark", () => {
    expect(deriveArtworkPalette(new Uint8ClampedArray([255,0,0,255,0,255,0,255,0,0,255,255]),3,1)).toEqual(["rgb(107 0 0)","rgb(0 107 0)","rgb(0 0 107)"]);
  });
  it("ignores transparency and white logos rather than producing bright seams", () => {
    expect(deriveArtworkPalette(new Uint8ClampedArray([255,255,255,255,255,0,0,0,0,0,0,255]),3,1)).toEqual(["rgb(11 17 28)","rgb(11 17 28)","rgb(11 17 28)"]);
  });
});
