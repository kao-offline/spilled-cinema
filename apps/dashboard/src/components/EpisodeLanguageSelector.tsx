import type { LibraryEpisode } from "../lib/types";
import { episodeLanguageOptions } from "../lib/episode-language-options";

type Props = { episode: LibraryEpisode; onSelect: (episode: LibraryEpisode) => void };

export function EpisodeLanguageSelector({ episode, onSelect }: Props) {
  return <div className="episode-languages" role="group" aria-label={`Language options for ${episode.episodeTitle ?? episode.episodeCode}`}>
    <span>SUB</span><span>DUB</span>
    {episodeLanguageOptions(episode).flatMap((row) => (["sub", "dub"] as const).map((kind) => {
      const alias = row[kind];
      const label = `${row.label}, ${kind === "sub" ? "subtitles" : "audio"}${alias ? "" : ", unavailable"}`;
      return <button key={`${row.code}:${kind}`} type="button" disabled={!alias} title={label} aria-label={label}
        onClick={() => { if (alias) onSelect({ ...episode, selectedPlayerAlias: alias }); }}>
        {row.flag ? <img src={`/design/flags/${row.flag}${alias ? "" : "-disabled"}.png`} alt="" /> : row.code === "unknown" ? "?" : row.code.startsWith("other:") ? row.label.slice(0, 3).toUpperCase() : row.code.toUpperCase()}
      </button>;
    }))}
  </div>;
}
