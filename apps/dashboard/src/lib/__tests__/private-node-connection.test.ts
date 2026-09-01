import { describe, expect, it } from "vitest";
import {
  formatNodeConnectionCode,
  normalizeNodeConnectionCode,
  normalizeNodeNetworkName,
  parsePrivateNodeLoginName,
} from "../../../../../packages/node-protocol/src";

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

describe("private node network names", () => {
  it.each([
    ["Home-Cinema", "home-cinema"],
    [" family7 ", "family7"],
    ["abc", "abc"],
  ])("normalizes %s", (input, expected) => {
    expect(normalizeNodeNetworkName(input)).toBe(expected);
  });

  it.each(["ab", "-home", "home-", "home--cinema", "www", "name.with-dot", "UP PER"]) (
    "rejects unsafe network name %s",
    (input) => expect(normalizeNodeNetworkName(input)).toBeNull(),
  );

  it("parses a username and network name at the final dot", () => {
    expect(parsePrivateNodeLoginName("Kao.Home-Cinema")).toEqual({
      username: "kao",
      networkName: "home-cinema",
    });
  });

  it.each(["home-cinema", ".home-cinema", "kao.www", "kao.bad.name", "kao!.home"])(
    "rejects malformed private login %s",
    (input) => expect(parsePrivateNodeLoginName(input)).toBeNull(),
  );
});
