import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

describe("universal playback modal policy", () => {
  it("never falls back to a provider iframe or raw provider stream", () => {
    const source = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "PlayerModal.tsx"), "utf8");
    expect(source).not.toContain("<iframe");
    expect(source).not.toContain("activeProviderFrameUrl");
    expect(source).not.toContain("providerInteractionUnlocked");
    expect(source).not.toContain("Open provider page");
    expect(source).not.toContain("canRetryRawPlaybackUrl");
    expect(source).not.toContain('playback?.streamType === "embed"');
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

  it("pins the player to the mobile viewport and respects the safe-area inset", () => {
    const source = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "PlayerModal.tsx"), "utf8");
    expect(source).toContain("max-lg:fixed max-lg:inset-0");
    expect(source).toContain("env(safe-area-inset-top)");
  });
});
