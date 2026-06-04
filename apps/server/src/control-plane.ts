import type { SpilledCinemaNodeRuntime } from "../../node/src/runtime";

export type ControlPlaneReporterOptions = {
  baseUrl: string;
  intervalMs?: number;
  fetchTimeoutMs?: number;
};

type ControlPlaneAck = {
  ok?: boolean;
  kind?: string;
  nodeId?: string;
  expiresAt?: number;
};

export class ControlPlaneReporter {
  private timer: NodeJS.Timeout | null = null;
  private loggedHeartbeatAck = false;

  constructor(
    private readonly runtime: SpilledCinemaNodeRuntime,
    private readonly options: ControlPlaneReporterOptions,
  ) {}

  private async postJson(path: string, payload: unknown) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.options.fetchTimeoutMs ?? 8_000);
    try {
      const baseUrl = this.options.baseUrl.endsWith("/") ? this.options.baseUrl : `${this.options.baseUrl}/`;
      const normalizedPath = path.startsWith("/") ? path.slice(1) : path;
      const base = new URL(baseUrl);
      const basePath = base.pathname.replace(/\/$/, "");
      const target = basePath.endsWith("/api/server") ? base : new URL(normalizedPath, baseUrl);
      if (basePath.endsWith("/api/server")) {
        target.pathname = target.pathname.replace(/\/$/, "");
        target.searchParams.set("path", normalizedPath);
      }
      const response = await fetch(target.toString(), {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });
      if (!response.ok) {
        throw new Error(`Control plane POST failed ${response.status} ${path}`);
      }
      return await response.json();
    } finally {
      clearTimeout(timeout);
    }
  }

  private async createPayload() {
    return {
      record: await this.runtime.getNodeRecord(),
      spillshareSources: await this.runtime.listPublishedSpillshareSources(),
    };
  }

  async register() {
    return await this.postJson("node/register", await this.createPayload());
  }

  async heartbeat() {
    return await this.postJson("node/heartbeat", await this.createPayload());
  }

  private logAck(action: "register" | "heartbeat", response: unknown) {
    const ack = response && typeof response === "object" ? response as ControlPlaneAck : {};
    if (!ack.ok || !ack.nodeId) {
      console.log(`[control-plane] ${action} acknowledged by ${this.options.baseUrl}`);
      return;
    }

    const expires = typeof ack.expiresAt === "number" ? `, expires ${new Date(ack.expiresAt).toISOString()}` : "";
    console.log(`[control-plane] ${action} acknowledged by ${this.options.baseUrl}: ${ack.nodeId}${expires}`);
  }

  start() {
    if (this.timer) {
      return;
    }

    void this.register().then((response) => {
      this.logAck("register", response);
    }).catch((error) => {
      console.warn("[control-plane] register failed", error instanceof Error ? error.message : String(error));
    });
    this.timer = setInterval(() => {
      void this.heartbeat().then((response) => {
        if (!this.loggedHeartbeatAck) {
          this.loggedHeartbeatAck = true;
          this.logAck("heartbeat", response);
        }
      }).catch((error) => {
        console.warn("[control-plane] heartbeat failed", error instanceof Error ? error.message : String(error));
      });
    }, this.options.intervalMs ?? 30_000);
  }

  stop() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }
}

export function readControlPlaneReporterOptionsFromEnv(): ControlPlaneReporterOptions | null {
  const dashboardUrl = String(process.env.SPILLED_DASHBOARD_URL || "").trim();
  const convexSiteUrl = String(process.env.CONVEX_SITE_URL || "").trim();
  const inferredBaseUrl = convexSiteUrl
    ? `${convexSiteUrl.replace(/\/$/, "")}/server`
    : dashboardUrl
      ? `${dashboardUrl.replace(/\/$/, "")}/api/server`
      : "";
  const baseUrl = String(process.env.SPILLED_CONTROL_PLANE_URL || inferredBaseUrl).trim();
  if (!baseUrl) {
    return null;
  }

  return {
    baseUrl,
    intervalMs: Number.parseInt(process.env.SPILLED_CONTROL_PLANE_INTERVAL_MS || "30000", 10),
    fetchTimeoutMs: Number.parseInt(process.env.SPILLED_CONTROL_PLANE_FETCH_TIMEOUT_MS || "8000", 10),
  };
}
