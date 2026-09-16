import { describe, expect, it } from "vitest";
import { buildAudioOptions, buildSubtitleOptions, buildSubtitleProxyUrl, choosePreferredSubtitleId, normalizeSubtitlePayload } from "../media-selection";
import type { EpisodePlayer } from "../types";

function player(alias: string, language: string, subtitlesUrl?: string): EpisodePlayer {
  return {
    alias,
    provider: "provider",
    label: alias,
    language,
    sourcePageUrl: "https://example.com/title",
    embedUrl: `https://player.example/${alias}`,
    subtitlesUrl,
  };
}

describe("media selection", () => {
  it("separates audio groups from subtitle availability", () => {
    const options = buildAudioOptions([
      player("subbed", "English audio + Czech subtitles", "https://subs.example/cs.srt"),
      player("dubbed", "Czech audio"),
    ]);
    expect(options.map((option) => option.key)).toEqual(["en", "cs"]);
    expect(options[0].label).toBe("English");
  });

  it("combines player and separately discovered subtitles without duplicates", () => {
    const options = buildSubtitleOptions(
      [player("one", "English audio + Czech subtitles", "https://subs.example/cs.srt")],
      [
        { integrationId: "provider", label: "Czech", language: "cs", url: "https://subs.example/cs.srt" },
        { integrationId: "provider", label: "English", language: "en", url: "https://subs.example/en.vtt" },
      ],
    );
    expect(options).toHaveLength(2);
    expect(options.map((option) => option.languageKey)).toEqual(["cs", "en"]);
  });

  it("does not present an audio language as the subtitle language", () => {
    const options = buildSubtitleOptions(
      [player("one", "English", "https://subs.example/track.vtt")],
      [{ integrationId: "provider", label: "Subtitles", url: "https://subs.example/track.vtt" }],
    );
    expect(options).toHaveLength(1);
    expect(options[0]).toMatchObject({ languageKey: "und", languageTag: "und", label: "Subtitles" });
  });

  it("routes subtitle requests through the resolved node origin", () => {
    expect(buildSubtitleProxyUrl("https://subs.example/cs.srt", "https://node.example/")).toBe(
      "https://node.example/api/subtitle-proxy?url=https%3A%2F%2Fsubs.example%2Fcs.srt",
    );
  });

  it("routes localtunnel subtitles through the hosted proxy that supplies the bypass header", () => {
    expect(buildSubtitleProxyUrl("https://subs.example/cs.srt", "https://node-abc.loca.lt", "https://app.example")).toBe(
      `/api/node-proxy?node=${encodeURIComponent("https://node-abc.loca.lt")}&path=${encodeURIComponent("/api/subtitle-proxy?url=https%3A%2F%2Fsubs.example%2Fcs.srt")}`,
    );
  });

  it("normalizes SRT and rejects HTML or incompatible payloads", () => {
    expect(normalizeSubtitlePayload("1\r\n00:00:01,000 --> 00:00:02,000\r\nHello")).toContain("00:00:01.000 --> 00:00:02.000");
    expect(() => normalizeSubtitlePayload("<!doctype html><title>Blocked</title>")).toThrow(/web page/i);
    expect(() => normalizeSubtitlePayload("not captions")).toThrow(/not compatible/i);
  });

  it("preserves a preferred language and falls back predictably", () => {
    const options = buildSubtitleOptions([
      player("cs", "Czech subtitles", "https://subs.example/cs.vtt"),
      player("en", "English subtitles", "https://subs.example/en.vtt"),
    ]);
    expect(choosePreferredSubtitleId(options, "en")).toBe(options[1].id);
    expect(choosePreferredSubtitleId(options, "off")).toBeNull();
    expect(choosePreferredSubtitleId(options, "de")).toBeNull();
  });
});
