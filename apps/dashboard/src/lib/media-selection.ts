import type { EpisodePlayer, SubtitleSource } from "./types";
import { getCanonicalLanguageKey, getCanonicalLanguageLabel, getLanguagePresentation } from "./language";

export type AudioOption = {
  key: string;
  label: string;
  flags: string[];
  players: EpisodePlayer[];
};

export type SubtitleOption = {
  id: string;
  languageKey: string;
  languageTag: string;
  label: string;
  sourceLabel: string;
  sourceUrl: string;
};

function normalizedLanguage(value?: string | null) {
  return String(value ?? "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

export function getAudioLanguageKey(value?: string | null) {
  const canonical = getCanonicalLanguageKey(value);
  if (!canonical.includes("audio") && canonical.includes("subs")) return "original";
  if (canonical.startsWith("en-")) return "en";
  if (canonical.startsWith("cz-")) return "cs";
  if (canonical.startsWith("sk-")) return "sk";
  if (canonical === "available-streams" || canonical.includes("subs")) return "original";
  return canonical;
}

export function getAudioLanguageLabel(value?: string | null) {
  switch (getAudioLanguageKey(value)) {
    case "en": return "English";
    case "cs": return "Czech";
    case "sk": return "Slovak";
    case "original": return "Original / default";
    default: return getCanonicalLanguageLabel(value);
  }
}

export function getSubtitleLanguageKey(value?: string | null) {
  const canonical = getCanonicalLanguageKey(value);
  if (canonical.includes("czsk")) return "cs-sk";
  if (canonical.includes("cz")) return "cs";
  if (canonical.includes("sk")) return "sk";
  if (canonical.includes("en")) return "en";
  const normalized = normalizedLanguage(value);
  if (/\b(?:czech|cesk|cz|cs)\b/.test(normalized)) return "cs";
  if (/\b(?:slovak|slovensk|sk)\b/.test(normalized)) return "sk";
  if (/\b(?:english|eng|en)\b/.test(normalized)) return "en";
  return canonical === "available-streams" || canonical === "subtitles" ? "und" : canonical;
}

export function getSubtitleLanguageTag(value?: string | null) {
  const key = getSubtitleLanguageKey(value);
  return key === "cs-sk" ? "cs" : /^[a-z]{2,3}(?:-[a-z0-9]{2,8})*$/i.test(key) ? key : "und";
}

export function getSubtitleLanguageLabel(value?: string | null) {
  switch (getSubtitleLanguageKey(value)) {
    case "cs-sk": return "Czech / Slovak";
    case "cs": return "Czech";
    case "sk": return "Slovak";
    case "en": return "English";
    case "und": return "Subtitles";
    default: return getCanonicalLanguageLabel(value).replace(/\s+subtitles?$/i, "") || "Subtitles";
  }
}

function validPlayer(player: EpisodePlayer) {
  const candidate = player.streamUrl || player.embedUrl;
  try {
    const url = new URL(candidate);
    return url.protocol === "http:" || url.protocol === "https:" || url.protocol === "blob:";
  } catch {
    return candidate.startsWith("/") && !candidate.startsWith("//");
  }
}

export function buildAudioOptions(players: EpisodePlayer[]): AudioOption[] {
  const groups = new Map<string, AudioOption>();
  for (const player of players.filter(validPlayer)) {
    const key = getAudioLanguageKey(player.language);
    const presentation = getLanguagePresentation(getAudioLanguageLabel(player.language));
    const group = groups.get(key) ?? {
      key,
      label: getAudioLanguageLabel(player.language),
      flags: presentation.flags,
      players: [],
    };
    group.players.push(player);
    groups.set(key, group);
  }
  return Array.from(groups.values());
}

function validSubtitleUrl(value: string) {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:" || url.protocol === "blob:";
  } catch {
    return value.startsWith("/") && !value.startsWith("//");
  }
}

export function buildSubtitleOptions(
  players: EpisodePlayer[],
  discovered: SubtitleSource[] = [],
): SubtitleOption[] {
  const raw = [
    ...discovered.map((subtitle) => ({
      url: subtitle.url,
      language: subtitle.language ?? subtitle.label,
      label: subtitle.label || subtitle.integrationId,
    })),
    ...players.filter((player) => player.subtitlesUrl).map((player) => ({
      url: player.subtitlesUrl!,
      language: getCanonicalLanguageKey(player.language).includes("subs") ? player.language : undefined,
      label: player.label || player.provider,
    })),
  ];
  const seen = new Set<string>();
  const options: SubtitleOption[] = [];

  for (const entry of raw) {
    if (!validSubtitleUrl(entry.url)) continue;
    if (seen.has(entry.url)) continue;
    seen.add(entry.url);
    const languageKey = getSubtitleLanguageKey(entry.language);
    const dedupeKey = `${languageKey}:${entry.url}`;
    options.push({
      id: dedupeKey,
      languageKey,
      languageTag: getSubtitleLanguageTag(entry.language),
      label: getSubtitleLanguageLabel(entry.language),
      sourceLabel: entry.label,
      sourceUrl: entry.url,
    });
  }
  return options;
}

export function buildSubtitleProxyUrl(sourceUrl: string, runtimeBaseUrl: string, hostedOrigin?: string) {
  const base = runtimeBaseUrl.replace(/\/+$/, "");
  if (sourceUrl.startsWith("blob:")) return sourceUrl;
  const resolved = new URL(sourceUrl, `${base}/`);
  if (resolved.pathname === "/api/download-full/subtitle-file" || resolved.pathname === "/api/subtitle-proxy") return resolved.href;
  const path = `/api/subtitle-proxy?url=${encodeURIComponent(resolved.href)}`;
  const runtime = new URL(base);
  if (runtime.hostname === "loca.lt" || runtime.hostname.endsWith(".loca.lt")) {
    const host = hostedOrigin ?? (typeof window !== "undefined" ? window.location.origin : "");
    if (host) {
      const proxy = new URL("/api/node-proxy", host);
      proxy.searchParams.set("node", runtime.origin);
      proxy.searchParams.set("path", path);
      return `${proxy.pathname}${proxy.search}`;
    }
  }
  return `${base}${path}`;
}

export function normalizeSubtitlePayload(value: string) {
  const trimmed = String(value ?? "").replace(/^\uFEFF/, "").trimStart();
  if (!trimmed) throw new Error("The subtitle file is empty.");
  if (/^\s*<(?:!doctype\s+html|html|head|body)\b/i.test(trimmed)) {
    throw new Error("The subtitle source returned a web page instead of captions.");
  }

  const normalized = trimmed.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const converted = normalized.replace(/(\d{2}:\d{2}:\d{2}),(\d{3})/g, "$1.$2");
  if (!/\d{2}:\d{2}(?::\d{2})?[.,]\d{3}\s+-->\s+\d{2}:\d{2}(?::\d{2})?[.,]\d{3}/.test(normalized)) {
    throw new Error("This subtitle format is not compatible with the player.");
  }
  return /^WEBVTT\b/.test(converted) ? converted : `WEBVTT\n\n${converted}`;
}

export function choosePreferredSubtitleId(options: SubtitleOption[], preferredLanguage: string | null | undefined) {
  if (!preferredLanguage || preferredLanguage === "off") return null;
  return options.find((option) => option.languageKey === preferredLanguage)?.id ?? null;
}
