import { Download, LoaderCircle, Search } from "lucide-react";
import { useEffect, useRef } from "react";
import { clsx } from "clsx";

type ImportViewProps = {
  importSlug: string;
  onImportSlugChange: (value: string) => void;
  onSubmit: () => Promise<void>;
  importing: boolean;
  importMessage: string | null;
  isSearching: boolean;
  searchResults: {
    title: string;
    slug: string;
    platform: "svetserialu" | "bombuj";
    posterUrl?: string | null;
    mediaType?: "movie" | "serial";
    year?: string | null;
  }[];
  onPickResult: (result: {
    title: string;
    slug: string;
    platform: "svetserialu" | "bombuj";
    posterUrl?: string | null;
    mediaType?: "movie" | "serial";
    year?: string | null;
  }) => void;
};

export function ImportView({
  importSlug,
  onImportSlugChange,
  onSubmit,
  importing,
  importMessage,
  isSearching,
  searchResults,
  onPickResult,
}: ImportViewProps) {
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (importing || isSearching) {
      return;
    }
    inputRef.current?.focus();
  }, [importing, isSearching, searchResults.length]);

  return (
    <div className="relative z-10 flex min-h-[calc(100dvh-8rem)] flex-col items-center justify-start overflow-y-auto px-4 py-8 text-center animate-fade-in sm:px-6 sm:py-10 lg:h-[calc(100vh-6rem)] lg:px-10 lg:py-12">
      <div className="max-w-4xl w-full space-y-6">
        <div className="space-y-4">
          <h1 className="text-4xl font-semibold tracking-tight text-white mb-2">
            Import External Titles
          </h1>
          <p className="text-base font-medium text-white/40">
            Paste a `SvetSerialu` or `Bombuj` link, or just type a movie or series name and pick a result.
          </p>
        </div>

        <div className="mx-auto flex w-full flex-col gap-4">
          <div className="rounded-[28px] border border-white/6 bg-white/5 p-3 shadow-2xl">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
              <div className="flex min-w-0 flex-1 items-center gap-3 rounded-2xl bg-black/10 px-4 py-3">
                <Search className="h-4 w-4 shrink-0 text-white/35" />
                <input
                  ref={inputRef}
                  value={importSlug}
                  onChange={(event) => onImportSlugChange(event.target.value)}
                  placeholder="Paste a link or type a title like Inception"
                  className="min-w-0 flex-1 bg-transparent text-sm text-white placeholder-white/20 outline-none"
                  onKeyDown={(event) => {
                    if (event.key === "Enter" && !importing) {
                      event.preventDefault();
                      void onSubmit();
                    }
                  }}
                />
              </div>
              <button
                onClick={() => {
                  void onSubmit();
                }}
                disabled={importing || !importSlug.trim()}
                className="inline-flex items-center justify-center gap-2 rounded-2xl bg-orange-500 px-5 py-3 text-xs font-bold uppercase tracking-[0.2em] text-white transition-all hover:bg-orange-600 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {importing || isSearching ? (
                  <LoaderCircle className="h-4 w-4 animate-spin" />
                ) : (
                  <Download className="h-4 w-4" />
                )}
                Go
              </button>
            </div>

            <div className="mt-3 flex flex-wrap gap-2 text-left text-[11px] font-medium text-white/35">
              <span className="rounded-full border border-white/8 px-3 py-1">Whole link</span>
              <span className="rounded-full border border-white/8 px-3 py-1">Movie title</span>
              <span className="rounded-full border border-white/8 px-3 py-1">Series name</span>
            </div>
          </div>

          {searchResults.length > 0 ? (
            <div className="rounded-[28px] border border-white/6 bg-white/[0.04] p-3 text-left">
              <div className="px-2 pb-2 pt-1 text-[11px] font-semibold uppercase tracking-[0.28em] text-white/35">
                Matches
              </div>
              <div className="grid gap-2 lg:grid-cols-2">
                {searchResults.map((result) => (
                  <button
                    key={`${result.platform}-${result.slug}`}
                    onMouseDown={(event) => {
                      event.preventDefault();
                    }}
                    onClick={() => onPickResult(result)}
                    className="flex w-full items-center gap-3 rounded-2xl border border-white/6 bg-black/10 px-3 py-2.5 text-left transition-colors hover:bg-white/[0.05]"
                  >
                    <div
                      className="h-12 w-9 shrink-0 rounded-lg bg-[#121318] bg-cover bg-center"
                      style={result.posterUrl ? { backgroundImage: `url(${result.posterUrl})` } : undefined}
                    />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-semibold text-white">{result.title}</div>
                      <div className="mt-1 flex flex-wrap items-center gap-2 text-[11px] uppercase tracking-[0.18em] text-white/35">
                        <span>{result.platform === "svetserialu" ? "SvetSerialu" : "Bombuj"}</span>
                        {result.mediaType ? <span>{result.mediaType}</span> : null}
                        {result.year ? <span>{result.year}</span> : null}
                      </div>
                    </div>
                    <span className="rounded-full bg-white px-3 py-1 text-[10px] font-bold uppercase tracking-[0.18em] text-black">
                      Add
                    </span>
                  </button>
                ))}
              </div>
            </div>
          ) : null}

          {!isSearching && importSlug.trim().length >= 2 && searchResults.length === 0 && importMessage?.toLowerCase().includes("no external titles found") ? (
            <div className="rounded-2xl border border-dashed border-white/10 px-4 py-5 text-sm text-white/40">
              No matches found. Try a full link or a different title.
            </div>
          ) : null}

          {importMessage ? (
            <div className={clsx("text-sm font-medium", importMessage.toLowerCase().includes("imported") ? "text-green-400" : "text-white/50")}>
               {importMessage}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
