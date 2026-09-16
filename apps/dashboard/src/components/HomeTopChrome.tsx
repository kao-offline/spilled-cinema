import { Library, Search, Settings, UserRound } from "lucide-react";
import { HomeSourceTabs } from "./HomeSourceTabs";

type HomeTopChromeProps = {
  onOpenSearch: () => void;
  onOpenLibrary: () => void;
  onOpenSettings: () => void;
  onOpenAccount: () => void;
  accountLabel?: string | null;
  activeTab?: "home" | "svetserialu" | "bombuj";
  onTabChange?: (tab: "home" | "svetserialu" | "bombuj") => void;
};

export function HomeTopChrome({ onOpenSearch, onOpenLibrary, onOpenSettings, onOpenAccount, accountLabel, activeTab = "home", onTabChange }: HomeTopChromeProps) {
  return (
    <header className="pointer-events-none fixed inset-x-0 top-0 z-50 flex h-20 items-center justify-center px-4 sm:h-24 sm:px-8">
      <HomeSourceTabs activeTab={activeTab} onTabChange={(tab) => onTabChange?.(tab)} className="pointer-events-auto absolute left-4 top-4 sm:left-8 sm:top-6" />

      <button type="button" onClick={onOpenLibrary} className="pointer-events-auto transition-transform hover:scale-105" aria-label="Open library">
        <img src="/Spilled.svg" alt="Spilled" className="h-9 w-auto brightness-0 invert sm:h-11" />
      </button>

      <div className="pointer-events-auto absolute right-4 top-4 flex items-center gap-2 sm:right-8 sm:top-6">
        <button
          type="button"
          onClick={onOpenSearch}
          data-tutorial="search-bar"
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
          onClick={onOpenAccount}
          className="flex h-10 items-center gap-2 rounded-xl bg-white/8 px-3 text-white shadow-[0_12px_30px_rgba(0,0,0,0.25)] ring-1 ring-white/10 backdrop-blur-md transition hover:bg-white/14"
          aria-label={accountLabel ? `Open account, signed in as ${accountLabel}` : "Open account and sign in"}
        >
          <UserRound className="h-4 w-4" />
          <span className="max-w-28 truncate text-xs font-bold">{accountLabel ?? "Sign in"}</span>
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
