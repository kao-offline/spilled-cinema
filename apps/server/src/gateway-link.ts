import { createPublicKey } from "node:crypto";
import WebSocket from "ws";
import type {
  CapabilityTicketV2,
  EncryptedRequestEnvelopeV2,
} from "../../../packages/node-protocol/src";
import type { SpilledCinemaNodeRuntime } from "../../node/src/runtime";

type GatewayFrame = {
  version: 2;
  requestId: string;
  ticketId: string;
  clientId?: string;
  ticket: CapabilityTicketV2;
  body: string;
};

type GatewayLinkOptions = {
  gatewayUrl: string;
  enrollmentCredential: string;
  jwksUrl: string;
  runtime: SpilledCinemaNodeRuntime;
  execute: Parameters<SpilledCinemaNodeRuntime["handleEncryptedRemoteRequest"]>[0]["execute"];
  onReconnectStalled?: () => void;
};

type JwksResponse = {
  keys: Array<JsonWebKey & { kid?: string }>;
};

export class ManagedGatewayLink {
  private static readonly PING_INTERVAL_MS = 20_000;
  private static readonly PONG_TIMEOUT_MS = 50_000;
  private socket: WebSocket | null = null;
  private stopped = true;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private pingTimer: NodeJS.Timeout | null = null;
  private lastPongAt = 0;
  private reconnectAttempts = 0;
  private jwksCache: { expiresAt: number; keys: Map<string, string> } | null = null;
  private readonly options: GatewayLinkOptions;

  constructor(options: GatewayLinkOptions) {
    this.options = options;
  }

  start() {
    if (!this.stopped) return;
    this.stopped = false;
    void this.connect();
  }

  stop() {
    this.stopped = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.stopHeartbeat();
    this.socket?.close(1000, "Node shutting down.");
    this.socket = null;
  }

  getStatus() {
    return {
      connected: this.socket?.readyState === WebSocket.OPEN,
      reconnectAttempts: this.reconnectAttempts,
    };
  }

  setEnrollmentCredential(credential: string) {
    if (!credential) return;
    if (this.options.enrollmentCredential === credential) return;
    this.options.enrollmentCredential = credential;
    console.log("[managed-gateway] enrollment credential refreshed");
    const socket = this.socket;
    if (socket && socket.readyState === WebSocket.OPEN) {
      // Rotate the live link so the new credential is used on the next reconnect.
      socket.close(1000, "Enrollment credential rotated.");
    }
  }

  reconnectNow(reason = "Gateway link refresh requested.") {
    if (this.stopped) return;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.stopHeartbeat();
    const socket = this.socket;
    this.socket = null;
    if (socket && (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING)) {
      console.warn(`[managed-gateway] ${reason} Reconnecting now.`);
      socket.terminate();
    }
    void this.connect();
  }

  private async connect() {
    if (this.stopped) return;
    try {
      const identity = await this.options.runtime.getTransportIdentityRecord();
      const base = this.options.gatewayUrl.replace(/\/$/, "").replace(/^http/, "ws");
      const url = `${base}/v2/nodes/${encodeURIComponent(identity.nodeId)}/connect?role=node`;
      console.log(`[managed-gateway] connecting to gateway as ${identity.nodeId}...`);
      const socket = new WebSocket(url, ["spilled-v2"], {
        headers: {
          "X-Spilled-Node-Enrollment": this.options.enrollmentCredential,
          "X-Spilled-Protocol-Version": "2",
        },
        maxPayload: 1024 * 1024,
        handshakeTimeout: 15_000,
      });
      this.socket = socket;
      socket.on("open", () => {
        this.reconnectAttempts = 0;
        this.startHeartbeat(socket);
        console.log("[managed-gateway] encrypted node link connected");
      });
      socket.on("pong", () => {
        if (this.socket === socket) this.lastPongAt = Date.now();
      });
      socket.on("message", (data) => {
        void this.handleFrame(data.toString()).catch((error) => {
          console.error(
            "[managed-gateway] rejected RPC frame:",
            error instanceof Error ? error.message : String(error),
          );
          socket.close(4002, "Invalid or unauthorized RPC frame.");
        });
      });
      socket.on("close", (code, reason) => {
        console.warn(`[managed-gateway] node link closed (${code}: ${reason.toString() || "no reason"})`);
        if (this.socket === socket) {
          this.stopHeartbeat();
          this.socket = null;
          this.scheduleReconnect();
        }
      });
      socket.on("error", (error) => {
        console.warn(`[managed-gateway] node link error: ${error.message}`);
        // close schedules the bounded retry.
      });
    } catch (error) {
      console.warn(
        "[managed-gateway] node link setup failed:",
        error instanceof Error ? error.message : String(error),
      );
      this.scheduleReconnect();
    }
  }

