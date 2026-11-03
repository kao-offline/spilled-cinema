import type { LibraryEpisode } from "./types";
import { getCanonicalLanguageKey, getCanonicalLanguageLabel } from "./language";

export type EpisodeLanguageRow = { code: string; label: string; flag?: string; sub?: string; dub?: string };
const languages = [
  { code: "cz", label: "Czech", flag: "cz" },
  { code: "en", label: "English", flag: "gb" },
  { code: "de", label: "German", flag: "de" },
  { code: "sk", label: "Slovak" },
];

export function episodeLanguageOptions(episode: LibraryEpisode): EpisodeLanguageRow[] {
  const rows: EpisodeLanguageRow[] = languages.slice(0, 3).map((language) => ({ ...language }));
  const row = (code: string) => {
    let found = rows.find((entry) => entry.code === code);
    if (!found) { found = { ...(languages.find((entry) => entry.code === code) ?? { code, label: code === "unknown" ? "Unspecified language" : code }) }; rows.push(found); }
    return found;
  };
  const codes = (value: string) => {
    const result = languages.filter((language) => new RegExp(`\\b${language.code === "cz" ? "(?:cz|cs)" : language.code}\\b`).test(value)).map((language) => language.code);
    if (/\b(?:german|deutsch)\b/.test(value)) result.push("de");
    return result;
  };
  for (const player of episode.players) {
    const key = getCanonicalLanguageKey(player.language);
    const [audioPart, subtitlePart] = key.includes("-audio-") ? key.split("-audio-") : /\b(?:sub|subs|subtitles|titulky)\b/.test(key) ? ["", key] : [key, ""];
    const audioCodes = codes(audioPart);
    const subCodes = codes(subtitlePart.replace("czsk", "cz sk"));
    for (const code of audioCodes) {
      if (!row(code).dub || player.alias === episode.selectedPlayerAlias) row(code).dub = player.alias;
    }
    for (const code of subCodes) {
      if (!row(code).sub || player.alias === episode.selectedPlayerAlias) row(code).sub = player.alias;
    }
    // A URL proves subtitles exist, but cannot prove their language.
    if (player.subtitlesUrl && !subCodes.length) row("unknown").sub ??= player.alias;
    if (!audioCodes.length && !subCodes.length) {
      const other = row(key === "available-streams" ? "unknown" : `other:${key}`);
      other.label = getCanonicalLanguageLabel(player.language);
      if (/\b(?:sub|subs|subtitles|titulky)\b/.test(key)) other.sub ??= player.alias;
      else other.dub ??= player.alias;
    }
  }
  return rows;
}
