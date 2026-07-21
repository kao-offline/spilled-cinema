import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

describe("universal playback modal policy", () => {
  it("does not render provider iframes as playback", () => {
    const source = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "PlayerModal.tsx"), "utf8");
    expect(source).not.toContain("<iframe");
    expect(source).not.toContain('playback?.streamType === "embed"');
    expect(source).not.toContain("sandbox=");
  });

  it("resolves remote players automatically into the universal player", () => {
    const source = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "PlayerModal.tsx"), "utf8");
    expect(source).toContain("resolveUniversalPlayback");
    expect(source).toContain("<UniversalVideoPlayer");
    expect(source).not.toContain("Try clean player");
    expect(source).not.toContain("Return to provider player");
  });

  it("uses vault file URLs and caches resolved player URLs", () => {
    const source = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "PlayerModal.tsx"), "utf8");
    expect(source).toContain("getLibraryVaultFileObjectUrl");
    expect(source).toContain("readCachedPlayerUrl");
    expect(source).toContain("writeCachedPlayerUrl");
  });
});
