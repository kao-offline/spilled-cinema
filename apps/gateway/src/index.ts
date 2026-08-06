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
  private static readonly HEARTBEAT_INTERVAL_MS = 10_000;

  private attachment(socket: WebSocket) {
    return socket.deserializeAttachment() as
      | { role: "node"; nodeId: string; maxBytes: number }
      | { role: "client"; clientId: string; maxBytes: number }
      | null;
  }

  private openSocket(tag: "node" | "client", clientId?: string) {
    return this.ctx.getWebSockets(tag).find((socket) => {
      if (socket.readyState !== WebSocket.OPEN) return false;
      const attachment = this.attachment(socket);
      if (!attachment || attachment.role !== tag) return false;
      return attachment.role === "node" || attachment.clientId === clientId;
    });
  }

  private async sendHeartbeat(nodeId: string) {
    const response = await fetch(
      this.env.CONTROL_PLANE_VERIFY_URL.replace(/\/verify$/, "/heartbeat"),
      {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${this.env.GATEWAY_SERVICE_TOKEN}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ nodeId }),
      },
    );
    if (!response.ok) {
      throw new Error(`Control-plane heartbeat failed with status ${response.status}.`);
    }
  }

  async fetch(request: Request) {
    const role = request.headers.get("X-Spilled-Role");
    const maxBytes = Number.parseInt(request.headers.get("X-Spilled-Max-Frame-Bytes") || "1048576", 10);
    if (role !== "node" && role !== "client") {
      return json({ error: "Valid gateway role missing." }, 400);
    }

    const pair = new WebSocketPair();
    const client = pair[0];
    const server = pair[1];
    if (role === "node") {
      const nodeId = request.headers.get("X-Spilled-Node-Id");
      if (!nodeId) return json({ error: "Node ID missing." }, 400);
      for (const existing of this.ctx.getWebSockets("node")) {
        existing.close(4001, "Replaced by a newer authenticated node connection.");
      }
      server.serializeAttachment({ role: "node", nodeId, maxBytes });
      this.ctx.acceptWebSocket(server, ["node"]);
      await this.ctx.storage.put("nodeId", nodeId);
      await this.sendHeartbeat(nodeId);
      await this.ctx.storage.setAlarm(Date.now() + NodeLink.HEARTBEAT_INTERVAL_MS);
    } else {
      const clientId = crypto.randomUUID();
      server.serializeAttachment({ role: "client", clientId, maxBytes });
      this.ctx.acceptWebSocket(server, ["client"]);
    }

    return new Response(null, {
      status: 101,
      webSocket: client,
      headers: { "Sec-WebSocket-Protocol": "spilled-v2" },
    });
  }

  async webSocketMessage(socket: WebSocket, message: string | ArrayBuffer) {
    const attachment = this.attachment(socket);
    if (!attachment) {
      socket.close(4002, "Gateway socket metadata is missing.");
      return;
    }

    try {
      const frame = parseOpaqueRpcFrame(message, attachment.maxBytes);
      if (attachment.role === "node") {
        if (!frame.clientId) {
          throw new Error("Node response is missing client routing ID.");
        }
        if (
          frame.ticket &&
          new TextEncoder().encode(frame.body).byteLength > frame.ticket.maxResponseBytes * 1.5
        ) {
          throw new Error("Node response exceeds ticket quota.");
        }
        this.openSocket("client", frame.clientId)?.send(JSON.stringify(frame));
        return;
      }

      if (!frame.ticket || frame.ticket.ticketId !== frame.ticketId) {
        throw new Error("Client frame is missing its capability ticket.");
      }
      if (new TextEncoder().encode(frame.body).byteLength > frame.ticket.maxRequestBytes * 1.5) {
        throw new Error("Client request exceeds ticket quota.");
      }
      const node = this.openSocket("node");
      if (!node) {
        socket.close(4003, "Node is offline.");
        return;
      }
      node.send(JSON.stringify({ ...frame, clientId: attachment.clientId }));
    } catch {
      socket.close(4002, `Invalid ${attachment.role} frame.`);
    }
  }

  async webSocketClose(socket: WebSocket, code: number, reason: string) {
    socket.close(code, reason);
    const attachment = this.attachment(socket);
    if (attachment?.role === "node" && !this.openSocket("node")) {
      await this.ctx.storage.delete("nodeId");
      await this.ctx.storage.deleteAlarm();
    }
  }

  async webSocketError(socket: WebSocket) {
    socket.close(1011, "Gateway WebSocket error.");
  }

  async alarm() {
    const nodeId = await this.ctx.storage.get<string>("nodeId");
    if (!nodeId || !this.openSocket("node")) {
      await this.ctx.storage.delete("nodeId");
      return;
    }

    try {
      await this.sendHeartbeat(nodeId);
    } finally {
      if (this.openSocket("node")) {
        await this.ctx.storage.setAlarm(Date.now() + NodeLink.HEARTBEAT_INTERVAL_MS);
      }
    }
  }
}
