export type ResourceSample = {
  cpuPercent: number;
  eventLoopP95Ms: number;
  localPlaybackActive: boolean;
  privateWorkActive: boolean;
  networkLatencyIncreaseMs: number;
  freeDiskBytes: number;
  diskReserveBytes: number;
  onBattery: boolean;
  meteredNetwork: boolean;
};

export type PublicWorkClass = "lightweight" | "bulk";
export type GovernorDecision = "active" | "throttled" | "paused";

export function decidePublicWork(sample: ResourceSample, workClass: PublicWorkClass): GovernorDecision {
  if (
    sample.freeDiskBytes <= sample.diskReserveBytes ||
    sample.meteredNetwork ||
    (workClass === "bulk" && sample.onBattery)
  ) {
    return "paused";
  }
  if (
    sample.localPlaybackActive ||
    sample.privateWorkActive ||
    sample.cpuPercent > 70 ||
    sample.eventLoopP95Ms > 100 ||
    sample.networkLatencyIncreaseMs > 30
  ) {
    return "throttled";
  }
  return "active";
}

export const DEFAULT_PUBLIC_RESOURCE_LIMITS = {
  uploadBudgetPercent: 20,
  cpuTargetPercent: 35,
  lightweightConcurrency: 4,
  bulkConcurrency: 2,
  maxTemporaryBytes: 10 * 1024 * 1024 * 1024,
  sampleIntervalMs: 5_000,
} as const;

export class AdaptiveResourceGovernor {
  private readonly eventLoop = monitorEventLoopDelay({ resolution: 20 });
  private previousCpu = process.cpuUsage();
  private previousSampleAt = process.hrtime.bigint();
  private cpuPercent = 0;
  private localPlaybackActive = false;
  private privateWorkActive = false;
  private onBattery = false;
  private meteredNetwork = false;
  private readonly diskPath: string;
  private readonly diskReserveBytes: number;

  constructor(
    diskPath: string,
    diskReserveBytes = 2 * 1024 * 1024 * 1024,
  ) {
    this.diskPath = diskPath;
    this.diskReserveBytes = diskReserveBytes;
  }

  start() {
    this.eventLoop.enable();
  }

  stop() {
    this.eventLoop.disable();
  }

  setLocalActivity(input: { playback?: boolean; privateWork?: boolean }) {
    if (input.playback !== undefined) this.localPlaybackActive = input.playback;
    if (input.privateWork !== undefined) this.privateWorkActive = input.privateWork;
  }

  setDeviceState(input: { onBattery?: boolean; meteredNetwork?: boolean }) {
    if (input.onBattery !== undefined) this.onBattery = input.onBattery;
    if (input.meteredNetwork !== undefined) this.meteredNetwork = input.meteredNetwork;
  }

  async decision(workClass: PublicWorkClass) {
    const now = process.hrtime.bigint();
    const elapsedMicros = Math.max(1, Number(now - this.previousSampleAt) / 1_000);
    const currentCpu = process.cpuUsage();
    const usedMicros =
      currentCpu.user - this.previousCpu.user +
      currentCpu.system - this.previousCpu.system;
    this.cpuPercent = Math.min(100, (usedMicros / elapsedMicros / Math.max(1, cpus().length)) * 100);
    this.previousCpu = currentCpu;
    this.previousSampleAt = now;
    const disk = await statfs(this.diskPath);
    const freeDiskBytes = disk.bavail * disk.bsize;
    const decision = decidePublicWork({
      cpuPercent: this.cpuPercent,
      eventLoopP95Ms: this.eventLoop.percentile(95) / 1_000_000,
      localPlaybackActive: this.localPlaybackActive,
      privateWorkActive: this.privateWorkActive,
      networkLatencyIncreaseMs: 0,
      freeDiskBytes,
      diskReserveBytes: this.diskReserveBytes,
      onBattery: this.onBattery,
      meteredNetwork: this.meteredNetwork,
    }, workClass);
    this.eventLoop.reset();
    return decision;
  }
}
import { monitorEventLoopDelay } from "node:perf_hooks";
import { cpus } from "node:os";
import { statfs } from "node:fs/promises";
