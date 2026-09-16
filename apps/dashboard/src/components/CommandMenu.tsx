import { Gamepad2, Search, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type { CommandSearchResult } from "../lib/command-search";
import { CommandResultRow } from "./CommandResultRow";
import { RemoteBindingsModal } from "./RemoteBindingsModal";
import { TvModeToggle } from "./TvModeToggle";

type CommandMenuProps = {
  open: boolean;
  query: string;
  onQueryChange: (value: string) => void;
  results: CommandSearchResult[];
  loading: boolean;
  busyResultId: string | null;
  onClose: () => void;
  onPlay: (result: CommandSearchResult) => void;
  onAdd: (result: CommandSearchResult) => void;
  onMore: (result: CommandSearchResult) => void;
  tvModeEnabled: boolean;
  onTvModeChange: (enabled: boolean) => void;
};

export function CommandMenu({
  open,
  query,
  onQueryChange,
  results,
  loading,
  busyResultId,
  onClose,
  onPlay,
  onAdd,
  onMore,
  tvModeEnabled,
  onTvModeChange,
}: CommandMenuProps) {
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [remoteSetupOpen, setRemoteSetupOpen] = useState(false);
  const firstResultId = results[0]?.id ?? null;

  useEffect(() => {
    if (!open) {
      setExpandedId(null);
      return;
    }
    setExpandedId(firstResultId);
  }, [firstResultId, open]);

  useEffect(() => {
    if (!open) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose, open]);

  const groupedResults = useMemo(() => {
    const local = results.filter((result) => result.kind === "local-title");
    const remote = results.filter((result) => result.kind === "remote-title");
    const people = results.filter((result) => result.kind === "person");
    return [
      { id: "local", label: "Local Vault", results: local },
      { id: "remote", label: "Sources", results: remote },
      { id: "people", label: "People", results: people },
    ].filter((group) => group.results.length > 0);
  }, [results]);

  if (!open) {
    return null;
  }

  return (
    <div className="fixed inset-0 z-[100] flex animate-command-backdrop items-start justify-center overflow-hidden bg-black/48 px-3 pt-[16vh] backdrop-blur-2xl sm:px-6 md:pt-[18vh]" onMouseDown={onClose}>
      <div className="pointer-events-none absolute -left-20 top-8 h-72 w-72 rounded-full bg-orange-400/10 blur-3xl" />
      <div className="pointer-events-none absolute right-0 top-1/4 h-96 w-96 rounded-full bg-cyan-300/8 blur-3xl" />
      <div
        className={`relative w-full animate-command-panel overflow-hidden rounded-[1.4rem] border border-white/[0.11] bg-white/[0.055] shadow-[0_30px_90px_rgba(0,0,0,0.72)] ring-1 ring-black/40 backdrop-blur-2xl ${tvModeEnabled ? "tv-search max-w-[560px]" : "max-w-[560px]"}`}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="flex items-center gap-3 border-b border-white/[0.06] px-4 py-3">
          <Search className="h-4 w-4 shrink-0 text-white/42" />
          <input
            autoFocus
            value={query}
            onChange={(event) => onQueryChange(event.target.value)}
            placeholder="Search vault, actors, directors, Bombuj, SvetSerialu, VidKing..."
            className="min-w-0 flex-1 bg-transparent text-[15px] font-medium text-white outline-none placeholder:text-white/28"
          />
          {loading ? <span className="text-[11px] font-semibold uppercase tracking-[0.22em] text-white/32">Searching</span> : null}
          <button
            type="button"
            onClick={onClose}
            className="flex h-8 w-8 items-center justify-center rounded-full bg-white/7 text-white/58 transition hover:bg-white/12 hover:text-white"
            aria-label="Close search"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="max-h-[min(500px,58vh)] overflow-y-auto p-2">
          {groupedResults.length > 0 ? (
            <div className="space-y-3">
              {groupedResults.map((group) => (
                <section key={group.id}>
                  <div className="px-3 py-2 text-[10px] font-bold uppercase tracking-[0.24em] text-white/28">{group.label}</div>
                  <div className="space-y-1">
                    {group.results.map((result) => (
                      <div key={result.id} className="animate-command-row">
                      <CommandResultRow
                        result={result}
                        expanded={expandedId === result.id}
                        busy={busyResultId === result.id}
                        onToggle={() => setExpandedId((current) => (current === result.id ? null : result.id))}
                        onPlay={() => onPlay(result)}
                        onAdd={() => onAdd(result)}
                        onMore={() => onMore(result)}
                      />
                      </div>
                    ))}
                  </div>
                </section>
              ))}
            </div>
          ) : (
            <div className="flex min-h-56 flex-col items-center justify-center px-8 text-center">
              <div className="text-sm font-semibold text-white/70">{query.trim() ? "No matches yet." : "Start typing to search everything."}</div>
              <div className="mt-2 max-w-sm text-xs leading-5 text-white/35">
                Search your vault, source catalogs, actors, directors, and saved downloads from one place.
              </div>
            </div>
          )}
        </div>

        <footer className="flex flex-col gap-2 border-t border-white/[0.07] bg-black/18 p-2 sm:flex-row" aria-label="TV controls">
          <TvModeToggle enabled={tvModeEnabled} onChange={onTvModeChange} />
          <button
            type="button"
            onClick={() => setRemoteSetupOpen(true)}
            className="group flex min-h-12 flex-1 items-center gap-3 rounded-2xl border border-white/8 bg-white/[.035] px-3 text-left text-white transition hover:border-orange-200/24 hover:bg-orange-200/[.07] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-100/60"
          >
            <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-orange-200/10 text-orange-100/68 transition group-hover:bg-orange-200/16 group-hover:text-orange-50">
              <Gamepad2 className="h-4 w-4" />
            </span>
            <span>
              <span className="block text-[10px] font-black uppercase tracking-[0.18em] text-white/88">Remote buttons</span>
              <span className="block text-[9px] font-semibold text-white/36">Set up IR or keyboard binds</span>
            </span>
          </button>
        </footer>
      </div>
      <RemoteBindingsModal open={remoteSetupOpen} onClose={() => setRemoteSetupOpen(false)} />
    </div>
  );
}
