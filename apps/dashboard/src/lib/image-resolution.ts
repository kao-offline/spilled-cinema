import type { CSSProperties } from "react";

export type ImageResolutionRole =
  | "poster-thumb"
  | "poster-card"
  | "poster-detail"
  | "backdrop-thumb"
  | "backdrop-hero"
  | "logo";

const TMDB_SIZES: Record<Exclude<ImageResolutionRole, "logo">, string> = {
  "poster-thumb": "w185",
  "poster-card": "w342",
  "poster-detail": "w500",
  "backdrop-thumb": "w780",
  "backdrop-hero": "w1280",
};

const ROLE_WIDTHS: Record<ImageResolutionRole, number> = {
  "poster-thumb": 185,
  "poster-card": 342,
  "poster-detail": 500,
  "backdrop-thumb": 780,
  "backdrop-hero": 1280,
  logo: 600,
};

function parseUrl(url: string) {
  try {
    return new URL(url);
  } catch {
    return null;
  }
}

function optimizeTmdbUrl(parsed: URL, role: ImageResolutionRole) {
  if (!parsed.hostname.endsWith("image.tmdb.org")) {
    return null;
  }

  if (role === "logo") {
    return parsed.toString();
  }

  const parts = parsed.pathname.split("/");
  const sizeIndex = parts.findIndex((part) => /^(?:w\d+|original)$/.test(part));
  if (sizeIndex === -1) {
    return parsed.toString();
  }

  parts[sizeIndex] = TMDB_SIZES[role];
  parsed.pathname = parts.join("/");
  return parsed.toString();
}

function optimizeQueryWidth(parsed: URL, role: ImageResolutionRole) {
  const width = ROLE_WIDTHS[role];
  let changed = false;

  for (const key of ["w", "width"]) {
    if (parsed.searchParams.has(key)) {
      const current = Number.parseInt(parsed.searchParams.get(key) ?? "", 10);
      if (!Number.isFinite(current) || current > width) {
        parsed.searchParams.set(key, String(width));
        changed = true;
      }
    }
  }

  if (parsed.hostname.endsWith("image.tmdb.org")) {
    parsed.searchParams.set("quality", role === "backdrop-hero" ? "80" : "76");
    changed = true;
  }

  return changed ? parsed.toString() : null;
}

export function balanceImageResolution(url: string | null | undefined, role: ImageResolutionRole) {
  if (!url) {
    return null;
  }

  const parsed = parseUrl(url);
  if (!parsed) {
    return url;
  }

  return optimizeTmdbUrl(parsed, role) ?? optimizeQueryWidth(parsed, role) ?? url;
}

export function balancedBackgroundImage(url: string | null | undefined, role: ImageResolutionRole): CSSProperties | undefined {
  const balancedUrl = balanceImageResolution(url, role);
  return balancedUrl ? { backgroundImage: `url(${balancedUrl})` } : undefined;
}
