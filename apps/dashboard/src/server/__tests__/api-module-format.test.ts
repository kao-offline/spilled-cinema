import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const apiFiles = [
  "../../../api/download-full/browser-file.js",
  "../../../api/download-full/browser-start.js",
];

describe("Vercel API module format", () => {
  it.each(apiFiles)("keeps %s compatible with the dashboard ESM package", async (relativePath) => {
    const source = await readFile(fileURLToPath(new URL(relativePath, import.meta.url)), "utf8");
    expect(source).not.toMatch(/\brequire\s*\(/);
    expect(source).not.toContain("module.exports");
    expect(source).toMatch(/export default async function handler/);
  });
});
