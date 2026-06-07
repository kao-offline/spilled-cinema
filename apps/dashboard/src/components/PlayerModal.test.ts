import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

describe("remote player iframe policy", () => {
  it("does not use iframe sandbox because providers detect it", () => {
    const source = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "PlayerModal.tsx"), "utf8");
    expect(source).toContain("allow=\"autoplay; fullscreen; encrypted-media; picture-in-picture\"");
    expect(source).not.toContain("sandbox=");
  });
});
