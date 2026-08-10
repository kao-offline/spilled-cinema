import { readdir, rm, stat } from "node:fs/promises";
import { dirname, join } from "node:path";
import { SqliteNodeStorage } from "../../../packages/storage/src";

const DAY_MS = 24 * 60 * 60 * 1_000;

export class NodeBackupManager {
  private timer: NodeJS.Timeout | null = null;
  private readonly storage: SqliteNodeStorage;
  private readonly databasePath: string;

  constructor(
    storage: SqliteNodeStorage,
    databasePath: string,
  ) {
    this.storage = storage;
    this.databasePath = databasePath;
  }

  start() {
    if (this.timer) return;
    void this.runIfDue();
    this.timer = setInterval(() => void this.runIfDue(), 60 * 60_000);
    this.timer.unref?.();
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  async runIfDue(now = new Date()) {
    const directory = join(dirname(this.databasePath), "backups");
    const dailyName = `node-daily-${now.toISOString().slice(0, 10)}.db`;
    const dailyPath = join(directory, dailyName);
    const existing = await stat(dailyPath).catch(() => null);
    if (!existing) {
      await this.storage.createVerifiedBackup(dailyPath);
    }
    if (now.getUTCDay() === 0) {
      const week = getIsoWeek(now);
      const weeklyPath = join(directory, `node-weekly-${now.getUTCFullYear()}-${String(week).padStart(2, "0")}.db`);
      if (!await stat(weeklyPath).catch(() => null)) {
        await this.storage.createVerifiedBackup(weeklyPath);
      }
    }
    await pruneBackups(directory, "node-daily-", 7);
    await pruneBackups(directory, "node-weekly-", 4);
  }
}

function getIsoWeek(date: Date) {
  const target = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  target.setUTCDate(target.getUTCDate() + 4 - (target.getUTCDay() || 7));
  const yearStart = new Date(Date.UTC(target.getUTCFullYear(), 0, 1));
  return Math.ceil((((target.getTime() - yearStart.getTime()) / DAY_MS) + 1) / 7);
}

async function pruneBackups(directory: string, prefix: string, keep: number) {
  const files = (await readdir(directory).catch(() => []))
    .filter((name) => name.startsWith(prefix) && name.endsWith(".db"))
    .sort()
    .reverse();
  for (const file of files.slice(keep)) {
    await rm(join(directory, file), { force: true });
  }
}