  private startHeartbeat(socket: WebSocket) {
    this.stopHeartbeat();
    this.lastPongAt = Date.now();
    this.pingTimer = setInterval(() => {
      if (this.stopped || this.socket !== socket || socket.readyState !== WebSocket.OPEN) {
        this.stopHeartbeat();
        return;
      }
      if (Date.now() - this.lastPongAt > ManagedGatewayLink.PONG_TIMEOUT_MS) {
        console.warn("[managed-gateway] node link heartbeat timed out; reconnecting");
        socket.terminate();
        return;
      }
      socket.ping();
    }, ManagedGatewayLink.PING_INTERVAL_MS);
    this.pingTimer.unref?.();
  }

  private stopHeartbeat() {
    if (this.pingTimer) clearInterval(this.pingTimer);
    this.pingTimer = null;
    this.lastPongAt = 0;
  }

  private scheduleReconnect() {
    if (this.stopped || this.reconnectTimer) return;
    this.reconnectAttempts += 1;
    // A control-plane outage can last for hours (for example after a quota
    // guard disables the deployment). Keep quick recovery for short blips,
    // then back off far enough that an outage cannot become its own traffic
    // storm.
    const base = Math.min(5 * 60_000, 500 * 2 ** Math.min(this.reconnectAttempts, 10));
    const delay = Math.floor(base * (0.75 + Math.random() * 0.5));
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      void this.connect();
    }, delay);
    this.reconnectTimer.unref?.();
    if (this.reconnectAttempts === 4) {
      this.options.onReconnectStalled?.();
    }
  }

  private async loadSigningKey(keyId: string) {
    const now = Date.now();
    if (!this.jwksCache || this.jwksCache.expiresAt <= now) {
      const response = await fetch(this.options.jwksUrl, {
        headers: { Accept: "application/json" },
        signal: AbortSignal.timeout(10_000),
      });
      if (!response.ok) throw new Error(`JWKS request failed with ${response.status}.`);
      const payload = await response.json() as JwksResponse;
      const keys = new Map<string, string>();
      for (const jwk of payload.keys ?? []) {
        if (jwk.kid && jwk.kty === "OKP" && jwk.crv === "Ed25519") {
          keys.set(jwk.kid, createPublicKey({
            key: jwk as import("node:crypto").JsonWebKey,
            format: "jwk",
          }).export({
            type: "spki",
            format: "pem",
          }).toString());
        }
      }
      this.jwksCache = { keys, expiresAt: now + 5 * 60_000 };
    }
    const key = this.jwksCache.keys.get(keyId);
    if (!key) throw new Error(`Control-plane signing key "${keyId}" is unavailable.`);
    return key;
  }

  private async handleFrame(raw: string) {
    const frame = JSON.parse(raw) as Partial<GatewayFrame>;
    if (
      frame.version !== 2 ||
      typeof frame.requestId !== "string" ||
      typeof frame.ticketId !== "string" ||
      typeof frame.body !== "string" ||
      !frame.ticket ||
      frame.ticket.ticketId !== frame.ticketId
    ) {
      throw new Error("Gateway RPC frame is invalid.");
    }
    const envelope = JSON.parse(frame.body) as EncryptedRequestEnvelopeV2;
    if (envelope.requestId !== frame.requestId || envelope.ticketId !== frame.ticketId) {
      throw new Error("Gateway routing metadata does not match the encrypted envelope.");
    }
    const response = await this.options.runtime.handleEncryptedRemoteRequest({
      ticket: frame.ticket,
      envelope,
      controlPlanePublicKey: await this.loadSigningKey(frame.ticket.keyId),
      execute: this.options.execute,
    });
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
      throw new Error("Gateway disconnected before the RPC response was ready.");
    }
    this.socket.send(JSON.stringify({
      version: 2,
      requestId: frame.requestId,
      ticketId: frame.ticketId,
      clientId: frame.clientId,
      ticket: frame.ticket,
      body: JSON.stringify(response),
    } satisfies GatewayFrame));
  }
}
