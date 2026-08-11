import { describe, expect, it } from "vitest";
import { formatNodeConnectionCode, normalizeNodeConnectionCode } from "../../../../../packages/node-protocol/src";

describe("private node connection codes", () => {
  it("formats the same readable locator from an opaque credential digest", () => {
    expect(formatNodeConnectionCode("7a3f19c288b4d0e1f9a11111")).toBe("7A3F-19C2-88B4-D0E1");
  });

  it.each([
    "7a3f19c288b4d0e1",
    "7A3F-19C2-88B4-D0E1",
    "spilled 7a3f 19c2 88b4 d0e1",
  ])("normalizes %s", (input) => {
    expect(normalizeNodeConnectionCode(input)).toBe("7A3F-19C2-88B4-D0E1");
  });

  it.each(["", "7A3F-19C2", "ZZZZ-ZZZZ-ZZZZ-ZZZZ"])("rejects malformed code %s", (input) => {
    expect(normalizeNodeConnectionCode(input)).toBeNull();
  });

  it("rejects malformed node identities instead of making ambiguous codes", () => {
    expect(() => formatNodeConnectionCode("short")).toThrow(/digest/i);
  });
});
