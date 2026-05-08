import { Search, Settings2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { clsx } from "clsx";
import type { LocalRuntimeStatus } from "../lib/runtime-bridge";
import { getConnectionModeLabel } from "../lib/runtime-bridge";

type HeaderProps = {
  query: string;
  onQueryChange: (value: string) => void;
  mediaFilter: "all" | "movies" | "series";
  setMediaFilter: (value: "all" | "movies" | "series") => void;
  onOpenSettings: () => void;
  localRuntimeStatus: LocalRuntimeStatus;
  showMediaFilter?: boolean;
  searchPlaceholder?: string;
  searchWidth?: "default" | "compact";
};

export function Header({
  query,
  onQueryChange,
  mediaFilter,
  setMediaFilter,
  onOpenSettings,
  localRuntimeStatus,
  showMediaFilter = true,
  searchPlaceholder = "Search movies, series, shows...",
  searchWidth = "default",
}: HeaderProps) {
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsDropdownOpen(false);
      }
    }

    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const filterLabel = mediaFilter === "movies" ? "Movies" : mediaFilter === "series" ? "Series" : "All Content";

  return (
    <header className="sticky top-0 z-[50] flex flex-col gap-3 border-b border-white/[0.02] bg-[#0c0d12]/90 px-4 py-4 backdrop-blur-md lg:h-24 lg:flex-row lg:items-center lg:justify-between lg:px-10 lg:py-0">
      <div className="flex w-full flex-col gap-3 lg:w-auto lg:flex-row lg:items-center lg:gap-6">
        {showMediaFilter ? (
          <div className="relative" ref={dropdownRef}>
            <button
              onClick={() => setIsDropdownOpen((current) => !current)}
              className="flex h-10 w-full items-center justify-between rounded-lg bg-white/5 px-4 text-sm font-medium text-white/70 transition-colors hover:bg-white/10 hover:text-white lg:w-auto lg:justify-center"
            >
              {filterLabel} <span className="ml-2 text-[10px] opacity-50">▼</span>
            </button>

            {isDropdownOpen ? (
              <div className="animate-fade-in absolute left-0 top-12 z-50 w-40 rounded-xl border border-white/5 bg-[#131419] py-2 shadow-2xl">
                {(["all", "movies", "series"] as const).map((option) => (
                  <button
                    key={option}
                    onClick={() => {
                      setMediaFilter(option);
                      setIsDropdownOpen(false);
                    }}
                    className={clsx(
                      "w-full px-4 py-2 text-left text-sm font-medium capitalize transition-colors hover:bg-white/5",
                      mediaFilter === option ? "text-white" : "text-white/40",
                    )}
                  >
                    {option === "all" ? "All Content" : option}
                  </button>
                ))}
              </div>
            ) : null}
          </div>
        ) : null}

        <div
          data-tutorial="search-bar"
          className={clsx(
            "group flex h-10 w-full items-center gap-3 rounded-lg bg-white/5 px-4 transition-all focus-within:bg-white/10 focus-within:ring-1 focus-within:ring-white/20",
            searchWidth === "compact" ? "lg:w-[20rem]" : "lg:w-96",
          )}
        >
          <Search className="h-4 w-4 text-white/40 transition-colors group-focus-within:text-white/60" />
          <input
            value={query}
            onChange={(event) => onQueryChange(event.target.value)}
            placeholder={searchPlaceholder}
            className="flex-1 bg-transparent py-1 text-sm text-white placeholder-white/30 outline-none"
          />
        </div>
      </div>

      <div className="flex w-full items-center justify-between gap-4 lg:w-auto">
        <div className="flex h-10 min-w-0 items-center gap-3 rounded-full bg-white/5 px-4 shadow-inner">
          <div className="relative flex h-2 w-2">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-green-400 opacity-75"></span>
            <span className="relative inline-flex h-2 w-2 rounded-full bg-green-500"></span>
          </div>
          <span className="truncate text-[11px] font-bold uppercase tracking-widest text-white/40">
            {getConnectionModeLabel(localRuntimeStatus)}
          </span>
        </div>

        <button
          type="button"
          onClick={onOpenSettings}
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-white/5 text-white/60 transition-colors hover:bg-white/10 hover:text-white"
          aria-label="Open settings"
        >
          <Settings2 className="h-4 w-4" />
        </button>
      </div>
    </header>
  );
}
