import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { TransientDownloadScheduler } from "../../../../node/src/transient-downloads";

const cleanup: string[] = [];

afterEach(async () => {
  await Promise.all(cleanup.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe("public transient downloads", () => {
  it("rejects loopback and private-network source URLs", async () => {
    const root = await mkdtemp(join(tmpdir(), "spilled-public-jobs-"));
    cleanup.push(root);
    const scheduler = new TransientDownloadScheduler(root);
    await scheduler.initialize();
    await expect(scheduler.create(
      "http://127.0.0.1/private",
      1024,
      1_000,
    )).rejects.toThrow(/private|reserved/i);
  });

  it("does not accept requester-selected nonstandard ports", async () => {
    const root = await mkdtemp(join(tmpdir(), "spilled-public-jobs-"));
    cleanup.push(root);
    const scheduler = new TransientDownloadScheduler(root);
    await scheduler.initialize();
    await expect(scheduler.create(
      "https://example.com:8443/file",
      1024,
      1_000,
    )).rejects.toThrow(/port/i);
  });
});
