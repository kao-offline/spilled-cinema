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

const ECONOMY_TMDB_SIZES: Record<Exclude<ImageResolutionRole, "logo">, string> = {
  "poster-thumb": "w154",
  "poster-card": "w185",
  "poster-detail": "w342",
  "backdrop-thumb": "w300",
  "backdrop-hero": "w780",
};

const ROLE_WIDTHS: Record<ImageResolutionRole, number> = {
  "poster-thumb": 185,
  "poster-card": 342,
  "poster-detail": 500,
  "backdrop-thumb": 780,
  "backdrop-hero": 1280,
  logo: 600,
};

const ECONOMY_ROLE_WIDTHS: Record<ImageResolutionRole, number> = {
  "poster-thumb": 154,
  "poster-card": 220,
  "poster-detail": 342,
  "backdrop-thumb": 420,
  "backdrop-hero": 960,
  logo: 420,
};

export type ImageDeliveryScenario = {
  viewportWidth?: number;
  deviceMemoryGb?: number;
  saveData?: boolean;
  effectiveType?: string;
  tvMode?: boolean;
};

export function shouldUseEconomyArtwork(scenario: ImageDeliveryScenario) {
  return Boolean(
    scenario.saveData ||
    scenario.effectiveType === "slow-2g" ||
    scenario.effectiveType === "2g" ||
    scenario.effectiveType === "3g" ||
    scenario.tvMode ||
    (scenario.deviceMemoryGb != null && scenario.deviceMemoryGb <= 4) ||
    (scenario.viewportWidth != null && scenario.viewportWidth <= 1023),
  );
}

function browserImageScenario(): ImageDeliveryScenario {
  if (typeof window === "undefined") return {};
  const connection = (navigator as Navigator & { connection?: { saveData?: boolean; effectiveType?: string } }).connection;
  return {
    viewportWidth: window.innerWidth,
    deviceMemoryGb: (navigator as Navigator & { deviceMemory?: number }).deviceMemory,
    saveData: connection?.saveData,
    effectiveType: connection?.effectiveType,
    tvMode: document.documentElement.classList.contains("tv-mode"),
  };
}

function parseUrl(url: string) {
  try {
    return new URL(url);
  } catch {
    return null;
  }
}

function optimizeTmdbUrl(parsed: URL, role: ImageResolutionRole, economy: boolean) {
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

  parts[sizeIndex] = economy ? ECONOMY_TMDB_SIZES[role] : TMDB_SIZES[role];
  parsed.pathname = parts.join("/");
  return parsed.toString();
}

function optimizeQueryWidth(parsed: URL, role: ImageResolutionRole, economy: boolean) {
  const width = economy ? ECONOMY_ROLE_WIDTHS[role] : ROLE_WIDTHS[role];
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

export function balanceImageResolution(url: string | null | undefined, role: ImageResolutionRole, scenario = browserImageScenario()) {
  if (!url) {
    return null;
  }

  const parsed = parseUrl(url);
  if (!parsed) {
    return url;
  }

  const economy = shouldUseEconomyArtwork(scenario);
  return optimizeTmdbUrl(parsed, role, economy) ?? optimizeQueryWidth(parsed, role, economy) ?? url;
}

export function balancedBackgroundImage(url: string | null | undefined, role: ImageResolutionRole): CSSProperties | undefined {
  const balancedUrl = balanceImageResolution(url, role);
  return balancedUrl ? { backgroundImage: `url(${balancedUrl})` } : undefined;
}
