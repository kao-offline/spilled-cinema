import type { ImportedShow } from "./types";

const ARCHIVE_KEY = "spilled-library.import-archive.v1";

export type ImportedShowArchiveEntry = {
  slug: string;
  title: string;
  altTitle?: string | null;
  description?: string | null;
  years?: string | null;
  posterUrl?: string | null;
  backdropUrl?: string | null;
  clearLogoUrl?: string | null;
  availableSeasons: number[];
  importedAt: number;
  episodes: Array<{
    id: string;
    seasonNumber: number;
    episodeNumber: number | null;
    episodeCode: string | null;
    episodeTitle: string | null;
  }>;
};

function canUseStorage() {
  return typeof window !== "undefined";
}

function readArchiveMap(): Record<string, ImportedShowArchiveEntry> {
  if (!canUseStorage()) {
    return {};
  }

  const raw = window.localStorage.getItem(ARCHIVE_KEY);
  if (!raw) {
    return {};
  }

  try {
    const parsed = JSON.parse(raw) as Record<string, ImportedShowArchiveEntry>;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function writeArchiveMap(value: Record<string, ImportedShowArchiveEntry>) {
  if (!canUseStorage()) {
    return;
  }
  window.localStorage.setItem(ARCHIVE_KEY, JSON.stringify(value));
}

export function archiveImportedShow(show: ImportedShow) {
  const archive = readArchiveMap();
  archive[show.slug] = {
    slug: show.slug,
    title: show.title,
    altTitle: show.altTitle ?? null,
    description: show.description ?? null,
    years: show.years ?? null,
    posterUrl: show.posterUrl ?? null,
    backdropUrl: show.backdropUrl ?? null,
    clearLogoUrl: show.clearLogoUrl ?? null,
    availableSeasons: [...show.availableSeasons],
    importedAt: show.importedAt,
    episodes: show.episodes.map((episode) => ({
      id: episode.id,
      seasonNumber: episode.seasonNumber,
      episodeNumber: episode.episodeNumber,
      episodeCode: episode.episodeCode,
      episodeTitle: episode.episodeTitle,
    })),
  };
  writeArchiveMap(archive);
}

export function readImportedArchive(): ImportedShowArchiveEntry[] {
  return Object.values(readArchiveMap()).sort((left, right) => right.importedAt - left.importedAt);
}
