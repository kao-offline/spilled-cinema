import { Library, Search, Settings } from "lucide-react";

type HomeTopChromeProps = {
  onOpenSearch: () => void;
  onOpenLibrary: () => void;
  onOpenSettings: () => void;
  activeTab?: "home" | "svetserialu" | "bombuj";
  onTabChange?: (tab: "home" | "svetserialu" | "bombuj") => void;
};

export function HomeTopChrome({ onOpenSearch, onOpenLibrary, onOpenSettings, activeTab = "home", onTabChange }: HomeTopChromeProps) {
  return (
    <header className="pointer-events-none fixed inset-x-0 top-0 z-50 flex h-20 items-center justify-center px-4 sm:h-24 sm:px-8">
      <nav className="pointer-events-auto absolute left-4 top-4 flex rounded-full border border-white/10 bg-black/38 p-1 shadow-xl backdrop-blur-xl sm:left-8 sm:top-6" aria-label="Homepage sources">
        {(["home", "svetserialu", "bombuj"] as const).map((tab) => (
          <button key={tab} type="button" onClick={() => onTabChange?.(tab)} className={`rounded-full px-3.5 py-2 text-[10px] font-black uppercase tracking-[.15em] transition sm:px-4 ${activeTab === tab ? "bg-white text-black" : "text-white/48 hover:text-white"}`}>
            {tab === "home" ? "Home" : tab === "svetserialu" ? "SvetSerialu" : "Bombuj"}
          </button>
        ))}
      </nav>

      <button type="button" onClick={onOpenLibrary} className="pointer-events-auto transition-transform hover:scale-105" aria-label="Open library">
        <img src="/Spilled.svg" alt="Spilled" className="h-9 w-auto brightness-0 invert sm:h-11" />
      </button>

      <div className="pointer-events-auto absolute right-4 top-4 flex items-center gap-2 sm:right-8 sm:top-6">
        <button
          type="button"
          onClick={onOpenSearch}
          className="group flex h-10 items-center gap-2.5 rounded-full border border-white/[0.08] bg-white/[0.045] px-4 text-white shadow-[0_12px_30px_rgba(0,0,0,0.25)] backdrop-blur-md transition hover:border-white/15 hover:bg-white/[0.08]"
          aria-label="Open search"
        >
          <Search className="h-4 w-4 text-white/40 transition-colors group-hover:text-white/60" />
          <span className="hidden text-sm text-white/32 transition-colors group-hover:text-white/50 sm:inline">Search…</span>
          <span className="hidden items-center gap-1 pl-1 sm:flex">
            <img src="/cmd-icon.svg" alt="" className="h-5 w-5 brightness-0 invert opacity-40" />
            <img src="/k-icon.svg" alt="" className="h-5 w-5 brightness-0 invert opacity-40" />
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
