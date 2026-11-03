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
  return <header className="cinema-header">
    <HomeSourceTabs activeTab={activeTab} onTabChange={(tab) => onTabChange?.(tab)} />
    <button type="button" className="cinema-brand" onClick={onOpenLibrary} aria-label="Open library"><img src="/Spilled.svg" alt="Spilled" /></button>
    <div className="cinema-header-actions">
      <button type="button" className="cinema-glass cinema-search-trigger" onClick={onOpenSearch} data-tutorial="search-bar" aria-label="Open search"><Search size={16} /><span>Search…</span><kbd><img src="/cmd-icon.svg" alt="Command" /><img src="/k-icon.svg" alt="K" /></kbd></button>
      <button type="button" className="cinema-glass cinema-account" onClick={onOpenAccount} aria-label={accountLabel ? `Open account, signed in as ${accountLabel}` : "Open account and sign in"}><UserRound size={16} /><span>{accountLabel ?? "Sign in"}</span></button>
      <button type="button" className="cinema-glass cinema-icon" onClick={onOpenLibrary} aria-label="Open library"><Library size={20} /></button>
      <button type="button" className="cinema-glass cinema-icon" onClick={onOpenSettings} aria-label="Open settings"><Settings size={20} /></button>
    </div>
  </header>;
}
