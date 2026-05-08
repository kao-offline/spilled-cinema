import { clsx } from "clsx";
import { getLanguagePresentation } from "../lib/language";

type LanguageBadgeProps = {
  language?: string | null;
  className?: string;
};

function emojiToTwemojiUrl(emoji: string) {
  const code = Array.from(emoji)
    .map((char) => char.codePointAt(0)!.toString(16))
    .join("-");
  return `https://twemoji.maxcdn.com/v/latest/svg/${code}.svg`;
}

export function LanguageBadge({ language, className }: LanguageBadgeProps) {
  const presentation = getLanguagePresentation(language);

  return (
    <span
      className={clsx(
        "inline-flex min-w-0 max-w-full items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-[11px] font-black uppercase tracking-[0.18em] text-white/80",
        className,
      )}
    >
      {presentation.flags.length > 0 ? (
        <span className="flex items-center gap-1.5">
          {presentation.flags.map((flag) => (
            <img key={flag} src={emojiToTwemojiUrl(flag)} alt="" className="h-3.5 w-3.5" />
          ))}
        </span>
      ) : (
        <img src={emojiToTwemojiUrl("🎬")} alt="" className="h-3.5 w-3.5" />
      )}
      <span className="min-w-0 truncate">{presentation.label}</span>
    </span>
  );
}
