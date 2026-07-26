import { DurableObject } from "cloudflare:workers";
import { parseOpaqueRpcFrame } from "./protocol";

type Env = {
  NODE_LINKS: DurableObjectNamespace<NodeLink>;
  CONTROL_PLANE_VERIFY_URL: string;
  GATEWAY_SERVICE_TOKEN: string;
  MAX_FRAME_BYTES: string;
  TURN_SHARED_SECRET: string;
  TURN_URLS: string;
};

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function nodeIdFromRequest(request: Request) {
  const url = new URL(request.url);
  const routeMatch = url.pathname.match(/^\/v2\/nodes\/([^/]+)\/connect$/);
  if (routeMatch) {
    return routeMatch[1];
  }
  const label = url.hostname.split(".")[0];
  return label && label !== "nodes" ? label : null;
}

function websocketTicket(request: Request) {
  const protocols = request.headers.get("Sec-WebSocket-Protocol")?.split(",").map((value) => value.trim()) ?? [];
  const encoded = protocols.find((value) => value.startsWith("ticket."));
  if (!encoded) {
    return null;
  }
  try {
    const raw = encoded.slice("ticket.".length).replace(/-/g, "+").replace(/_/g, "/");
    return atob(raw + "=".repeat((4 - raw.length % 4) % 4));
  } catch {
    return null;
  }
}

async function verifyConnection(request: Request, env: Env, nodeId: string, role: "node" | "client") {
  const credential = role === "node"
    ? request.headers.get("X-Spilled-Node-Enrollment")
    : websocketTicket(request);
  if (!credential) {
    return false;
  }
  const response = await fetch(env.CONTROL_PLANE_VERIFY_URL, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${env.GATEWAY_SERVICE_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ nodeId, role, credential }),
  });
  return response.ok;
}

async function verifyCredential(env: Env, nodeId: string, role: "node" | "client", credential: string) {
  const response = await fetch(env.CONTROL_PLANE_VERIFY_URL, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${env.GATEWAY_SERVICE_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ nodeId, role, credential }),
  });
  return response.ok;
}

function bytesToBase64(bytes: ArrayBuffer) {
  let binary = "";
  for (const byte of new Uint8Array(bytes)) binary += String.fromCharCode(byte);
  return btoa(binary);
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === "/v2/health/live") {
      return json({ status: "ok" });
    }
    if (url.pathname === "/v2/turn-credentials" && request.method === "POST") {
      const body = await request.json().catch(() => ({})) as {
        nodeId?: unknown;
        ticket?: unknown;
      };
      if (typeof body.nodeId !== "string" || !body.ticket || typeof body.ticket !== "object") {
        return json({ error: "nodeId and ticket are required." }, 400);
      }
      const ticket = body.ticket as { ticketId?: unknown; expiresAt?: unknown };
      const credential = JSON.stringify(body.ticket);
      if (
        typeof ticket.ticketId !== "string" ||
        typeof ticket.expiresAt !== "number" ||
        !await verifyCredential(env, body.nodeId, "client", credential)
      ) {
        return json({ error: "Capability ticket rejected." }, 401);
      }
      const expiresAt = Math.min(ticket.expiresAt, Date.now() + 5 * 60_000);
      const username = `${Math.floor(expiresAt / 1000)}:${ticket.ticketId}:${body.nodeId}`;
      const key = await crypto.subtle.importKey(
        "raw",
        new TextEncoder().encode(env.TURN_SHARED_SECRET),
        { name: "HMAC", hash: "SHA-1" },
        false,
        ["sign"],
      );
      const password = bytesToBase64(await crypto.subtle.sign(
        "HMAC",
        key,
        new TextEncoder().encode(username),
      ));
      return json({
        urls: env.TURN_URLS.split(",").map((entry) => entry.trim()).filter(Boolean),
        username,
        credential: password,
        expiresAt,
        iceTransportPolicy: "relay",
      });
    }
    if (request.headers.get("Upgrade")?.toLowerCase() !== "websocket") {
      return json({ error: "WebSocket upgrade required." }, 426);
    }
    const nodeId = nodeIdFromRequest(request);
    const role = url.searchParams.get("role");
    if (!nodeId || (role !== "node" && role !== "client")) {
      return json({ error: "A node ID and valid role are required." }, 400);
    }
    if (!await verifyConnection(request, env, nodeId, role)) {
      return json({ error: "Gateway connection was not authorized." }, 401);
    }
    const id = env.NODE_LINKS.idFromName(nodeId);
    const headers = new Headers(request.headers);
    headers.set("X-Spilled-Role", role);
    headers.set("X-Spilled-Node-Id", nodeId);
    headers.set("X-Spilled-Max-Frame-Bytes", env.MAX_FRAME_BYTES);
    return env.NODE_LINKS.get(id).fetch(new Request(request, {
      headers,
    }));
  },
} satisfies ExportedHandler<Env>;

