export type RelayTurnCredentials = {
  urls: string[];
  username: string;
  credential: string;
  expiresAt: number;
  iceTransportPolicy: "relay";
};

type ChunkDescriptor = {
  index: number;
  size: number;
  sha256: string;
};

function waitForIceGathering(peer: RTCPeerConnection) {
  if (peer.iceGatheringState === "complete") return Promise.resolve();
  return new Promise<void>((resolve) => {
    const listener = () => {
      if (peer.iceGatheringState !== "complete") return;
      peer.removeEventListener("icegatheringstatechange", listener);
      resolve();
    };
    peer.addEventListener("icegatheringstatechange", listener);
  });
}

async function sha256Hex(bytes: ArrayBuffer) {
  return [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))]
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("");
}

export async function receiveRelayBulkTransfer(input: {
  ticketId: string;
  contentId: string;
  manifestId: string;
  turn: RelayTurnCredentials;
  resumeFromChunk?: number;
  prepare: (offer: {
    offerSdp: string;
    remoteCandidates: Array<{ candidate: string; mid: string }>;
    turn: RelayTurnCredentials;
  }) => Promise<{
    answer: { sdp: string; type: string };
    candidates: Array<{ candidate: string; mid: string }>;
    transferToken: string;
    iceTransportPolicy: "relay";
  }>;
  writeChunk: (chunk: ChunkDescriptor, bytes: ArrayBuffer) => Promise<void>;
}) {
  if (input.turn.iceTransportPolicy !== "relay") {
    throw new Error("Direct WebRTC connectivity is forbidden.");
  }
  const peer = new RTCPeerConnection({
    iceServers: [{
      urls: input.turn.urls,
      username: input.turn.username,
      credential: input.turn.credential,
    }],
    iceTransportPolicy: "relay",
  });
  const localCandidates: Array<{ candidate: string; mid: string }> = [];
  peer.addEventListener("icecandidate", (event) => {
    if (event.candidate) {
      localCandidates.push({
        candidate: event.candidate.candidate,
        mid: event.candidate.sdpMid ?? "0",
      });
    }
  });
  const channel = peer.createDataChannel("spilled-bulk-v2", { ordered: true });
  channel.binaryType = "arraybuffer";
  const offer = await peer.createOffer();
  await peer.setLocalDescription(offer);
  await waitForIceGathering(peer);
  const prepared = await input.prepare({
    offerSdp: peer.localDescription?.sdp ?? offer.sdp ?? "",
    remoteCandidates: localCandidates,
    turn: input.turn,
  });
  if (prepared.iceTransportPolicy !== "relay") {
    peer.close();
    throw new Error("Node did not confirm relay-only transport.");
  }
  await peer.setRemoteDescription({ type: "answer", sdp: prepared.answer.sdp });
  for (const candidate of prepared.candidates) {
    await peer.addIceCandidate({ candidate: candidate.candidate, sdpMid: candidate.mid });
  }
  return await new Promise<{ completed: true; chunksWritten: number }>((resolve, reject) => {
    let pending: ChunkDescriptor | null = null;
    let chunksWritten = 0;
    const fail = (error: unknown) => {
      peer.close();
      reject(error instanceof Error ? error : new Error("Bulk transfer failed."));
    };
    channel.addEventListener("open", () => {
      channel.send(JSON.stringify({
        ticketId: input.ticketId,
        transferToken: prepared.transferToken,
        contentId: input.contentId,
        manifestId: input.manifestId,
        resumeFromChunk: input.resumeFromChunk ?? 0,
      }));
    });
    channel.addEventListener("message", (event) => {
      void (async () => {
        if (typeof event.data === "string") {
          const message = JSON.parse(event.data) as ChunkDescriptor & { type?: string; manifestId?: string };
          if (message.type === "complete") {
            if (message.manifestId !== input.manifestId || pending) throw new Error("Incomplete bulk transfer.");
            peer.close();
            resolve({ completed: true, chunksWritten });
            return;
          }
          if (message.type !== "chunk") throw new Error("Unexpected bulk control frame.");
          pending = message;
          return;
        }
        if (!pending) throw new Error("Bulk payload arrived without a chunk descriptor.");
        const bytes = event.data as ArrayBuffer;
        if (bytes.byteLength !== pending.size || await sha256Hex(bytes) !== pending.sha256) {
          throw new Error(`Bulk chunk ${pending.index} failed integrity verification.`);
        }
        await input.writeChunk(pending, bytes);
        chunksWritten += 1;
        pending = null;
      })().catch(fail);
    });
    channel.addEventListener("error", () => fail(new Error("WebRTC data channel failed.")));
    peer.addEventListener("connectionstatechange", () => {
      if (["failed", "closed"].includes(peer.connectionState)) fail(new Error("Relay-only WebRTC connection failed."));
    });
  });
}
