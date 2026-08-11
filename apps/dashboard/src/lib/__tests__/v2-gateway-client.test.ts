import { afterEach, describe, expect, it, vi } from "vitest";
import { gzipSync } from "node:zlib";
import {
  decryptNodeRequest,
  encryptNodeResponse,
  generateNodeIdentity,
  generateNodeTransportIdentity,
} from "../../../../../packages/security/src";
import {
  createBrowserEncryptedNodeRequest,
  clearV2GatewaySessionCache,
  decodeBrowserNodeResponse,
  decryptBrowserNodeResponse,
  resolvePrivateGatewayCandidate,
} from "../v2-gateway-client";

afterEach(() => {
  clearV2GatewaySessionCache();
  vi.unstubAllGlobals();
});

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

describe("private gateway node resolution", () => {
  it("resolves exactly one reachable candidate by connection code", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
      candidate: {
        nodeId: "node_7a3f19c288b4d0e1f9a11111",
        connectionCode: "7A3F-19C2-88B4-D0E1",
        online: true,
        identity: { x25519PublicKey: "public-key" },
      },
    }), { status: 200, headers: { "Content-Type": "application/json" } })));

    await expect(resolvePrivateGatewayCandidate("7A3F-19C2-88B4-D0E1")).resolves.toMatchObject({
      nodeId: "node_7a3f19c288b4d0e1f9a11111",
      online: true,
    });
    expect(fetch).toHaveBeenCalledWith(
      "/api/server?path=v2%2Fprivate-nodes%2Fresolve&code=7A3F-19C2-88B4-D0E1",
      { headers: { Accept: "application/json" } },
    );
  });

  it("reuses a recently resolved private candidate across mobile requests", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      candidate: {
        nodeId: "node_cached",
        connectionCode: "1111-2222-3333-4444",
        online: true,
        identity: { x25519PublicKey: "public-key" },
      },
    }), { status: 200, headers: { "Content-Type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);
    await resolvePrivateGatewayCandidate("1111-2222-3333-4444");
    await resolvePrivateGatewayCandidate("1111-2222-3333-4444");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("does not leak control-plane configuration failures", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
      error: "CONVEX_SITE_URL is not configured.",
    }), { status: 500, headers: { "Content-Type": "application/json" } })));

    await expect(resolvePrivateGatewayCandidate("7A3F-19C2-88B4-D0E1"))
      .rejects.toThrow("connection service is temporarily unavailable");
  });
});
