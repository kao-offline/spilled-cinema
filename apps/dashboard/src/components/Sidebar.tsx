import { clsx } from "clsx";
import { Compass, CopyPlus, Download, Frame, Heart, Home, Settings } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { DownloadManagerPanel } from "./DownloadManagerPanel";
import type { PersistentDownloadJob } from "../lib/download-manager";
import type { ProviderFeedViewId } from "../lib/provider-modules-shared";

export type ViewState = "home" | "favorites" | "explore" | "downloaded" | "import" | "settings" | "support" | ProviderFeedViewId;

export type SidebarFeedLink = {
  id: ProviderFeedViewId;
  label: string;
};

type SidebarProps = {
  activeView: ViewState;
  onChangeView: (view: ViewState) => void;
  feedLinks: SidebarFeedLink[];
  downloadJobs: PersistentDownloadJob[];
  onCancelDownload: (episodeId: string) => void;
  onDismissDownload: (episodeId: string) => void;
};

export function Sidebar({ activeView, onChangeView, feedLinks, downloadJobs, onCancelDownload, onDismissDownload }: SidebarProps) {
  const primaryLinks: Array<{ id: ViewState; label: string; icon: LucideIcon }> = [
    { id: "home", label: "Home", icon: Home },
    { id: "favorites", label: "Favorites", icon: Heart },
    { id: "explore", label: "Explore", icon: Compass },
    { id: "downloaded", label: "Downloaded", icon: Download },
    { id: "import", label: "Import Tool", icon: CopyPlus },
  ];

  const secondaryLinks: Array<{ id: ViewState; label: string; icon: LucideIcon }> = [
    { id: "settings", label: "Settings", icon: Settings },
    { id: "support", label: "Support", icon: Frame },
  ];

  return (
    <aside className="fixed inset-x-0 bottom-0 z-[60] flex max-h-[calc(100dvh-4rem)] w-full flex-col border-t border-white/5 bg-[#0c0d12]/95 px-3 py-3 backdrop-blur-xl lg:inset-y-0 lg:left-0 lg:w-64 lg:border-r lg:border-t-0 lg:px-6 lg:py-8">
      {/* Brand */}
      <div className="flex items-center justify-between gap-3 px-1 pb-2 lg:px-2">
        <button className="flex items-center gap-3 transition-transform hover:scale-105" onClick={() => onChangeView("home")}>
          <img 
            src="/Spilled.svg" 
            alt="Spilled Logo" 
            className="h-8 w-auto brightness-0 invert opacity-95 lg:h-10" 
          />
        </button>
        <span className="rounded-full border border-white/10 px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.24em] text-white/35 lg:hidden">
          Vault
        </span>
      </div>

      <nav className="mt-2 flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto overflow-x-hidden pr-0 custom-scrollbar lg:mt-12 lg:gap-8 lg:pr-1">
        <ul className="no-scrollbar flex flex-row gap-2 overflow-x-auto pb-1 lg:flex-col lg:gap-1 lg:overflow-visible lg:pb-0">
          {primaryLinks.map((link) => {
            const isActive = activeView === link.id;
            return (
              <li key={link.id}>
                <button
                  data-tutorial={link.id === "favorites" ? "sidebar-favorites" : link.id === "downloaded" ? "sidebar-downloaded" : link.id === "import" ? "sidebar-import" : undefined}
                  onClick={() => onChangeView(link.id)}
                  className={clsx(
                    "flex min-w-[7.5rem] items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-all lg:w-full lg:min-w-0 lg:gap-4 lg:px-4 lg:py-3",
                    isActive
                      ? "bg-white/10 text-white"
                      : "text-white/40 hover:bg-white/5 hover:text-white/80"
                  )}
                >
                  <link.icon className={clsx("h-5 w-5 shrink-0", isActive ? "text-white" : "text-white/40")} />
                  <span className="whitespace-nowrap">{link.label}</span>
                </button>
              </li>
            );
          })}
        </ul>

        {feedLinks.length > 0 ? (
          <ul className="no-scrollbar flex flex-row gap-2 overflow-x-auto pb-1 lg:flex-col lg:gap-1 lg:overflow-visible lg:pb-0">
            <div className="mb-1 px-2 text-[10px] font-semibold uppercase tracking-wider text-white/20 lg:mb-2 lg:px-4 lg:text-xs">Feeds</div>
            {feedLinks.map((link) => {
              const isActive = activeView === link.id;
              return (
                <li key={link.id}>
                  <button
                    onClick={() => onChangeView(link.id)}
                    className={clsx(
                      "flex min-w-[9rem] items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-all lg:w-full lg:min-w-0 lg:gap-4 lg:px-4 lg:py-3",
                      isActive
                        ? "bg-white/10 text-white"
                        : "text-white/40 hover:bg-white/5 hover:text-white/80",
                    )}
                  >
                    <Compass className={clsx("h-5 w-5 shrink-0", isActive ? "text-white" : "text-white/40")} />
                    <span className="whitespace-nowrap">{link.label}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        ) : null}

        <ul className="no-scrollbar flex flex-row gap-2 overflow-x-auto pb-1 lg:flex-col lg:gap-1 lg:overflow-visible lg:pb-0">
          <div className="mb-1 px-2 text-[10px] font-semibold uppercase tracking-wider text-white/20 lg:mb-2 lg:px-4 lg:text-xs">System</div>
          {secondaryLinks.map((link) => {
             const isActive = activeView === link.id;
             return (
              <li key={link.id}>
                <button
                  onClick={() => onChangeView(link.id)}
                  className={clsx(
                    "flex min-w-[7.5rem] items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-all lg:w-full lg:min-w-0 lg:gap-4 lg:px-4 lg:py-3",
                    isActive
                      ? "bg-white/10 text-white"
                      : "text-white/40 hover:bg-white/5 hover:text-white/80"
                  )}
                >
                  <link.icon className={clsx("h-5 w-5 shrink-0", isActive ? "text-white" : "text-white/40")} />
                  <span className="whitespace-nowrap">{link.label}</span>
                </button>
              </li>
            );
          })}
        </ul>

        <div className="mt-1 lg:mt-auto">
          <DownloadManagerPanel items={downloadJobs} onCancel={onCancelDownload} onDismiss={onDismissDownload} />
        </div>
      </nav>
    </aside>
  );
}
