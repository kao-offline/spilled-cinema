import { open } from "node:fs/promises";
import { stat } from "node:fs/promises";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import {
  PeerConnection,
  type DataChannel,
  type IceServer,
} from "node-datachannel";

type TurnCredentials = {
  urls: string[];
  username: string;
  credential: string;
  iceTransportPolicy: "relay";
  expiresAt: number;
};

type TransferSource = {
  path: string;
  contentId: string;
  manifestId: string;
  chunks: Array<{ index: number; offset: number; size: number; sha256: string }>;
  onComplete?: () => void;
};

export async function createFileTransferSource(path: string, contentId: string): Promise<TransferSource> {
  const metadata = await stat(path);
  if (!metadata.isFile()) throw new Error("Bulk source is not a regular file.");
  const file = await open(path, "r");
  const chunks: TransferSource["chunks"] = [];
  try {
    for (let offset = 0, index = 0; offset < metadata.size; index += 1) {
      const size = Math.min(4 * 1024 * 1024, metadata.size - offset);
      const bytes = Buffer.allocUnsafe(size);
      const { bytesRead } = await file.read(bytes, 0, size, offset);
      if (bytesRead !== size) throw new Error("Bulk source changed while hashing.");
      chunks.push({
        index,
        offset,
        size,
        sha256: createHash("sha256").update(bytes).digest("hex"),
      });
      offset += size;
    }
  } finally {
    await file.close();
  }
  return { path, contentId, manifestId: randomUUID(), chunks };
}

function parseTurnServer(urlText: string, credentials: TurnCredentials): IceServer {
  const normalized = urlText.replace(/^turns?:/, (prefix) => `${prefix}//`);
  const url = new URL(normalized);
  if (!["turn:", "turns:"].includes(url.protocol.replace("//", ""))) {
    throw new Error("Bulk transport accepts TURN servers only.");
  }
  const secure = urlText.startsWith("turns:");
  return {
    hostname: url.hostname,
    port: Number(url.port || (secure ? 5349 : 3478)),
    username: credentials.username,
    password: credentials.credential,
    relayType: secure ? "TurnTls" : url.searchParams.get("transport") === "tcp" ? "TurnTcp" : "TurnUdp",
  };
}

function waitForBufferedChannel(channel: DataChannel) {
  if (channel.bufferedAmount() < 4 * 1024 * 1024) return Promise.resolve();
  channel.setBufferedAmountLowThreshold(1024 * 1024);
  return new Promise<void>((resolve) => channel.onBufferedAmountLow(resolve));
}

export class RelayOnlyBulkTransferManager {
  private readonly sessions = new Map<string, { peer: PeerConnection; expiresAt: number }>();
  private readonly governor?: () => Promise<"active" | "throttled" | "paused">;

  constructor(governor?: () => Promise<"active" | "throttled" | "paused">) {
    this.governor = governor;
  }

  async prepare(input: {
    ticketId: string;
    offerSdp: string;
    remoteCandidates?: Array<{ candidate: string; mid: string }>;
    turn: TurnCredentials;
    source: TransferSource;
  }) {
    if (
      input.turn.iceTransportPolicy !== "relay" ||
      input.turn.expiresAt <= Date.now() ||
      !input.turn.urls.length
    ) {
      throw new Error("Valid relay-only TURN credentials are required.");
    }
    const transferToken = randomBytes(32).toString("base64url");
    const peer = new PeerConnection(`spilled-${input.ticketId}`, {
      iceServers: input.turn.urls.map((url) => parseTurnServer(url, input.turn)),
      iceTransportPolicy: "relay",
      maxMessageSize: 1024 * 1024,
    });
    const candidates: Array<{ candidate: string; mid: string }> = [];
    let answer: { sdp: string; type: string } | null = null;
    peer.onLocalCandidate((candidate, mid) => candidates.push({ candidate, mid }));
    peer.onLocalDescription((sdp, type) => {
      answer = { sdp, type };
    });
    peer.onDataChannel((channel) => {
      let authenticated = false;
      channel.onMessage((message) => {
        if (authenticated || typeof message !== "string") return;
        try {
          const hello = JSON.parse(message) as {
            ticketId?: string;
            transferToken?: string;
            contentId?: string;
            manifestId?: string;
            resumeFromChunk?: number;
          };
          if (
            hello.ticketId !== input.ticketId ||
            hello.transferToken !== transferToken ||
            hello.contentId !== input.source.contentId ||
            hello.manifestId !== input.source.manifestId
          ) {
            throw new Error("Bulk-channel ticket binding failed.");
          }
          authenticated = true;
          void this.sendSource(peer, channel, input.source, Math.max(0, hello.resumeFromChunk ?? 0));
        } catch {
          channel.close();
          peer.close();
        }
      });
    });
    peer.setRemoteDescription(input.offerSdp, "offer");
    for (const candidate of input.remoteCandidates ?? []) {
      peer.addRemoteCandidate(candidate.candidate, candidate.mid);
    }
    peer.setLocalDescription("answer");
    const deadline = Date.now() + 5_000;
    while ((!answer || peer.gatheringState() !== "complete") && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    if (!answer) {
      peer.close();
      throw new Error("WebRTC answer generation failed.");
    }
    const expiresAt = Math.min(input.turn.expiresAt, Date.now() + 5 * 60_000);
    this.sessions.set(transferToken, { peer, expiresAt });
    const cleanup = setTimeout(() => {
      peer.close();
      this.sessions.delete(transferToken);
    }, Math.max(1, expiresAt - Date.now()));
    cleanup.unref?.();
    return {
      answer,
      candidates,
      transferToken,
      expiresAt,
      iceTransportPolicy: "relay" as const,
    };
  }

  close() {
    for (const { peer } of this.sessions.values()) peer.close();
    this.sessions.clear();
  }

  private async sendSource(peer: PeerConnection, channel: DataChannel, source: TransferSource, resumeFromChunk: number) {
    const pair = peer.getSelectedCandidatePair();
    if (!pair || pair.local.type !== "relay" || pair.remote.type !== "relay") {
      channel.close();
      throw new Error("WebRTC selected a non-relay candidate pair.");
    }
    const file = await open(source.path, "r");
    try {
      for (const chunk of source.chunks.filter((entry) => entry.index >= resumeFromChunk)) {
        let decision = await this.governor?.();
        while (decision === "paused") {
          await new Promise((resolve) => setTimeout(resolve, 1_000));
          decision = await this.governor?.();
        }
        const bytes = Buffer.allocUnsafe(chunk.size);
        const result = await file.read(bytes, 0, chunk.size, chunk.offset);
        if (result.bytesRead !== chunk.size) throw new Error("Bulk source changed during transfer.");
        await waitForBufferedChannel(channel);
        channel.sendMessage(JSON.stringify({
          type: "chunk",
          index: chunk.index,
          size: chunk.size,
          sha256: chunk.sha256,
        }));
        channel.sendMessageBinary(bytes);
        if (decision === "throttled") {
          await new Promise((resolve) => setTimeout(resolve, 100));
        }
      }
      channel.sendMessage(JSON.stringify({ type: "complete", manifestId: source.manifestId }));
      source.onComplete?.();
    } finally {
      await file.close();
    }
  }
}
