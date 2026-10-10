import { describe, expect, it } from "vitest";
import { checkDownloadBudget, readDownloadBudget } from "../download-budget";

describe("download budgets", () => {
  const budget = { concurrency: 1, reserveBytes: 100, vaultBytes: 1000, fileBytes: 500 };
  const sample = { active: 0, freeBytes: 101, vaultBytes: 999, fileBytes: 499 };
  it("admits a stream download below every limit", () => expect(() => checkDownloadBudget(budget, sample)).not.toThrow());
  it.each([{ active: 1 }, { freeBytes: 100 }, { vaultBytes: 1000 }, { fileBytes: 500 }])("rejects a reached limit: %j", (change) => expect(() => checkDownloadBudget(budget, { ...sample, ...change })).toThrow());
  it("keeps limits optional for existing deployments", () => expect(() => checkDownloadBudget(readDownloadBudget({}), { active: 100, freeBytes: 0, vaultBytes: 1e12, fileBytes: 1e12 })).not.toThrow());
  it("rejects invalid configured limits", () => expect(() => readDownloadBudget({ SPILLED_DOWNLOAD_MAX_FILE_BYTES: "NaN" })).toThrow("Invalid download limit"));
});
