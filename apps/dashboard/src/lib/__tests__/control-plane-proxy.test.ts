import { describe, expect, it } from "vitest";
// @ts-expect-error The Vercel API helper is plain JavaScript.
import { buildControlPlaneTarget } from "../../../api/_lib/control-plane-proxy.js";

describe("control-plane proxy target builder", () => {
  it("maps deployed query-style discovery requests to Convex routes", () => {
    const target = buildControlPlaneTarget("https://convex.example", {
      url: "/api/server?path=discovery%2Fnodes&capability=fetch&limit=12",
      query: { path: "discovery/nodes" },
    });

    expect(target).toBe("https://convex.example/server/discovery/nodes?capability=fetch&limit=12");
  });

  it("maps catch-all server paths to Convex routes", () => {
    const target = buildControlPlaneTarget("https://convex.example/", {
      url: "/api/server/provider-modules",
      query: { path: ["provider-modules"] },
    });

    expect(target).toBe("https://convex.example/server/provider-modules");
  });
});
