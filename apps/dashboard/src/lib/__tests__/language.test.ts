import { describe, expect, it } from "vitest";
import { getLanguagePresentation } from "../language";

describe("language presentation", () => {
  it("uses the audio language as the primary flag for subtitle labels", () => {
    expect(getLanguagePresentation("English audio + CZ/SK subtitles")).toMatchObject({
      label: "English audio + CZ/SK subtitles",
      flags: ["🇬🇧"],
      labelWithFlags: "🇬🇧 English audio + CZ/SK subtitles",
    });
  });
});
