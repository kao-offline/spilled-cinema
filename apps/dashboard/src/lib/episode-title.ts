import type { LibraryEpisode } from "./types";

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
    .replace(/\s+\b(?:tit(?:ulky)?|dab|dabing|dubbed)\b(?:\s+\b(?:tit(?:ulky)?|dab|dabing|dubbed)\b)*$/i, "")
    .replace(/\s{2,}/g, " ")
    .trim();

  return title || `Episode ${input.episodeNumber ?? "Unknown"}`;
}

export function formatEpisodeTitle(episode: Pick<LibraryEpisode, "showTitle" | "episodeTitle" | "episodeCode" | "episodeNumber">) {
  return formatEpisodeTitleParts(episode);
}
