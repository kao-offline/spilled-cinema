import { clsx } from "clsx";
import { HOMEPAGE_SOURCE_TABS, type HomepageTab } from "../lib/provider-home-preferences";

const SOURCE_LOGOS: Record<HomepageTab, string> = {
  home: "/design/source-spilled.svg",
  svetserialu: "/design/source-svetserialu.svg",
  bombuj: "/design/source-bombuj.svg",
};

type HomeSourceTabsProps = {
  activeTab: HomepageTab;
  onTabChange: (tab: HomepageTab) => void;
  compact?: boolean;
  className?: string;
};

export function HomeSourceTabs({ activeTab, onTabChange, compact = false, className }: HomeSourceTabsProps) {
  return (
    <nav
      data-tutorial="homepage-feed-tabs"
      className={clsx("source-logo-nav flex rounded-full border border-white/10 bg-black/45 p-1 shadow-xl backdrop-blur-xl", className)}
      aria-label="Homepage sources"
    >
      {HOMEPAGE_SOURCE_TABS.map((source) => {
        const active = activeTab === source.id;
        return (
          <button
            key={source.id}
            type="button"
            onClick={() => onTabChange(source.id)}
            className={clsx(
              "inline-flex min-w-0 items-center justify-center gap-1.5 rounded-full font-black uppercase tracking-[.13em] transition",
              compact ? "flex-1 px-2.5 py-2 text-[9px]" : "px-3.5 py-2 text-[10px] sm:px-4",
              active ? "bg-white/20 text-white shadow-[0_8px_24px_rgba(0,0,0,.3)]" : "text-white/50 hover:bg-white/6 hover:text-white",
            )}
            aria-label={source.label}
            title={source.label}
            aria-current={active ? "page" : undefined}
          >
            <img src={SOURCE_LOGOS[source.id]} alt="" className="h-6 w-7 object-contain" />
          </button>
        );
      })}
    </nav>
  );
}
