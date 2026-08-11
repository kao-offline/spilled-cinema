import WebSocket from "ws";
import {
  createBrowserEncryptedNodeRequest,
  decodeBrowserNodeResponse,
  type V2Candidate,
} from "../../dashboard/src/lib/v2-gateway-client";

const dashboardUrl = process.env.SPILLED_LIVE_DASHBOARD_URL ?? "https://spilled.overload.studio";
const gatewayUrl = process.env.SPILLED_LIVE_GATEWAY_URL ?? "https://spilled-node-gateway.4thsj85ywn.workers.dev";

type Ticket = {
  version: 2;
  ticketId: string;
  nodeId: string;
  expiresAt: number;
  maxDurationMs: number;
};

type ResponseEnvelope = Parameters<typeof decodeBrowserNodeResponse>[0]["response"];

async function json<T>(url: string, init?: RequestInit) {
  const response = await fetch(url, init);
  const payload = await response.json().catch(() => null) as T | null;
  if (!response.ok || !payload) throw new Error(`HTTP ${response.status} from ${new URL(url).pathname}.`);
  return payload;
}

function ticketProtocol(ticket: Ticket) {
  return `ticket.${Buffer.from(JSON.stringify(ticket), "utf8").toString("base64url")}`;
}

async function main() {
  const discovery = await json<{ candidates?: V2Candidate[] }>(
    `${dashboardUrl}/api/server?path=v2%2Fdiscovery%2Fnodes&capability=player.resolve&limit=8`,
  );
  const candidate = discovery.candidates?.[0];
  if (!candidate) throw new Error("No verified public player.resolve node was discovered.");

  const ticket = await json<Ticket>(`${dashboardUrl}/api/server?path=v2%2Ftickets`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      nodeId: candidate.nodeId,
      capability: "player.resolve",
      action: "resolve",
    }),
  });

  const requestId = crypto.randomUUID();
  const encrypted = createBrowserEncryptedNodeRequest({
    nodeTransportPublicKey: candidate.identity.x25519PublicKey,
    requestId,
    ticketId: ticket.ticketId,
    issuedAt: Date.now(),
    expiresAt: ticket.expiresAt,
    plaintext: JSON.stringify({
      method: "player.playback.resolve",
      params: {
        episodeId: "arcane:s02e09",
        showTitle: "Arcane",
        episodeTitle: "The Dirt Under Your Nails",
        seasonNumber: 2,
        episodeNumber: 9,
        activePlayerAlias: "monozip-2",
        players: [
          {
            alias: "file-1",
            provider: "filemoon",
            label: "File",
            language: "English audio + CZ/SK subtitles",
            embedUrl: "https://gn1r5n.org/e/ztchbzhw8pt7?sub.info=https://svetserialu.to/jsonsubs/4/110109",
            sourcePageUrl: "https://svetserialu.to/sources/filemoon?getID=9621eb98-2cc4-45b7-999c-fe399b37c856&sourceId=4&episodeId=110109",
          },
          {
            alias: "monozip-2",
            provider: "vidmoly",
            label: "MonoZip",
            language: "English audio + CZ/SK subtitles",
            embedUrl: "https://vidmoly.net/embed-z9xvht44x3hw.html?directSRT=true&sub=https://subtitles.cdnsvt.nl/arcane-s2-e9-czsk-1732349362.vtt&sub_label=czech&sub_default=1&sub2=https://subtitles.cdnsvt.nl/arcane-s2-e9-en-1732349362.vtt&sub2_label=english&sub_default_lang=czech",
            sourcePageUrl: "https://svetserialu.to/sources/vidmoly?getID=9621eb98-2cc4-45b7-999c-fe399b37c856&sourceId=4&episodeId=110109",
          },
          {
            alias: "nextdrop-3",
            provider: "mixdrop",
            label: "NextDrop",
            language: "English audio + CZ/SK subtitles",
            embedUrl: "https://mixdrop.ag/e/369pe4vohn0olq?directSRT=true&sub=https://subtitles.cdnsvt.nl/arcane-s2-e9-czsk-1732349362.vtt&sub_label=czsk&sub1=https://subtitles.cdnsvt.nl/arcane-s2-e9-en-1732349362.vtt&sub1_label=english",
            sourcePageUrl: "https://svetserialu.to/sources/mixdrop?getID=9621eb98-2cc4-45b7-999c-fe399b37c856&sourceId=4&episodeId=110109",
          },
        ],
      },
    }),
    acceptEncoding: "gzip",
  });

  const wsUrl = new URL(gatewayUrl);
  wsUrl.protocol = wsUrl.protocol === "https:" ? "wss:" : "ws:";
  wsUrl.pathname = `/v2/nodes/${encodeURIComponent(candidate.nodeId)}/connect`;
  wsUrl.search = "?role=client";

  const envelope = await new Promise<ResponseEnvelope>((resolve, reject) => {
    const socket = new WebSocket(wsUrl, ["spilled-v2", ticketProtocol(ticket)]);
    const timeout = setTimeout(() => {
      socket.close();
      reject(new Error("Production gateway playback probe timed out."));
    }, Math.min(ticket.maxDurationMs + 5_000, 95_000));
    socket.once("open", () => socket.send(JSON.stringify({
      version: 2,
      requestId,
      ticketId: ticket.ticketId,
      ticket,
      body: JSON.stringify(encrypted.envelope),
    })));
    socket.once("message", (data) => {
      clearTimeout(timeout);
      try {
        const frame = JSON.parse(String(data)) as { body?: string };
        if (!frame.body) throw new Error("Gateway response body is missing.");
        resolve(JSON.parse(frame.body) as ResponseEnvelope);
      } catch (error) {
        reject(error);
      } finally {
        socket.close();
      }
    });
    socket.once("error", reject);
    socket.once("close", (code, reason) => {
      if (code !== 1000 && code !== 1005) reject(new Error(`Gateway closed ${code}: ${String(reason)}`));
    });
  });

  const payload = JSON.parse(await decodeBrowserNodeResponse({
    response: envelope,
    request: encrypted.envelope,
    privateKey: encrypted.privateKey,
    nodeTransportPublicKey: candidate.identity.x25519PublicKey,
  })) as { ok?: boolean; result?: { playbackUrl?: string; playerAlias?: string; streamType?: string }; error?: string };
  if (!payload.ok || !payload.result?.playbackUrl) throw new Error(payload.error ?? "Node returned no playback URL.");
  const playback = new URL(payload.result.playbackUrl, dashboardUrl);
  console.log(JSON.stringify({
    nodeId: candidate.nodeId,
    endpointPresent: Boolean(candidate.endpointUrl),
    playerAlias: payload.result.playerAlias,
    streamType: payload.result.streamType,
    playbackOrigin: playback.origin,
    usesNodeEndpoint: Boolean(candidate.endpointUrl && playback.origin === new URL(candidate.endpointUrl).origin),
  }));
}

await main();
