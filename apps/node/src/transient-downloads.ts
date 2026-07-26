import { lookup } from "node:dns/promises";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, open, readdir, rm, statfs } from "node:fs/promises";
import { isIP } from "node:net";
import { join } from "node:path";
import type { PublicJobState } from "../../../packages/node-protocol/src";
import type { GovernorDecision } from "./resource-governor";

export type PublicDownloadJob = {
  jobId: string;
  state: PublicJobState;
  createdAt: number;
  updatedAt: number;
  expiresAt: number;
  bytesDownloaded: number;
  expectedBytes?: number;
  sha256?: string;
  error?: string;
};

type InternalJob = PublicDownloadJob & {
  sourceUrl: string;
  directory: string;
  outputPath: string;
  controller: AbortController;
};

const MAX_JOB_MS = 90 * 60_000;
const MAX_TEMP_BYTES = 10 * 1024 * 1024 * 1024;

export class TransientDownloadScheduler {
  private readonly jobs = new Map<string, InternalJob>();
  private readonly queue: string[] = [];
  private active = 0;
  private readonly root: string;
  private readonly concurrency: number;
  private readonly governor?: () => Promise<GovernorDecision>;

  constructor(
    root: string,
    concurrency = 2,
    governor?: () => Promise<GovernorDecision>,
  ) {
    this.root = root;
    this.concurrency = concurrency;
    this.governor = governor;
  }

  async initialize() {
    await mkdir(this.root, { recursive: true });
    for (const name of await readdir(this.root).catch(() => [])) {
      if (name.startsWith("public-job-")) {
        await rm(join(this.root, name), { recursive: true, force: true });
      }
    }
  }

  async create(sourceUrl: string, ticketMaxBytes: number, ticketMaxDurationMs: number) {
    if (await this.governor?.() === "paused") {
      throw new Error("Public bulk work is paused to protect local/private activity.");
    }
    await assertPublicDownloadUrl(sourceUrl);
    const disk = await statfs(this.root);
    const freeBytes = disk.bavail * disk.bsize;
    const maxBytes = Math.max(1, Math.min(
      ticketMaxBytes,
      MAX_TEMP_BYTES,
      Math.floor(freeBytes * 0.05),
    ));
    const now = Date.now();
    const jobId = randomUUID();
    const directory = join(this.root, `public-job-${jobId}`);
    const job: InternalJob = {
      jobId,
      state: "queued",
      createdAt: now,
      updatedAt: now,
      expiresAt: now + Math.min(MAX_JOB_MS, ticketMaxDurationMs),
      bytesDownloaded: 0,
      sourceUrl,
      directory,
      outputPath: join(directory, "output.bin"),
      controller: new AbortController(),
    };
    Object.defineProperty(job, "expectedBytes", { value: maxBytes, writable: true, enumerable: true });
    this.jobs.set(jobId, job);
    this.queue.push(jobId);
    this.pump();
    return this.publicJob(job);
  }

  get(jobId: string) {
    const job = this.jobs.get(jobId);
    return job ? this.publicJob(job) : null;
  }

  cancel(jobId: string) {
    const job = this.jobs.get(jobId);
    if (!job) return null;
    if (["completed", "canceled", "failed", "expired"].includes(job.state)) return this.publicJob(job);
    this.transition(job, "canceling");
    job.controller.abort();
    if (job.state === "canceling" && this.queue.includes(jobId)) {
      this.queue.splice(this.queue.indexOf(jobId), 1);
      this.transition(job, "canceled");
      void this.cleanup(job);
    }
    return this.publicJob(job);
  }

  getOutputPath(jobId: string) {
    const job = this.jobs.get(jobId);
    return job?.state === "ready" || job?.state === "streaming" ? job.outputPath : null;
  }

  markStreaming(jobId: string) {
    const job = this.jobs.get(jobId);
    if (!job || job.state !== "ready") return null;
    this.transition(job, "streaming");
    return this.publicJob(job);
  }

  complete(jobId: string) {
    const job = this.jobs.get(jobId);
    if (!job || !["ready", "streaming"].includes(job.state)) return null;
    this.transition(job, "completed");
    setTimeout(() => void this.cleanup(job), 30_000).unref?.();
    return this.publicJob(job);
  }

  private pump() {
    while (this.active < this.concurrency && this.queue.length) {
      const jobId = this.queue.shift()!;
      const job = this.jobs.get(jobId);
      if (!job || job.state !== "queued") continue;
      this.active += 1;
      void this.run(job).finally(() => {
        this.active -= 1;
        this.pump();
      });
    }
  }

