import { describe, expect, it } from "vitest";
import { generateKeyPairSync } from "node:crypto";
import { gunzipSync } from "node:zlib";
import {
  decryptNodeRequest,
  decryptNodeResponse,
  createEncryptedNodeRequest,
  encryptNodeRequest,
  encryptNodeResponse,
  generateNodeIdentity,
  generateNodeTransportIdentity,
  signPayload,
  TicketReplayWindow,
  verifyCapabilityTicket,
} from "../../../../../packages/security/src";
import type { CapabilityTicketV2 } from "../../../../../packages/node-protocol/src";
import { SpilledCinemaNodeRuntime } from "../../../../node/src/runtime";
import type { NodeStateFile, NodeStorage } from "../../../../../packages/storage/src";

describe("node v2 transport security", () => {
  it("derives advertised V2 capabilities from private configuration when no environment override is set", async () => {
    const runtime = new SpilledCinemaNodeRuntime({
      storage: {
        read: async () => ({
          pendingPairings: [], pairedDevices: [], sessions: [], importedShows: [],
          downloads: { updatedAt: 0, episodeIds: [], files: [] }, spillshareSources: [], passkeys: [],
          adminAccounts: [], watcherAccounts: [], watcherProfiles: [], privateAccounts: [], privateProfiles: [],
          privateDownloads: [], privateAuthChallenges: [], refreshSessions: [], watcherInvitations: [],
          recoveryStates: [], securityEvents: [],
        }),
        write: async () => undefined,
      } as NodeStorage,
      mode: "full",
      privateConfig: {
        privateNode: { enabled: true, allowPublicFetch: true },
        publicCapabilities: {
          fetch: true, stream: true, download: true, spillshare: true, relay: true,
        },
        configPath: "test-private-config.json",
        storageRoot: "test-vault",
      },
    });
    await expect(runtime.createGatewayEnrollmentApplication()).resolves.toMatchObject({
      advertisedCapabilities: [
        "download.transient",
        "player.resolve",
        "provider.feed",
        "provider.import",
        "provider.search",
        "relay.stream",
        "spillshare.read",
      ],
    });
  });

  it("encrypts for the node and rejects modified ciphertext", () => {
    const identity = generateNodeIdentity();
    const transport = generateNodeTransportIdentity(identity);
    const envelope = encryptNodeRequest({
      nodeTransportPublicKey: transport.publicKey,
      requestId: "request-1",
      ticketId: "ticket-1",
      issuedAt: 1_000,
      expiresAt: 10_000,
      plaintext: "private payload",
    });

    expect(decryptNodeRequest(envelope, transport.privateKey, 2_000).toString()).toBe("private payload");
    expect(() => decryptNodeRequest({
      ...envelope,
      ciphertext: `${envelope.ciphertext.slice(0, -1)}A`,
    }, transport.privateKey, 2_000)).toThrow();
  });

  it("encrypts responses end to end using the request session key", () => {
    const identity = generateNodeIdentity();
    const transport = generateNodeTransportIdentity(identity);
    const request = createEncryptedNodeRequest({
      nodeTransportPublicKey: transport.publicKey,
      requestId: "request-response-1",
      ticketId: "ticket-response-1",
      issuedAt: 1_000,
      expiresAt: 10_000,
      plaintext: "{}",
    });
    const response = encryptNodeResponse({
      request: request.envelope,
      nodeTransportPrivateKey: transport.privateKey,
      plaintext: JSON.stringify({ ok: true }),
      issuedAt: 2_000,
    });
    expect(JSON.parse(decryptNodeResponse({
      response,
      request: request.envelope,
      clientEphemeralPrivateKey: request.clientEphemeralPrivateKey,
      nodeTransportPublicKey: transport.publicKey,
    }).toString("utf8"))).toEqual({ ok: true });
  });

  it("rejects duplicate ticket and nonce pairs until expiration", () => {
    const replay = new TicketReplayWindow();
    expect(replay.accept("ticket-1", "nonce-1", 5_000, 1_000)).toBe(true);
    expect(replay.accept("ticket-1", "nonce-1", 5_000, 2_000)).toBe(false);
    expect(replay.accept("ticket-1", "nonce-1", 9_000, 6_000)).toBe(true);
  });

  it("verifies node- and capability-scoped asymmetric tickets", () => {
    const keypair = generateKeyPairSync("ed25519");
    const privateKey = keypair.privateKey.export({ type: "pkcs8", format: "pem" }).toString();
    const publicKey = keypair.publicKey.export({ type: "spki", format: "pem" }).toString();
    const unsigned = {
      version: 2 as const,
      ticketId: "ticket-1",
      nodeId: "node-1",
      principalKind: "public" as const,
      capability: "player.resolve" as const,
      action: "resolve",
      maxRequestBytes: 1_024,
      maxResponseBytes: 4_096,
      maxDurationMs: 5_000,
      issuedAt: 1_000,
      expiresAt: 5_000,
      nonce: "nonce",
      keyId: "control-1",
    };
    const ticket: CapabilityTicketV2 = {
      ...unsigned,
      signature: signPayload(unsigned, privateKey),
    };
    expect(verifyCapabilityTicket({
      ticket,
      controlPlanePublicKey: publicKey,
      expectedNodeId: "node-1",
      expectedCapability: "player.resolve",
      now: 2_000,
    })).toBe(true);
    expect(verifyCapabilityTicket({
      ticket,
      controlPlanePublicKey: publicKey,
      expectedNodeId: "node-2",
      expectedCapability: "player.resolve",
      now: 2_000,
    })).toBe(false);
  });

  it("executes a ticket-scoped encrypted RPC and returns encrypted output", async () => {
    let state: NodeStateFile = {
      pendingPairings: [],
      pairedDevices: [],
      sessions: [],
      importedShows: [],
      downloads: { updatedAt: 0, episodeIds: [], files: [] },
      spillshareSources: [],
      passkeys: [],
      adminAccounts: [],
      watcherAccounts: [],
      watcherProfiles: [],
      privateAccounts: [],
      privateProfiles: [],
      privateDownloads: [],
      privateAuthChallenges: [],
      refreshSessions: [],
      watcherInvitations: [],
      recoveryStates: [],
      securityEvents: [],
    };
    const storage: NodeStorage = {
      read: async () => structuredClone(state),
      write: async (next) => {
        state = structuredClone(next);
      },
    };
    const runtime = new SpilledCinemaNodeRuntime({
      storage,
      mode: "local",
      v2PublicCapabilities: new Set(["provider.search"]),
    });
    const identity = await runtime.getTransportIdentityRecord();
    const signer = generateKeyPairSync("ed25519");
    const signerPrivate = signer.privateKey.export({ type: "pkcs8", format: "pem" }).toString();
    const signerPublic = signer.publicKey.export({ type: "spki", format: "pem" }).toString();
    const now = Date.now();
    const unsigned = {
      version: 2 as const,
      ticketId: "ticket-rpc",
      nodeId: identity.nodeId,
      principalKind: "public" as const,
      capability: "provider.search" as const,
      action: "search",
      maxRequestBytes: 16_384,
      maxResponseBytes: 16_384,
      maxDurationMs: 5_000,
      issuedAt: now - 1_000,
      expiresAt: now + 30_000,
      nonce: "ticket-nonce",
      keyId: "test-key",
    };
    const ticket: CapabilityTicketV2 = { ...unsigned, signature: signPayload(unsigned, signerPrivate) };
    const request = createEncryptedNodeRequest({
      nodeTransportPublicKey: identity.x25519PublicKey,
      requestId: "request-rpc",
      ticketId: ticket.ticketId,
      issuedAt: now,
      expiresAt: now + 10_000,
      plaintext: JSON.stringify({ method: "provider.search", params: { query: "Silo" } }),
    });
    const response = await runtime.handleEncryptedRemoteRequest({
      ticket,
      envelope: request.envelope,
      controlPlanePublicKey: signerPublic,
      execute: async ({ params }) => ({ echoed: params }),
    });
    expect(JSON.parse(decryptNodeResponse({
      response,
      request: request.envelope,
      clientEphemeralPrivateKey: request.clientEphemeralPrivateKey,
      nodeTransportPublicKey: identity.x25519PublicKey,
    }).toString("utf8"))).toEqual({
      ok: true,
      result: { echoed: { query: "Silo" } },
    });

    const largeUnsigned = {
      ...unsigned,
      ticketId: "ticket-rpc-large",
      maxRequestBytes: 64 * 1024,
      maxResponseBytes: 4 * 1024 * 1024,
      nonce: "ticket-large-nonce",
    };
    const largeTicket: CapabilityTicketV2 = { ...largeUnsigned, signature: signPayload(largeUnsigned, signerPrivate) };
    const largeRequest = createEncryptedNodeRequest({
      nodeTransportPublicKey: identity.x25519PublicKey,
      requestId: "request-rpc-large",
      ticketId: largeTicket.ticketId,
      issuedAt: now,
      expiresAt: now + 10_000,
      plaintext: JSON.stringify({ method: "provider.search", params: { query: "large" } }),
      acceptEncoding: "gzip",
    });
    const episodes = Array.from({ length: 350 }, (_, index) => ({
      id: `episode-${index}-${"x".repeat(128)}`,
      players: Array.from({ length: 8 }, (_unused, playerIndex) => ({
        embedUrl: `https://storage-${playerIndex}.example/e/${index}/${"token".repeat(12)}`,
      })),
    }));
    const largeResponse = await runtime.handleEncryptedRemoteRequest({
      ticket: largeTicket,
      envelope: largeRequest.envelope,
      controlPlanePublicKey: signerPublic,
      execute: async () => ({ show: { title: "Large", episodes } }),
    });
    expect(largeResponse.contentEncoding).toBe("gzip");
    expect(Buffer.byteLength(JSON.stringify(largeResponse))).toBeLessThan(900 * 1024);
    const compressedPayload = decryptNodeResponse({
      response: largeResponse,
      request: largeRequest.envelope,
      clientEphemeralPrivateKey: largeRequest.clientEphemeralPrivateKey,
      nodeTransportPublicKey: identity.x25519PublicKey,
    });
    expect(JSON.parse(gunzipSync(compressedPayload).toString("utf8")).result.show.episodes).toHaveLength(350);

    await expect(runtime.handleEncryptedRemoteRequest({
      ticket,
      envelope: request.envelope,
      controlPlanePublicKey: signerPublic,
      execute: async () => null,
    })).rejects.toThrow(/replay/i);
  });
});