export class NodeLink extends DurableObject<Env> {
  private nodeSocket: WebSocket | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private readonly clients = new Map<string, WebSocket>();

  async fetch(request: Request) {
    const role = request.headers.get("X-Spilled-Role");
    const pair = new WebSocketPair();
    const client = pair[0];
    const server = pair[1];
    server.accept();
    const maxBytes = Number.parseInt(request.headers.get("X-Spilled-Max-Frame-Bytes") || "1048576", 10);

    if (role === "node") {
      const nodeId = request.headers.get("X-Spilled-Node-Id");
      if (!nodeId) return json({ error: "Node ID missing." }, 400);
      this.nodeSocket?.close(4001, "Replaced by a newer authenticated node connection.");
      this.nodeSocket = server;
      if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
      const heartbeat = () => {
        void fetch(this.env.CONTROL_PLANE_VERIFY_URL.replace(/\/verify$/, "/heartbeat"), {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${this.env.GATEWAY_SERVICE_TOKEN}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ nodeId }),
        });
      };
      heartbeat();
      this.heartbeatTimer = setInterval(heartbeat, 30_000);
      server.addEventListener("message", (event) => {
        try {
          const frame = parseOpaqueRpcFrame(event.data, maxBytes);
          if (!frame.clientId) {
            throw new Error("Node response is missing client routing ID.");
          }
          if (frame.ticket && new TextEncoder().encode(frame.body).byteLength > frame.ticket.maxResponseBytes * 1.5) {
            throw new Error("Node response exceeds ticket quota.");
          }
          this.clients.get(frame.clientId)?.send(JSON.stringify(frame));
        } catch {
          server.close(4002, "Invalid node frame.");
        }
      });
      server.addEventListener("close", () => {
        if (this.nodeSocket === server) {
          this.nodeSocket = null;
          if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
          this.heartbeatTimer = null;
        }
      });
    } else {
      const clientId = crypto.randomUUID();
      this.clients.set(clientId, server);
      server.addEventListener("message", (event) => {
        try {
          const frame = parseOpaqueRpcFrame(event.data, maxBytes);
          if (!frame.ticket || frame.ticket.ticketId !== frame.ticketId) {
            throw new Error("Client frame is missing its capability ticket.");
          }
          if (new TextEncoder().encode(frame.body).byteLength > frame.ticket.maxRequestBytes * 1.5) {
            throw new Error("Client request exceeds ticket quota.");
          }
          if (!this.nodeSocket || this.nodeSocket.readyState !== WebSocket.OPEN) {
            server.close(4003, "Node is offline.");
            return;
          }
          this.nodeSocket.send(JSON.stringify({ ...frame, clientId }));
        } catch {
          server.close(4002, "Invalid client frame.");
        }
      });
      server.addEventListener("close", () => this.clients.delete(clientId));
    }

    return new Response(null, {
      status: 101,
      webSocket: client,
      headers: { "Sec-WebSocket-Protocol": "spilled-v2" },
    });
  }
}
