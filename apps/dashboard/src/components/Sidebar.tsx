import { clsx } from "clsx";
import { Compass, CopyPlus, Download, Frame, Heart, Home, Settings } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { DownloadManagerPanel } from "./DownloadManagerPanel";
import type { PersistentDownloadJob } from "../lib/download-manager";
import type { ProviderFeedViewId } from "../lib/provider-modules-shared";
import { MobileDock } from "./MobileDock";

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
  onOpenHomepage: () => void;
};

export function Sidebar({ activeView, onChangeView, feedLinks, downloadJobs, onCancelDownload, onDismissDownload, onOpenHomepage }: SidebarProps) {
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
    <>
      <MobileDock
        active={activeView === "favorites" ? "favorites" : activeView === "explore" ? "explore" : "library"}
        onHome={onOpenHomepage}
        onLibrary={() => onChangeView("home")}
        onFavorites={() => onChangeView("favorites")}
        onExplore={() => onChangeView("explore")}
      />
    <aside className="fixed inset-y-0 left-0 z-[60] hidden h-screen w-64 flex-col border-r border-white/[0.08] bg-[#05060a]/94 px-5 py-6 backdrop-blur-2xl lg:flex">
      {/* Brand */}
      <div className="hidden items-center justify-between gap-3 px-2 pb-2 lg:flex">
        <button className="flex items-center gap-3 opacity-95 transition-opacity hover:opacity-100" onClick={() => onChangeView("home")}>
          <img 
            src="/Spilled.svg" 
            alt="Spilled Logo" 
            className="h-9 w-auto brightness-0 invert"
          />
        </button>
      </div>

      <nav className="flex min-h-0 flex-1 gap-2 overflow-x-auto overflow-y-hidden lg:mt-10 lg:flex-col lg:gap-7 lg:overflow-y-auto lg:overflow-x-hidden lg:pr-1">
        <ul className="no-scrollbar flex flex-row gap-2 overflow-x-auto pb-1 lg:flex-col lg:gap-1 lg:overflow-visible lg:pb-0">
          {primaryLinks.map((link) => {
            const isActive = activeView === link.id;
            return (
              <li key={link.id}>
                <button
                  data-tutorial={link.id === "favorites" ? "sidebar-favorites" : link.id === "downloaded" ? "sidebar-downloaded" : link.id === "import" ? "sidebar-import" : undefined}
                  onClick={() => onChangeView(link.id)}
                  className={clsx(
                    "flex min-w-[7rem] items-center justify-center gap-2.5 rounded-full border px-3 py-2.5 text-sm font-semibold transition lg:w-full lg:min-w-0 lg:justify-start lg:rounded-xl lg:px-3.5 lg:py-3",
                    isActive
                      ? "border-white bg-white text-black shadow-[0_8px_28px_rgba(255,255,255,0.08)]"
                      : "border-transparent text-white/42 hover:border-white/[0.07] hover:bg-white/[0.045] hover:text-white/82"
                  )}
                >
                  <link.icon className={clsx("h-[18px] w-[18px] shrink-0", isActive ? "text-black" : "text-white/38")} />
                  <span className="whitespace-nowrap">{link.label}</span>
                </button>
              </li>
            );
          })}
        </ul>

        {feedLinks.length > 0 ? (
          <ul className="no-scrollbar flex flex-row gap-2 overflow-x-auto pb-1 lg:flex-col lg:gap-1 lg:overflow-visible lg:pb-0">
            <div className="hidden px-3 text-[10px] font-black uppercase tracking-[0.24em] text-white/24 lg:mb-2 lg:block">Feeds</div>
            {feedLinks.map((link) => {
              const isActive = activeView === link.id;
              return (
                <li key={link.id}>
                  <button
                    onClick={() => onChangeView(link.id)}
                    className={clsx(
                      "flex min-w-[8rem] items-center justify-center gap-2.5 rounded-full border px-3 py-2.5 text-sm font-semibold transition lg:w-full lg:min-w-0 lg:justify-start lg:rounded-xl lg:px-3.5 lg:py-3",
                      isActive
                        ? "border-white bg-white text-black"
                        : "border-transparent text-white/42 hover:border-white/[0.07] hover:bg-white/[0.045] hover:text-white/82",
                    )}
                  >
                    <Compass className={clsx("h-[18px] w-[18px] shrink-0", isActive ? "text-black" : "text-white/38")} />
                    <span className="whitespace-nowrap">{link.label}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        ) : null}

        <ul className="no-scrollbar flex flex-row gap-2 overflow-x-auto pb-1 lg:flex-col lg:gap-1 lg:overflow-visible lg:pb-0">
          <div className="hidden px-3 text-[10px] font-black uppercase tracking-[0.24em] text-white/24 lg:mb-2 lg:block">System</div>
          {secondaryLinks.map((link) => {
             const isActive = activeView === link.id;
             return (
              <li key={link.id}>
                <button
                  onClick={() => onChangeView(link.id)}
                  className={clsx(
                    "flex min-w-[7rem] items-center justify-center gap-2.5 rounded-full border px-3 py-2.5 text-sm font-semibold transition lg:w-full lg:min-w-0 lg:justify-start lg:rounded-xl lg:px-3.5 lg:py-3",
                    isActive
                      ? "border-white bg-white text-black"
                      : "border-transparent text-white/42 hover:border-white/[0.07] hover:bg-white/[0.045] hover:text-white/82"
                  )}
                >
                  <link.icon className={clsx("h-[18px] w-[18px] shrink-0", isActive ? "text-black" : "text-white/38")} />
                  <span className="whitespace-nowrap">{link.label}</span>
                </button>
              </li>
            );
          })}
        </ul>

        <div className="hidden lg:mt-auto lg:block">
          <DownloadManagerPanel items={downloadJobs} onCancel={onCancelDownload} onDismiss={onDismissDownload} />
        </div>
      </nav>
    </aside>
    </>
  );
}
