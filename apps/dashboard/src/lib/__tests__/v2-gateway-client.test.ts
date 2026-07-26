import { describe, expect, it } from "vitest";
import {
  decryptNodeRequest,
  encryptNodeResponse,
  generateNodeIdentity,
  generateNodeTransportIdentity,
} from "../../../../../packages/security/src";
import {
  createBrowserEncryptedNodeRequest,
  decryptBrowserNodeResponse,
} from "../v2-gateway-client";

describe("browser v2 gateway crypto", () => {
  it("is compatible with the node X25519 and ChaCha20-Poly1305 envelopes", () => {
    const identity = generateNodeIdentity();
    const transport = generateNodeTransportIdentity(identity);
    const request = createBrowserEncryptedNodeRequest({
      nodeTransportPublicKey: transport.publicKey,
      requestId: "request-browser-1",
      ticketId: "ticket-browser-1",
      issuedAt: Date.now(),
      expiresAt: Date.now() + 60_000,
      plaintext: JSON.stringify({ method: "provider.search", params: { moduleId: "bombuj", query: "Silo" } }),
    });

    expect(JSON.parse(decryptNodeRequest(request.envelope, transport.privateKey).toString("utf8"))).toEqual({
      method: "provider.search",
      params: { moduleId: "bombuj", query: "Silo" },
    });

    const response = encryptNodeResponse({
      request: request.envelope,
      nodeTransportPrivateKey: transport.privateKey,
      plaintext: JSON.stringify({ ok: true, result: { results: [] } }),
    });
    expect(JSON.parse(decryptBrowserNodeResponse({
      response,
      request: request.envelope,
      privateKey: request.privateKey,
      nodeTransportPublicKey: transport.publicKey,
    }))).toEqual({
      ok: true,
      result: { results: [] },
    });
  });
});
