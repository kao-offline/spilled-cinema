import { Search, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type { CommandSearchResult } from "../lib/command-search";
import { CommandResultRow } from "./CommandResultRow";

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
}: CommandMenuProps) {
  const [expandedId, setExpandedId] = useState<string | null>(null);
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
        className="relative w-full max-w-[560px] animate-command-panel overflow-hidden rounded-[1.4rem] border border-white/[0.11] bg-white/[0.055] shadow-[0_30px_90px_rgba(0,0,0,0.72)] ring-1 ring-black/40 backdrop-blur-2xl"
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

        <div className="max-h-[min(540px,64vh)] overflow-y-auto p-2">
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
      </div>
    </div>
  );
}
