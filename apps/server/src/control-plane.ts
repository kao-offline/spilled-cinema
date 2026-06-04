import type { SpilledCinemaNodeRuntime } from "../../node/src/runtime";

export type ControlPlaneReporterOptions = {
  baseUrl: string;
  intervalMs?: number;
  fetchTimeoutMs?: number;
};

export class ControlPlaneReporter {
  private timer: NodeJS.Timeout | null = null;

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
      const response = await fetch(new URL(normalizedPath, baseUrl).toString(), {
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

  start() {
    if (this.timer) {
      return;
    }

    void this.register().catch((error) => {
      console.warn("[control-plane] register failed", error instanceof Error ? error.message : String(error));
    });
    this.timer = setInterval(() => {
      void this.heartbeat().catch((error) => {
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
