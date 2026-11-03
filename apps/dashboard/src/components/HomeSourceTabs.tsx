import { clsx } from "clsx";
import type { CSSProperties } from "react";
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
      className={clsx("source-logo-nav", compact && "source-logo-nav-compact", className)}
      aria-label="Homepage sources"
      style={{ "--source-index": HOMEPAGE_SOURCE_TABS.findIndex((source) => source.id === activeTab) } as CSSProperties}
    >
      <span className="source-tab-indicator" aria-hidden="true" />
      {HOMEPAGE_SOURCE_TABS.map((source) => {
        const active = activeTab === source.id;
        return (
          <button
            key={source.id}
            type="button"
            onClick={() => onTabChange(source.id)}
            className={active ? "is-active" : undefined}
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
