export type LanguagePresentation = {
  label: string;
  flags: string[];
  labelWithFlags: string;
};

function uniqueFlags(flags: string[]) {
  return Array.from(new Set(flags));
}

export function getLanguagePresentation(rawLanguage?: string | null): LanguagePresentation {
  const label = (rawLanguage ?? "").replace(/\s+/g, " ").trim() || "Available Streams";
  const normalized = label.toLowerCase();

  const flags: string[] = [];

  if (/\b(?:en|eng|english|gb|uk|british|us|usa|american)\b/.test(normalized)) {
    flags.push("🇬🇧");
  }

  if (/\b(?:cz|cesk|česk|czech)\b/.test(normalized)) {
    flags.push("🇨🇿");
  }

  if (/\b(?:sk|slovak|slovensk)\b/.test(normalized)) {
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