  private async run(job: InternalJob) {
    const timeout = setTimeout(() => job.controller.abort(), Math.max(1, job.expiresAt - Date.now()));
    try {
      this.transition(job, "resolving");
      const response = await fetchFollowingSafeRedirects(job.sourceUrl, job.controller.signal);
      if (!response.ok || !response.body) {
        throw new Error(`Source returned HTTP ${response.status}.`);
      }
      const expected = Number(response.headers.get("content-length"));
      const maxBytes = job.expectedBytes ?? MAX_TEMP_BYTES;
      if (Number.isFinite(expected) && expected > maxBytes) {
        throw new Error("Source exceeds temporary download quota.");
      }
      if (Number.isFinite(expected) && expected >= 0) job.expectedBytes = expected;
      await mkdir(job.directory, { recursive: true });
      const output = await open(job.outputPath, "wx", 0o600);
      const digest = createHash("sha256");
      this.transition(job, "downloading");
      try {
        const reader = response.body.getReader();
        while (true) {
          const governorDecision = await this.governor?.();
          while (governorDecision === "paused" && !job.controller.signal.aborted) {
            await new Promise((resolve) => setTimeout(resolve, 1_000));
            if (await this.governor?.() !== "paused") break;
          }
          const { done, value } = await reader.read();
          if (done) break;
          if (job.bytesDownloaded + value.byteLength > maxBytes) {
            throw new Error("Temporary download quota exceeded.");
          }
          await output.write(value);
          digest.update(value);
          job.bytesDownloaded += value.byteLength;
          job.updatedAt = Date.now();
          if (governorDecision === "throttled") {
            await new Promise((resolve) => setTimeout(resolve, 100));
          }
        }
        await output.sync();
      } finally {
        await output.close();
      }
      job.sha256 = digest.digest("hex");
      this.transition(job, "ready");
    } catch (error) {
      if (job.controller.signal.aborted) {
        this.transition(job, Date.now() >= job.expiresAt ? "expired" : "canceled");
      } else {
        job.error = error instanceof Error ? error.message : "Transient download failed.";
        this.transition(job, "failed");
      }
      await this.cleanup(job, false);
    } finally {
      clearTimeout(timeout);
    }
  }

  private transition(job: InternalJob, state: PublicJobState) {
    job.state = state;
    job.updatedAt = Date.now();
  }

  private async cleanup(job: InternalJob, removeRecord = true) {
    await rm(job.directory, { recursive: true, force: true });
    if (removeRecord) this.jobs.delete(job.jobId);
  }

  private publicJob(job: InternalJob): PublicDownloadJob {
    const { sourceUrl: _sourceUrl, directory: _directory, outputPath: _outputPath, controller: _controller, ...safe } = job;
    return { ...safe };
  }
}

async function fetchFollowingSafeRedirects(initialUrl: string, signal: AbortSignal) {
  let current = initialUrl;
  for (let redirects = 0; redirects <= 5; redirects += 1) {
    await assertPublicDownloadUrl(current);
    const response = await fetch(current, {
      redirect: "manual",
      signal,
      headers: { "User-Agent": "Spilled-Node/2" },
    });
    if (![301, 302, 303, 307, 308].includes(response.status)) return response;
    const location = response.headers.get("location");
    if (!location) throw new Error("Redirect response has no location.");
    current = new URL(location, current).toString();
  }
  throw new Error("Source exceeded the redirect limit.");
}

async function assertPublicDownloadUrl(value: string) {
  const url = new URL(value);
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) {
    throw new Error("Only unauthenticated HTTP(S) source URLs are supported.");
  }
  if (url.port && !["80", "443"].includes(url.port)) {
    throw new Error("Source URL uses a disallowed port.");
  }
  const addresses = isIP(url.hostname)
    ? [{ address: url.hostname }]
    : await lookup(url.hostname, { all: true, verbatim: true });
  if (!addresses.length || addresses.some(({ address }) => isPrivateAddress(address))) {
    throw new Error("Source URL resolves to a private or reserved address.");
  }
}

function isPrivateAddress(address: string) {
  const normalized = address.toLowerCase();
  if (normalized === "::1" || normalized === "::" || normalized.startsWith("fe80:") || normalized.startsWith("fc") || normalized.startsWith("fd")) {
    return true;
  }
  const mapped = normalized.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/)?.[1];
  const candidate = mapped ?? normalized;
  const octets = candidate.split(".").map(Number);
  if (octets.length !== 4 || octets.some((part) => !Number.isInteger(part))) return false;
  const [a, b] = octets;
  return (
    a === 0 || a === 10 || a === 127 || a >= 224 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 198 && (b === 18 || b === 19))
  );
}
