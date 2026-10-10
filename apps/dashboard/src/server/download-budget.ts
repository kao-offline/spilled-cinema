import { readdir, stat, statfs } from "node:fs/promises";
import { resolve } from "node:path";

export type DownloadBudget = { concurrency: number; reserveBytes: number; vaultBytes: number; fileBytes: number };
export function readDownloadBudget(env = process.env): DownloadBudget {
  const limit = (key: string) => {
    const value = env[key];
    if (!value) return 0;
    const parsed = Number(value);
    if (!Number.isSafeInteger(parsed) || parsed < 0) throw new Error(`Invalid download limit: ${key}`);
    return parsed;
  };
  return { concurrency: limit("SPILLED_DOWNLOAD_MAX_CONCURRENCY"), reserveBytes: limit("SPILLED_DOWNLOAD_DISK_RESERVE_BYTES"), vaultBytes: limit("SPILLED_DOWNLOAD_MAX_VAULT_BYTES"), fileBytes: limit("SPILLED_DOWNLOAD_MAX_FILE_BYTES") };
}
export function checkDownloadBudget(budget: DownloadBudget, sample: { active: number; freeBytes: number; vaultBytes: number; fileBytes: number }) {
  if (budget.concurrency && sample.active >= budget.concurrency) throw new Error("Another download is active; wait for it to finish.");
  if (budget.reserveBytes && sample.freeBytes <= budget.reserveBytes) throw new Error("Download stopped to preserve free disk space.");
  if (budget.vaultBytes && sample.vaultBytes >= budget.vaultBytes) throw new Error("Download library storage limit reached.");
  if (budget.fileBytes && sample.fileBytes >= budget.fileBytes) throw new Error("Download file size limit reached.");
}
export async function vaultSize(folder: string) {
  let bytes = 0;
  for (const entry of await readdir(folder, { withFileTypes: true })) {
    if (entry.isFile()) bytes += (await stat(resolve(folder, entry.name))).size;
  }
  return bytes;
}
export async function freeDiskBytes(folder: string) {
  const disk = await statfs(folder);
  return disk.bavail * disk.bsize;
}
