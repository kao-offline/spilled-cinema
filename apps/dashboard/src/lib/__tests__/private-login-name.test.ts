import { describe, expect, it } from "vitest";
import {
  normalizeNodeConnectionCode,
  parsePrivateNodeLoginName,
} from "../../../../../packages/node-protocol/src";

describe("private node login input", () => {
  it("parses username.servername logins", () => {
    expect(parsePrivateNodeLoginName("kao.kao-home")).toEqual({
      username: "kao",
      networkName: "kao-home",
    });
  });

  it("normalizes case and surrounding whitespace", () => {
    expect(parsePrivateNodeLoginName("  KAO.KAO-HOME  ")).toEqual({
      username: "kao",
      networkName: "kao-home",
    });
  });

  it("rejects reserved network names and malformed logins", () => {
    expect(parsePrivateNodeLoginName("kao.localhost")).toBeNull();
    expect(parsePrivateNodeLoginName("kao.")).toBeNull();
    expect(parsePrivateNodeLoginName(".kao-home")).toBeNull();
    expect(parsePrivateNodeLoginName("kao-home")).toBeNull();
    expect(parsePrivateNodeLoginName("")).toBeNull();
  });

  it("normalizes recovery connection codes", () => {
    expect(normalizeNodeConnectionCode("7a3f-19c2-88b4-d0e1")).toBe("7A3F-19C2-88B4-D0E1");
    expect(normalizeNodeConnectionCode("  7A3F19C288B4D0E1  ")).toBe("7A3F-19C2-88B4-D0E1");
    expect(parsePrivateNodeLoginName("7A3F-19C2-88B4-D0E1")).toBeNull();
  });

  it("rejects short connection codes", () => {
    expect(normalizeNodeConnectionCode("7A3F-19C2")).toBeNull();
    expect(normalizeNodeConnectionCode("kao.kao-home")).toBeNull();
  });
});
