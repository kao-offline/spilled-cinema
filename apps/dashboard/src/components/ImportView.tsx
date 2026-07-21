import { ChevronDown, Download, LoaderCircle, Search } from "lucide-react";
import { useEffect, useRef } from "react";
import { clsx } from "clsx";
import type { IntegrationId } from "../lib/integrations";
import { balancedBackgroundImage } from "../lib/image-resolution";

type ImportSearchResult = {
  title: string;
  slug: string;
  platform: IntegrationId;
  posterUrl?: string | null;
  mediaType?: "movie" | "serial";
  year?: string | null;
};

export type ImportPlatformFilter = "all" | IntegrationId;

type ImportViewProps = {
  importSlug: string;
  onImportSlugChange: (value: string) => void;
  platformFilter: ImportPlatformFilter;
  onPlatformFilterChange: (value: ImportPlatformFilter) => void;
  onSubmit: () => Promise<void>;
  importing: boolean;
  importMessage: string | null;
  isSearching: boolean;
  searchResults: ImportSearchResult[];
  onPickResult: (result: ImportSearchResult) => void;
};

const platformFilters: Array<{
  id: ImportPlatformFilter;
  label: string;
}> = [
  { id: "all", label: "All platforms" },
  { id: "vidking", label: "VidKing" },
  { id: "svetserialu", label: "SvetSerialu" },
  { id: "bombuj", label: "Bombuj" },
];

function platformLabel(platform: IntegrationId) {
  if (platform === "vidking") {
    return "VidKing";
  }
  if (platform === "svetserialu") {
    return "SvetSerialu";
  }
  if (platform === "bombuj") {
    return "Bombuj";
  }
  return "Unknown";
}

export function ImportView({
  importSlug,
  onImportSlugChange,
  platformFilter,
  onPlatformFilterChange,
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
    <div className="relative z-10 flex min-h-[calc(100dvh-8rem)] flex-col items-center justify-start overflow-y-auto px-4 pb-28 pt-5 animate-fade-in sm:px-6 sm:py-16 lg:h-[calc(100vh-6rem)] lg:px-10 lg:py-20">
      <div className="flex w-full max-w-4xl flex-col items-center gap-5">
        <div className="w-full max-w-3xl space-y-2 text-center">
          <h1 className="text-2xl font-black tracking-[-0.035em] text-white sm:text-4xl sm:font-semibold">
            Import titles
          </h1>
          <p className="text-sm font-medium text-white/40">
            Paste a link or search by title.
          </p>
        </div>

        <div className="w-full max-w-4xl rounded-[20px] border border-white/6 bg-white/[0.045] p-2.5 shadow-2xl sm:rounded-[24px] sm:p-3">
          <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_180px_auto] md:items-center">
            <div className="flex min-w-0 items-center gap-3 rounded-2xl bg-black/14 px-4 py-3">
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

            <label className="relative block">
              <span className="sr-only">Import platform</span>
              <select
                value={platformFilter}
                onChange={(event) => onPlatformFilterChange(event.target.value as ImportPlatformFilter)}
                className="h-full min-h-[44px] w-full appearance-none rounded-2xl border border-white/8 bg-black/14 px-4 py-3 pr-9 text-sm font-semibold text-white outline-none transition-colors hover:bg-white/[0.06] focus:border-orange-400/70"
              >
                {platformFilters.map((filter) => (
                  <option key={filter.id} value={filter.id} className="bg-[#111217] text-white">
                    {filter.label}
                  </option>
                ))}
              </select>
              <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-white/40" />
            </label>

            <button
              onClick={() => {
                void onSubmit();
              }}
              disabled={importing || !importSlug.trim()}
              className="inline-flex min-h-[44px] items-center justify-center gap-2 rounded-2xl bg-orange-500 px-5 py-3 text-xs font-bold uppercase tracking-[0.2em] text-white transition-all hover:bg-orange-600 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {importing || isSearching ? (
                <LoaderCircle className="h-4 w-4 animate-spin" />
              ) : (
                <Download className="h-4 w-4" />
              )}
              Go
            </button>
          </div>
        </div>

        <div className="min-h-[260px] w-full max-w-4xl">
          {searchResults.length > 0 ? (
            <div className="rounded-[24px] border border-white/6 bg-white/[0.04] p-3 text-left">
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
                      style={balancedBackgroundImage(result.posterUrl, "poster-thumb")}
                    />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-semibold text-white">{result.title}</div>
                      <div className="mt-1 flex flex-wrap items-center gap-2 text-[11px] uppercase tracking-[0.18em] text-white/35">
                        <span>{platformLabel(result.platform)}</span>
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
            <div className={clsx("text-center text-sm font-medium", importMessage.toLowerCase().includes("imported") ? "text-green-400" : "text-white/50")}>
               {importMessage}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
