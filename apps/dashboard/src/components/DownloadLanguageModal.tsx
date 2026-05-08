import { X, Download } from "lucide-react";
import type { PlayerAlias, LibraryEpisode } from "../lib/types";
import { clsx } from "clsx";
import { getLanguagePresentation } from "../lib/language";

export type DownloadLanguageOption = {
  language: string;
  flags: string[];
  playerCount: number;
  providers: string[];
  preferredAlias: PlayerAlias;
};

type DownloadLanguageModalProps = {
  episode: LibraryEpisode | null;
  options: DownloadLanguageOption[];
  onClose: () => void;
  onSelect: (alias: PlayerAlias) => void;
};

function formatProviderList(providers: string[]) {
  if (providers.length === 0) return "No providers";
  return providers.map((provider) => provider.toUpperCase()).join(" • ");
}

function buildLanguageSummary(raw: string, flagCount: number) {
  const normalized = raw.toLowerCase();
  if (/(dub|dab|dubbing|dubbed)/.test(normalized)) {
    return "Dubbed";
  }
  if (/(tit|sub|subtitle|subtitles|titulky)/.test(normalized)) {
    return "Subtitles";
  }
  if (flagCount > 1) {
    return "Multi Audio";
  }
  return "Audio";
}

function buildLanguageCodes(raw: string) {
  const normalized = raw.toLowerCase();
  const codes: string[] = [];
  if (/\b(?:en|eng|english|gb|uk|british|us|usa|american)\b/.test(normalized)) {
    codes.push("EN");
  }
  if (/\b(?:cz|cesk|česk|czech)\b/.test(normalized)) {
    codes.push("CZ");
  }
  if (/\b(?:sk|slovak|slovensk)\b/.test(normalized)) {
    codes.push("SK");
  }
  return Array.from(new Set(codes));
}

function emojiToTwemojiUrl(emoji: string) {
  const code = Array.from(emoji)
    .map((char) => char.codePointAt(0)!.toString(16))
    .join("-");
  return `https://twemoji.maxcdn.com/v/latest/svg/${code}.svg`;
}

export function DownloadLanguageModal({ episode, options, onClose, onSelect }: DownloadLanguageModalProps) {
  if (!episode || options.length === 0) {
    return null;
  }

  return (
    <div className="fixed inset-0 z-[140] flex items-center justify-center bg-black/80 px-3 py-6 backdrop-blur-xl">
      <div className="relative w-full max-w-2xl overflow-hidden rounded-[28px] border border-white/10 bg-[#101218]/95 shadow-[0_40px_120px_rgba(0,0,0,0.65)]">
        <div className="absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-cyan-400 via-emerald-400 to-orange-400" />

        <button
          onClick={onClose}
          className="absolute right-4 top-4 z-10 flex h-11 w-11 items-center justify-center rounded-full bg-white/5 text-white/50 transition hover:bg-white/10 hover:text-white"
          aria-label="Close language chooser"
        >
          <X className="h-5 w-5" />
        </button>

        <div className="p-6 sm:p-8">
          <div className="mb-6 space-y-2">
            <div className="text-[10px] font-black uppercase tracking-[0.45em] text-white/30">
              Choose download language
            </div>
            <h3 className="text-2xl font-bold tracking-tight text-white sm:text-3xl">
              {episode.showTitle}
            </h3>
            <p className="text-sm text-white/45">
              Select the language group to use for this download.
            </p>
          </div>

          <div className="grid gap-3">
            {options.map((option) => {
              const presentation = getLanguagePresentation(option.language);
              const summary = buildLanguageSummary(option.language, presentation.flags.length);
              const codes = buildLanguageCodes(option.language);

              return (
                <button
                  key={option.preferredAlias}
                  onClick={() => onSelect(option.preferredAlias)}
                  className={clsx(
                    "group flex w-full items-center justify-between gap-4 rounded-[20px] border border-white/10 bg-white/5 p-4 text-left transition hover:border-white/20 hover:bg-white/10",
                  )}
                >
                  <div className="flex min-w-0 flex-1 items-center gap-3">
                    <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-white/10 text-white/80 shadow-[inset_0_0_0_1px_rgba(255,255,255,0.04)]">
                      <Download className="h-5 w-5" />
                    </span>

                    <div className="min-w-0 space-y-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-[11px] font-black uppercase tracking-[0.18em] text-white/80">
                          {presentation.flags.length > 0 ? (
                            <span className="flex items-center gap-1.5">
                              {presentation.flags.map((flag) => (
                                <img
                                  key={flag}
                                  src={emojiToTwemojiUrl(flag)}
                                  alt=""
                                  className="h-3.5 w-3.5"
                                />
                              ))}
                            </span>
                          ) : (
                            <img
                              src={emojiToTwemojiUrl("🎬")}
                              alt=""
                              className="h-3.5 w-3.5"
                            />
                          )}
                          <span>{codes.length > 0 ? codes.join(" + ") : "Other"} {summary}</span>
                        </span>
                      </div>
                      <div className="text-xs text-white/35">
                        {option.playerCount} stream{option.playerCount === 1 ? "" : "s"} • {formatProviderList(option.providers)}
                      </div>
                    </div>
                  </div>

                  <div className="rounded-full bg-white px-4 py-2 text-[10px] font-black uppercase tracking-[0.28em] text-black shadow-[0_8px_24px_rgba(255,255,255,0.25)] transition group-hover:bg-cyan-300">
                    Download
                  </div>
                </button>
              );
            })}
          </div>

          <div className="mt-6 flex items-center justify-between text-[11px] uppercase tracking-[0.25em] text-white/25">
            <span>Episode {episode.episodeCode ?? episode.episodeNumber ?? "?"}</span>
            <button onClick={onClose} className="text-white/40 transition hover:text-white">
              Cancel
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
