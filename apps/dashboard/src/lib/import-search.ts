import type { IntegrationId } from "./integrations";

export type ResolvedImportInput = {
  mode: "direct" | "search";
  platform?: IntegrationId;
  slug?: string;
  mediaType?: "movie" | "serial";
  query?: string;
};

function cleanSlug(value: string) {
  try {
    return decodeURIComponent(value).trim().replace(/^\/+|\/+$/g, "").toLowerCase();
  } catch {
    return value.trim().replace(/^\/+|\/+$/g, "").toLowerCase();
  }
}

function parseUrlLike(value: string) {
  try {
    return new URL(value);
  } catch {
    if (/^(?:www\.)?(?:serialy\.)?bombuj\.(?:si|to)\//i.test(value) || /^(?:www\.)?svetserial(?:u|ov)\.(?:to|io)\//i.test(value)) {
      try {
        return new URL(`https://${value}`);
      } catch {
        return null;
      }
    }
    return null;
  }
}

export function resolveImportInput(rawValue: string): ResolvedImportInput {
  const value = rawValue.trim();
  if (!value) return { mode: "search", query: "" };

  const vidkingSlug = value.match(/^(movie|tv)\/(\d+)(?:\/(\d+)\/(\d+))?$/i);
  if (vidkingSlug) {
    return { mode: "direct", platform: "vidking", slug: value.toLowerCase(), mediaType: vidkingSlug[1].toLowerCase() === "tv" ? "serial" : "movie" };
  }

  const parsed = parseUrlLike(value);
  if (!parsed) return { mode: "search", query: value };
  const host = parsed.hostname.toLowerCase().replace(/^www\./, "");
  const parts = parsed.pathname.split("/").filter(Boolean);

  if (host === "vidking.net" || host.endsWith(".vidking.net")) {
    const embedIndex = parts.findIndex((part) => part.toLowerCase() === "embed");
    const type = parts[embedIndex + 1]?.toLowerCase();
    const tmdbId = parts[embedIndex + 2];
    if ((type === "movie" || type === "tv") && tmdbId) {
      return { mode: "direct", platform: "vidking", slug: parts.slice(embedIndex + 1, embedIndex + 5).join("/").toLowerCase(), mediaType: type === "tv" ? "serial" : "movie" };
    }
  }

  if (["svetserialu.to", "svetserialu.io", "svetserialov.to"].includes(host)) {
    const serialIndex = parts.findIndex((part) => part.toLowerCase() === "serial");
    if (serialIndex >= 0 && parts[serialIndex + 1]) {
      return { mode: "direct", platform: "svetserialu", slug: cleanSlug(parts[serialIndex + 1]), mediaType: "serial" };
    }
  }

  if (host === "bombuj.si" || host.endsWith(".bombuj.si") || host === "bombuj.to" || host.endsWith(".bombuj.to")) {
    const tail = cleanSlug(parts.at(-1) ?? "");
    const movie = tail.match(/^(?:online-)?film-(.+)$/i);
    if (movie?.[1]) return { mode: "direct", platform: "bombuj", slug: cleanSlug(movie[1]), mediaType: "movie" };
    const serial = tail.match(/^(?:online-)?serial-(.+)$/i);
    if (serial?.[1]) return { mode: "direct", platform: "bombuj", slug: cleanSlug(serial[1]), mediaType: "serial" };
  }

  if (host === "cineby.at" || host.endsWith(".cineby.at")) {
    const type = parts[0]?.toLowerCase();
    if ((type === "movie" || type === "tv") && parts[1]) {
      return { mode: "direct", platform: "cineby", slug: parts.slice(0, 3).join("/").toLowerCase(), mediaType: type === "tv" ? "serial" : "movie" };
    }
  }

  return { mode: "search", query: value };
}

export function prioritizeImportSearchResults<T extends { platform?: IntegrationId; provider?: IntegrationId }>(results: T[], limit = 6) {
  if (results.length <= 1 || limit <= 0) return results.slice(0, Math.max(0, limit));
  const selected: T[] = [];
  const seen = new Set<T>();
  const providers: IntegrationId[] = ["vidking", "svetserialu", "bombuj", "cineby"];
  for (const provider of providers) {
    const match = results.find((result) => (result.platform ?? result.provider) === provider);
    if (match && selected.length < limit) {
      selected.push(match);
      seen.add(match);
    }
  }
  for (const result of results) {
    if (selected.length >= limit) break;
    if (!seen.has(result)) selected.push(result);
  }
  return selected;
}
