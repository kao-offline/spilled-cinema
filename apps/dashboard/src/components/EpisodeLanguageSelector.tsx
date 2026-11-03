import { useId } from "react";
import type { LibraryEpisode } from "../lib/types";
import { episodeLanguageOptions, type EpisodeLanguageRow } from "../lib/episode-language-options";

type Props = { episode: LibraryEpisode; onSelect: (episode: LibraryEpisode) => void };

export function EpisodeLanguageSelector({ episode, onSelect }: Props) {
  const id = useId();
  const rows = episodeLanguageOptions(episode).filter((row) => row.sub || row.dub);
  const visibleRows = rows.slice(0, 3);
  const select = (alias: string) => onSelect({ ...episode, selectedPlayerAlias: alias });
  const choice = (row: EpisodeLanguageRow, kind: "sub" | "dub", fullLabel = false) => {
    const alias = row[kind];
    const label = `${row.label}, ${kind === "sub" ? "subtitles" : "audio"}${alias ? "" : ", unavailable"}`;
    return <button key={`${row.code}:${kind}`} type="button" disabled={!alias} title={label} aria-label={label} onClick={() => { if (alias) select(alias); }}>
      {fullLabel ? kind === "sub" ? "SUB" : "DUB" : row.flag ? <img src={`/design/flags/${row.flag}${alias ? "" : "-disabled"}.png`} alt="" /> : row.code === "sk" ? <span aria-hidden="true">{"\u{1F1F8}\u{1F1F0}"}</span> : row.code === "unknown" ? "?" : row.code.startsWith("other:") ? row.label.slice(0, 3).toUpperCase() : row.code.toUpperCase()}
    </button>;
  };
  return <div className="episode-languages" role="group" aria-label={`Language options for ${episode.episodeTitle ?? episode.episodeCode}`}>
    <span>SUB</span><span>DUB</span>
    {visibleRows.flatMap((row) => (["sub", "dub"] as const).map((kind) => choice(row, kind)))}
    {rows.length > 3 ? <>
      <button type="button" className="episode-languages-more" popoverTarget={id} aria-haspopup="dialog" aria-label={`More language options for ${episode.episodeTitle ?? episode.episodeCode}`}>More</button>
      <div id={id} className="episode-language-popover spilled-floating-panel" popover="auto" role="dialog" aria-labelledby={`${id}-title`}>
        <header><h3 id={`${id}-title`}>{episode.episodeTitle ?? episode.episodeCode}</h3><button type="button" popoverTarget={id} popoverTargetAction="hide" autoFocus aria-label="Close language options">Close</button></header>
        <div className="episode-language-options"><span>Language</span><span>SUB</span><span>DUB</span>
          {rows.flatMap((row) => [<span key={row.code}>{row.label}</span>, choice(row, "sub", true), choice(row, "dub", true)])}
        </div>
      </div>
    </> : null}
  </div>;
}
