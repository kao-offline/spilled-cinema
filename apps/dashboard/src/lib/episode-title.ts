import type { LibraryEpisode } from "./types";

const LANGUAGE_JUNK_RE = /\s*[-–—]\s*(?:cz(?:ech)?|sk(?: Slovak)?|sloven(?:čina|cina)?|tit(?:ulky)?|dab(?:ing)?|dub(?:bed)?|audio|sub(?:titles?)?|english|en(?:glish)?|(?:audio|sub(?:titles?)?)\s+(?:cz|sk|en|de|fr|es|it|pt|pl|hu|ro|bg|hr|sl|sr|uk|ru|tr|ar|zh|ja|ko|hi|th|vi|id|ms|fa|he|sv|no|da|fi|nl|cs)\b|(?:cz|sk|en|de|fr|es|it|pt|pl|hu|ro|bg|hr|sl|sr|uk|ru|tr|ar|zh|ja|ko|hi|th|vi|id|ms|fa|he|sv|no|da|fi|nl|cs)\s+(?:audio|sub(?:titles?)?)\b)\s*$/i;

export function formatEpisodeTitleParts(input: {
  showTitle?: string | null;
  episodeTitle?: string | null;
  episodeCode?: string | null;
  episodeNumber?: number | null;
}) {
  let title = (input.episodeTitle ?? `Episode ${input.episodeNumber ?? "Unknown"}`).trim();

  if (input.showTitle && title.startsWith(`${input.showTitle} - `)) {
    title = title.slice(input.showTitle.length + 3).trim();
  }

  if (input.episodeCode && title.startsWith(`${input.episodeCode.toUpperCase()} - `)) {
    title = title.slice(input.episodeCode.length + 3).trim();
  } else if (input.episodeCode && title === input.episodeCode.toUpperCase()) {
    title = `Episode ${input.episodeNumber ?? "Unknown"}`;
  }

  if (typeof input.episodeNumber === "number") {
    title = title.replace(new RegExp(`^${input.episodeNumber}\\s+`), "").trim();
  }

  title = title
    .replace(LANGUAGE_JUNK_RE, "")
    .replace(/\s{2,}/g, " ")
    .trim();

  return title || `Episode ${input.episodeNumber ?? "Unknown"}`;
}

export function formatEpisodeTitle(episode: Pick<LibraryEpisode, "showTitle" | "episodeTitle" | "episodeCode" | "episodeNumber">) {
  return formatEpisodeTitleParts(episode);
}
