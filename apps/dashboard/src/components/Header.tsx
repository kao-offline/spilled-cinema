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
    <header className="sticky top-0 z-[50] flex flex-col gap-3 bg-[#090a0e]/94 px-4 pb-3 pt-[max(1rem,env(safe-area-inset-top))] backdrop-blur-2xl lg:h-20 lg:flex-row lg:items-center lg:justify-between lg:border-b lg:border-white/[0.07] lg:bg-[#05060a]/88 lg:px-10 lg:py-0">
      <img src="/Spilled.svg" alt="Spilled" className="mx-auto h-9 w-auto brightness-0 invert lg:hidden" />
      <div className="flex w-full flex-col gap-3 pr-[4.15rem] lg:w-auto lg:flex-row lg:items-center lg:gap-6 lg:pr-0">
        {showMediaFilter ? (
          <div className="relative hidden lg:block" ref={dropdownRef}>
            <button
              onClick={() => setIsDropdownOpen((current) => !current)}
              className="flex h-10 w-full items-center justify-between rounded-full border border-white/[0.08] bg-white/[0.045] px-4 text-sm font-semibold text-white/68 transition hover:border-white/15 hover:bg-white/[0.08] hover:text-white lg:w-auto lg:justify-center"
            >
              {filterLabel} <span className="ml-2 text-[10px] opacity-50">▼</span>
            </button>

            {isDropdownOpen ? (
              <div className="animate-fade-in absolute left-0 top-12 z-50 w-44 rounded-2xl border border-white/10 bg-[#0b0c10]/96 p-1.5 shadow-[0_24px_70px_rgba(0,0,0,0.58)] backdrop-blur-2xl">
                {(["all", "movies", "series"] as const).map((option) => (
                  <button
                    key={option}
                    onClick={() => {
                      setMediaFilter(option);
                      setIsDropdownOpen(false);
                    }}
                    className={clsx(
                      "w-full rounded-xl px-3 py-2.5 text-left text-sm font-semibold capitalize transition-colors hover:bg-white/[0.07]",
                      mediaFilter === option ? "bg-white text-black" : "text-white/48",
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
            "group flex h-14 w-full items-center gap-3 rounded-[18px] border border-transparent bg-[#24262c] px-4 transition focus-within:border-white/15 lg:h-10 lg:rounded-full lg:border-white/[0.08] lg:bg-white/[0.045]",
            searchWidth === "compact" ? "lg:w-[20rem]" : "lg:w-96",
          )}
        >
          <Search className="h-4 w-4 text-white/40 transition-colors group-focus-within:text-white/60" />
          <input
            value={query}
            onChange={(event) => onQueryChange(event.target.value)}
            placeholder={searchPlaceholder}
            className="flex-1 bg-transparent py-1 text-base text-white placeholder-white/30 outline-none lg:text-sm"
          />
        </div>
      </div>

      <button type="button" onClick={onOpenSettings} className="absolute bottom-3 right-4 flex h-14 w-14 items-center justify-center rounded-[18px] bg-[#24262c] text-white lg:hidden" aria-label="Open settings">
        <Settings2 className="h-6 w-6" />
      </button>

      <div className="hidden w-full items-center justify-between gap-4 lg:flex lg:w-auto">
        <div className="flex h-10 min-w-0 items-center gap-3 rounded-full border border-white/[0.07] bg-white/[0.035] px-4">
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
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-white/[0.08] bg-white/[0.045] text-white/60 transition hover:border-white/15 hover:bg-white/[0.09] hover:text-white"
          aria-label="Open settings"
        >
          <Settings2 className="h-4 w-4" />
        </button>
      </div>
    </header>
  );
}
