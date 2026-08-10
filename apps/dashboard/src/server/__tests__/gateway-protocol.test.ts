import { describe, expect, it } from "vitest";
import { parseOpaqueRpcFrame } from "../../../../gateway/src/protocol";

describe("gateway opaque RPC frames", () => {
  it("validates routing metadata without inspecting encrypted bodies", () => {
    expect(parseOpaqueRpcFrame(JSON.stringify({
      version: 2,
      requestId: "request-1",
      ticketId: "ticket-1",
      body: "opaque-ciphertext",
    }), 1_024).body).toBe("opaque-ciphertext");
  });

  it("rejects oversized frames", () => {
    expect(() => parseOpaqueRpcFrame(JSON.stringify({
      version: 2,
      requestId: "request-1",
      ticketId: "ticket-1",
      body: "x".repeat(200),
    }), 100)).toThrow(/exceeds/);
  });
});
