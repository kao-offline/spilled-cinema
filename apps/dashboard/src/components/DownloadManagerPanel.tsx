import { LoaderCircle, X } from "lucide-react";
import type { PersistentDownloadJob } from "../lib/download-manager";
import { formatEpisodeTitleParts } from "../lib/episode-title";

type DownloadManagerPanelProps = {
  items: PersistentDownloadJob[];
  onCancel: (episodeId: string) => void;
  onDismiss: (episodeId: string) => void;
};

export function DownloadManagerPanel({ items, onCancel, onDismiss }: DownloadManagerPanelProps) {

  if (items.length === 0) {
    return null;
  }

  const item = items[0];
  const busy = item.state === "queued" || item.state === "resolving" || item.state === "downloading";
  const percent = Math.max(0, Math.min(item.percent, 100));
  const displayTitle = item.episodeTitle
    ? formatEpisodeTitleParts({
        showTitle: item.showTitle,
        episodeTitle: item.episodeTitle,
        episodeCode: item.episodeCode,
        episodeNumber: item.episodeNumber,
      })
    : item.showTitle;

  return (
    <div className="mt-auto px-1 lg:px-0">
      <div className="overflow-hidden rounded-xl border border-white/12 bg-[#151826]/80 px-2.5 py-2 shadow-[0_8px_18px_rgba(0,0,0,0.34)]">
        <div className="mb-1.5 flex min-w-0 items-center gap-2">
          <LoaderCircle className={busy ? "h-3.5 w-3.5 shrink-0 text-white/70 animate-spin" : "h-3.5 w-3.5 shrink-0 text-white/45"} />
          <div className="min-w-0">
            <div className="truncate text-[11px] font-semibold text-white/85">{displayTitle}</div>
            <div className="truncate text-[10px] text-white/45">{item.message}</div>
          </div>
          <button
            onClick={() => (busy ? onCancel(item.episodeId) : onDismiss(item.episodeId))}
            className="ml-auto inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-white/10 text-white/65 transition hover:bg-white/20 hover:text-white"
            title={busy ? "Cancel download" : "Dismiss"}
          >
            <X className="h-3 w-3" />
          </button>
        </div>

        <div className="flex items-center gap-2">
          <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-white/10">
            <div
              className="h-full rounded-full bg-gradient-to-r from-cyan-300 to-sky-400 transition-all duration-300"
              style={{ width: `${Math.max(4, percent)}%` }}
            />
          </div>
          <span className="text-[9px] font-semibold text-white/60">{busy ? percent : 100}%</span>
        </div>
      </div>
    </div>
  );
}
