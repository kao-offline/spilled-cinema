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
  decodeBrowserNodeResponse,
  decryptBrowserNodeResponse,
  requestPrivateGateway,
  resolvePrivateGatewayCandidate,
} from "../v2-gateway-client";

afterEach(() => vi.unstubAllGlobals());

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

  it("does not leak control-plane configuration failures", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
      error: "CONVEX_SITE_URL is not configured.",
    }), { status: 500, headers: { "Content-Type": "application/json" } })));

    await expect(resolvePrivateGatewayCandidate("7A3F-19C2-88B4-D0E1"))
      .rejects.toThrow("connection service is temporarily unavailable");
  });

  it("retries the private node with a fresh ticket after a transient gateway failure", async () => {
    const identity = generateNodeIdentity();
    const transport = generateNodeTransportIdentity(identity);
    let socketAttempt = 0;
    let ticketAttempt = 0;

    class GatewaySocket extends EventTarget {
      constructor(_url: string, _protocols: string[]) {
        super();
        queueMicrotask(() => this.dispatchEvent(new Event("open")));
      }

      send(frame: string) {
        socketAttempt += 1;
        if (socketAttempt === 1) {
          queueMicrotask(() => this.dispatchEvent(new Event("error")));
          return;
        }
        const opaque = JSON.parse(frame) as { body: string };
        const request = JSON.parse(opaque.body);
        const response = encryptNodeResponse({
          request,
          nodeTransportPrivateKey: transport.privateKey,
          plaintext: JSON.stringify({ ok: true, result: { status: "ok" } }),
        });
        queueMicrotask(() => this.dispatchEvent(new MessageEvent("message", {
          data: JSON.stringify({ body: JSON.stringify(response) }),
        })));
      }

      close() {}
    }

    vi.stubGlobal("window", { setTimeout, clearTimeout });
    vi.stubGlobal("WebSocket", GatewaySocket);
    vi.stubGlobal("fetch", vi.fn(async () => {
      ticketAttempt += 1;
      return new Response(JSON.stringify({
        version: 2,
        ticketId: `private-ticket-${ticketAttempt}`,
        nodeId: "node-private-retry",
        principalKind: "private",
        capability: "library.read",
        action: "status.retry-test",
        maxRequestBytes: 1024 * 1024,
        maxResponseBytes: 1024 * 1024,
        maxDurationMs: 5_000,
        issuedAt: Date.now(),
        expiresAt: Date.now() + 60_000,
        nonce: `nonce-${ticketAttempt}`,
        keyId: "test-key",
        signature: "test-signature",
      }), { status: 200, headers: { "Content-Type": "application/json" } });
    }));

    await expect(requestPrivateGateway({
      nodeId: "node-private-retry",
      connectionCode: "7A3F-19C2-88B4-D0E1",
      identity: { x25519PublicKey: transport.publicKey },
    }, "library.read", "status.retry-test", "node.status", {})).resolves.toEqual({ status: "ok" });
    expect(socketAttempt).toBe(2);
    expect(ticketAttempt).toBe(2);
  });
});
