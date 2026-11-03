import { describe, expect, it } from "vitest";
import { episodeLanguageOptions } from "../episode-language-options";
import type { LibraryEpisode, EpisodePlayer } from "../types";
const player = (language: string, alias: string, subtitlesUrl?: string): EpisodePlayer => ({ language, alias, label: alias, provider: "test", embedUrl: "https://example.com/embed", sourcePageUrl: "https://example.com", subtitlesUrl });
const options = (...players: EpisodePlayer[]) => episodeLanguageOptions({ players } as LibraryEpisode);
describe("episode language options", () => {
  it("separates English audio from Czech subtitles and keeps German disabled", () => {
    const rows = options(player("English audio + Czech subtitles", "source"));
    expect(rows.find((r) => r.code === "cz")).toMatchObject({ sub: "source" });
    expect(rows.find((r) => r.code === "cz")?.dub).toBeUndefined();
    expect(rows.find((r) => r.code === "en")?.dub).toBe("source");
    expect(rows.find((r) => r.code === "de")?.sub).toBeUndefined();
  });
  it("never infers subtitle language from audio language or URL existence", () => {
    const rows = options(player("English audio", "source", "https://example.com/sub.vtt"));
    expect(rows.find((r) => r.code === "en")?.sub).toBeUndefined();
    expect(rows.find((r) => r.code === "unknown")?.sub).toBe("source");
  });
  it("preserves provider languages outside the reference flags", () => {
    const row = options(player("French subtitles", "french")).find((entry) => entry.code.startsWith("other:"));
    expect(row).toMatchObject({ label: "French subtitles", sub: "french" });
    expect(row?.dub).toBeUndefined();
  });
  it("preserves Slovak and German options", () => {
    const rows = options(player("CZ/SK subtitles", "subs"), player("German subtitles", "german"));
    expect(rows.find((r) => r.code === "sk")?.sub).toBe("subs");
    expect(rows.find((r) => r.code === "de")?.sub).toBe("german");
  });
});
