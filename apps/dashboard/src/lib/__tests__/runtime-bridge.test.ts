import { beforeEach, describe, expect, it, vi } from "vitest";
import { buildFetchServerStatusUrl } from "../runtime-bridge";

describe("buildFetchServerStatusUrl", () => {
  beforeEach(() => {
    vi.stubGlobal("window", {
      location: {
        origin: "https://spilled.test",
      },
    });
  });

  it("proxies localtunnel status checks through same-origin Vercel API", () => {
    expect(buildFetchServerStatusUrl("https://fetch-node.loca.lt")).toBe(
      "https://spilled.test/api/node-proxy?node=https%3A%2F%2Ffetch-node.loca.lt&path=%2Fapi%2Fstatus",
    );
  });

  it("checks non-localtunnel origins directly", () => {
    expect(buildFetchServerStatusUrl("https://fetch.example.test")).toBe("https://fetch.example.test/api/status");
  });
});
