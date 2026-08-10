import { describe, expect, it } from "vitest";
import { gzipSync } from "node:zlib";
import {
  decryptNodeRequest,
  encryptNodeResponse,
  generateNodeIdentity,
  generateNodeTransportIdentity,
} from "../../../../../packages/security/src";
import {
  createBrowserEncryptedNodeRequest,
  decodeBrowserNodeResponse,
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

  it("negotiates and authenticates compressed node responses", async () => {
    const identity = generateNodeIdentity();
    const transport = generateNodeTransportIdentity(identity);
    const request = createBrowserEncryptedNodeRequest({
      nodeTransportPublicKey: transport.publicKey,
      requestId: "request-browser-gzip",
      ticketId: "ticket-browser-gzip",
      issuedAt: Date.now(),
      expiresAt: Date.now() + 60_000,
      plaintext: JSON.stringify({ method: "provider.import", params: { moduleId: "svetserialu", slug: "large" } }),
      acceptEncoding: "gzip",
    });
    expect(request.envelope.acceptEncoding).toBe("gzip");
    const payload = JSON.stringify({ ok: true, result: { show: { title: "Large", episodes: Array(350).fill({ players: [] }) } } });
    const response = encryptNodeResponse({
      request: request.envelope,
      nodeTransportPrivateKey: transport.privateKey,
      plaintext: gzipSync(payload, { level: 1 }),
      contentEncoding: "gzip",
    });
    expect(await decodeBrowserNodeResponse({
      response,
      request: request.envelope,
      privateKey: request.privateKey,
      nodeTransportPublicKey: transport.publicKey,
    })).toBe(payload);

    expect(() => decryptBrowserNodeResponse({
      response: { ...response, contentEncoding: undefined },
      request: request.envelope,
      privateKey: request.privateKey,
      nodeTransportPublicKey: transport.publicKey,
    })).toThrow();
  });
});
