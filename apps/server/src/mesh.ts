import type { NodeRecord, SpillshareSource } from "../../../packages/node-protocol/src";
import type { SpilledCinemaNodeRuntime } from "./runtime";

export type RelayMeshOptions = {
  peers: string[];
  intervalMs?: number;
  fetchTimeoutMs?: number;
};

export class SecureRelayMesh {
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private readonly runtime: SpilledCinemaNodeRuntime,
    private readonly options: RelayMeshOptions,
  ) {}

  private async postJson(url: string, payload: unknown) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.options.fetchTimeoutMs ?? 8_000);
    try {
      const response = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });
      if (!response.ok) {
        throw new Error(`Mesh POST failed ${response.status} ${url}`);
      }
      return response;
    } finally {
      clearTimeout(timeout);
    }
  }

  private async getJson<T>(url: string) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.options.fetchTimeoutMs ?? 8_000);
    try {
      const response = await fetch(url, {
        method: "GET",
        signal: controller.signal,
      });
      if (!response.ok) {
        throw new Error(`Mesh GET failed ${response.status} ${url}`);
      }
      return (await response.json()) as T;
    } finally {
      clearTimeout(timeout);
    }
  }

  async createAnnouncePayload() {
    return {
      record: await this.runtime.getNodeRecord(),
      spillshareSources: await this.runtime.listPublishedSpillshareSources(),
    };
  }

  async announceToPeer(peer: string) {
    const target = new URL("/api/node/mesh/announce", peer).toString();
    await this.postJson(target, await this.createAnnouncePayload());
  }

  async syncFromPeer(peer: string) {
    const target = new URL("/api/node/mesh/snapshot", peer).toString();
    const snapshot = await this.getJson<{
      self?: NodeRecord;
      records?: NodeRecord[];
      spillshareSources?: SpillshareSource[];
    }>(target);

    if (snapshot.self) {
      await this.runtime.acceptRemoteNodeRecord(snapshot.self);
    }

    for (const record of snapshot.records ?? []) {
      await this.runtime.acceptRemoteNodeRecord(record);
    }

    for (const source of snapshot.spillshareSources ?? []) {
      await this.runtime.acceptRemoteSpillshareSource(source);
    }
  }

  async syncOnce() {
    for (const peer of this.options.peers) {
      try {
        await this.announceToPeer(peer);
      } catch (error) {
        console.warn("[relay-mesh] announce failed", peer, error instanceof Error ? error.message : String(error));
      }
    }

    for (const peer of this.options.peers) {
      try {
        await this.syncFromPeer(peer);
      } catch (error) {
        console.warn("[relay-mesh] sync failed", peer, error instanceof Error ? error.message : String(error));
      }
    }
  }

  start() {
    if (this.timer || this.options.peers.length === 0) {
      return;
    }

    void this.syncOnce();
    this.timer = setInterval(() => {
      void this.syncOnce();
    }, this.options.intervalMs ?? 30_000);
  }

  stop() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }
}

export function readRelayMeshOptionsFromEnv(): RelayMeshOptions {
  return {
    peers: String(process.env.SPILLED_MESH_PEERS || "")
      .split(",")
      .map((entry) => entry.trim())
      .filter(Boolean),
    intervalMs: Number.parseInt(process.env.SPILLED_MESH_INTERVAL_MS || "30000", 10),
    fetchTimeoutMs: Number.parseInt(process.env.SPILLED_MESH_FETCH_TIMEOUT_MS || "8000", 10),
  };
}
