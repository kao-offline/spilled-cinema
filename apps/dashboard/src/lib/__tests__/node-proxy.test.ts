import { describe, expect, it } from "vitest";
// @ts-expect-error The Vercel API route is plain JavaScript.
import { isAllowedNodeOrigin, isAllowedNodePath } from "../../../api/node-proxy.js";

describe("node proxy allowlist", () => {
  it("allows public localtunnel fetch node origins", () => {
    expect(isAllowedNodeOrigin("https://fetch-node.loca.lt")).toBe(true);
    expect(isAllowedNodeOrigin("http://fetch-node.loca.lt")).toBe(false);
    expect(isAllowedNodeOrigin("https://example.com")).toBe(false);
  });

  it("allows public fetch server routes used by hosted search", () => {
    expect(isAllowedNodePath("/api/search")).toBe(true);
    expect(isAllowedNodePath("/api/provider-search")).toBe(true);
    expect(isAllowedNodePath("/api/provider-feed")).toBe(true);
    expect(isAllowedNodePath("/api/import-svetserialu")).toBe(true);
    expect(isAllowedNodePath("/api/player/resolve")).toBe(true);
  });

  it("rejects private node routes", () => {
    expect(isAllowedNodePath("/api/node/admin/status")).toBe(false);
    expect(isAllowedNodePath("/api/node/private/library")).toBe(false);
  });
});
