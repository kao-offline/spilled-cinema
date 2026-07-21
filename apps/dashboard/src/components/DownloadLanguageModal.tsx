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
    <div className="fixed inset-0 z-[140] flex items-center justify-center bg-black/82 px-3 py-6 backdrop-blur-2xl">
      <div className="relative w-full max-w-xl overflow-hidden rounded-[1.5rem] border border-white/[0.1] bg-[#0b0c10]/96 shadow-[0_40px_120px_rgba(0,0,0,0.72)]">

        <button
          onClick={onClose}
          className="absolute right-4 top-4 z-10 flex h-10 w-10 items-center justify-center rounded-full border border-white/[0.08] bg-white/[0.04] text-white/45 transition hover:border-white/15 hover:bg-white/[0.09] hover:text-white"
          aria-label="Close language chooser"
        >
          <X className="h-5 w-5" />
        </button>

        <div className="p-5 sm:p-7">
          <div className="mb-5 border-b border-white/[0.07] pb-5 pr-12">
            <div className="text-[10px] font-black uppercase tracking-[0.3em] text-white/30">
              Download language
            </div>
            <h3 className="mt-2 text-2xl font-black tracking-[-0.03em] text-white">
              {episode.showTitle}
            </h3>
            <p className="mt-1.5 text-sm leading-6 text-white/42">
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
                    "group flex w-full items-center justify-between gap-3 rounded-2xl border border-white/[0.07] bg-white/[0.025] p-3.5 text-left transition hover:border-white/16 hover:bg-white/[0.065]",
                  )}
                >
                  <div className="flex min-w-0 flex-1 items-center gap-3">
                    <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-white/[0.08] bg-white/[0.045] text-white/68">
                      <Download className="h-5 w-5" />
                    </span>

                    <div className="min-w-0 space-y-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="inline-flex items-center gap-2 text-[11px] font-black uppercase tracking-[0.16em] text-white/82">
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

                  <div className="rounded-full bg-white px-4 py-2 text-[10px] font-black uppercase tracking-[0.2em] text-black transition group-hover:bg-white/85">
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
