import { Library, Search, Settings } from "lucide-react";

type HomeTopChromeProps = {
  onOpenSearch: () => void;
  onOpenLibrary: () => void;
  onOpenSettings: () => void;
};

export function HomeTopChrome({ onOpenSearch, onOpenLibrary, onOpenSettings }: HomeTopChromeProps) {
  return (
    <header className="pointer-events-none fixed inset-x-0 top-0 z-50 flex h-20 items-center justify-center px-4 sm:h-24 sm:px-8">
      <button type="button" onClick={onOpenLibrary} className="pointer-events-auto transition-transform hover:scale-105" aria-label="Open library">
        <img src="/Spilled.svg" alt="Spilled" className="h-9 w-auto brightness-0 invert sm:h-11" />
      </button>

      <div className="pointer-events-auto absolute right-4 top-4 flex items-center gap-2 sm:right-8 sm:top-6">
        <button
          type="button"
          onClick={onOpenSearch}
          className="flex h-10 items-center gap-1.5 rounded-xl bg-white/8 px-2.5 text-white shadow-[0_12px_30px_rgba(0,0,0,0.25)] ring-1 ring-white/10 backdrop-blur-md transition hover:bg-white/14"
          aria-label="Open search"
        >
          <Search className="h-4 w-4" />
          <span className="hidden items-center gap-1 sm:flex">
            <img src="/cmd-icon.svg" alt="" className="h-5 w-5 brightness-0 invert" />
            <img src="/k-icon.svg" alt="" className="h-5 w-5 brightness-0 invert" />
          </span>
        </button>

        <button
          type="button"
          onClick={onOpenLibrary}
          className="flex h-10 w-10 items-center justify-center rounded-xl bg-white/8 text-white shadow-[0_12px_30px_rgba(0,0,0,0.25)] ring-1 ring-white/10 backdrop-blur-md transition hover:bg-white/14"
          aria-label="Open library"
        >
          <Library className="h-5 w-5" />
        </button>

        <button
          type="button"
          onClick={onOpenSettings}
          className="flex h-10 w-10 items-center justify-center rounded-xl bg-white/8 text-white shadow-[0_12px_30px_rgba(0,0,0,0.25)] ring-1 ring-white/10 backdrop-blur-md transition hover:bg-white/14"
          aria-label="Open settings"
        >
          <Settings className="h-5 w-5" />
        </button>
      </div>
    </header>
  );
}
