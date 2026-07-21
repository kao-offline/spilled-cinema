export type LanguagePresentation = {
  label: string;
  flags: string[];
  labelWithFlags: string;
};

function normalizeLanguageText(value?: string | null) {
  return String(value ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

export function getCanonicalLanguageKey(rawLanguage?: string | null) {
  const normalized = normalizeLanguageText(rawLanguage);
  if (!normalized) {
    return "available-streams";
  }

  const hasEnglish = /\b(?:en|eng|english|gb|uk|british|us|usa|american)\b/.test(normalized);
  const hasCzech = /\b(?:cz|cs|cesk|cesky|ceska|czech)\b/.test(normalized);
  const hasSlovak = /\b(?:sk|slovak|slovensk)\b/.test(normalized);
  const hasDub = /\b(?:dub|dab|dabing|dubbed|audio)\b/.test(normalized);
  const hasSubs = /\b(?:sub|subs|subtitle|subtitles|tit|titulky)\b/.test(normalized);

  if (hasEnglish && hasCzech && hasSlovak && hasSubs) return "en-audio-czsk-subs";
  if (hasEnglish && hasCzech && hasSubs) return "en-audio-cz-subs";
  if (hasEnglish && hasSlovak && hasSubs) return "en-audio-sk-subs";
  if (hasCzech && hasSlovak && hasSubs) return "czsk-subs";
  if (hasCzech && hasDub) return "cz-audio";
  if (hasSlovak && hasDub) return "sk-audio";
  if (hasCzech && hasSubs) return "cz-subs";
  if (hasSlovak && hasSubs) return "sk-subs";
  if (hasEnglish && hasSubs) return "en-subs";
  if (hasEnglish) return "en-audio";
  if (hasCzech) return "cz-audio";
  if (hasSlovak) return "sk-audio";
  return normalized;
}

export function getCanonicalLanguageLabel(rawLanguage?: string | null) {
  switch (getCanonicalLanguageKey(rawLanguage)) {
    case "en-audio-czsk-subs":
      return "English audio + CZ/SK subtitles";
    case "en-audio-cz-subs":
      return "English audio + Czech subtitles";
    case "en-audio-sk-subs":
      return "English audio + Slovak subtitles";
    case "czsk-subs":
      return "CZ/SK subtitles";
    case "cz-audio":
      return "Czech audio";
    case "sk-audio":
      return "Slovak audio";
    case "cz-subs":
      return "Czech subtitles";
    case "sk-subs":
      return "Slovak subtitles";
    case "en-subs":
      return "English subtitles";
    case "en-audio":
      return "English audio";
    case "available-streams":
      return "Available Streams";
    default:
      return (rawLanguage ?? "").replace(/\s+/g, " ").trim() || "Available Streams";
  }
}

function uniqueFlags(flags: string[]) {
  return Array.from(new Set(flags));
}

function getAudioLanguageFlags(normalized: string) {
  const audioMatch = normalized.match(/^(.+?)\s+audio\b/);
  if (!audioMatch) {
    return null;
  }

  const audioLabel = audioMatch[1] ?? "";
  const flags: string[] = [];

  if (/\b(?:en|eng|english|gb|uk|british|us|usa|american)\b/.test(audioLabel)) {
    flags.push("🇬🇧");
  }

  if (/\b(?:cz|cesk|česk|czech)\b/.test(audioLabel)) {
    flags.push("🇨🇿");
  }

  if (/\b(?:sk|slovak|slovensk)\b/.test(audioLabel)) {
    flags.push("🇸🇰");
  }

  return uniqueFlags(flags);
}

export function getLanguagePresentation(rawLanguage?: string | null): LanguagePresentation {
  const label = getCanonicalLanguageLabel(rawLanguage);
  const normalized = label.toLowerCase();

  const flags: string[] = getAudioLanguageFlags(normalized) ?? [];

  if (flags.length === 0 && /\b(?:en|eng|english|gb|uk|british|us|usa|american)\b/.test(normalized)) {
    flags.push("🇬🇧");
  }

  if (flags.length === 0 && /\b(?:cz|cesk|česk|czech)\b/.test(normalized)) {
    flags.push("🇨🇿");
  }

  if (flags.length === 0 && /\b(?:sk|slovak|slovensk)\b/.test(normalized)) {
    flags.push("🇸🇰");
  }

  if (flags.length === 0 && /\b(?:dub|dab|sub|tit|subtitle|subtitles|titulky)\b/.test(normalized)) {
    flags.push("🎬");
  }

  const unique = uniqueFlags(flags);
  return {
    label,
    flags: unique,
    labelWithFlags: unique.length > 0 ? `${unique.join(" ")} ${label}` : label,
  };
}
