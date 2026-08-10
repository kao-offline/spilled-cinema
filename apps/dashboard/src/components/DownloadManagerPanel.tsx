import { AlertCircle, Check, Download, LoaderCircle, X } from "lucide-react";
import type { PersistentDownloadJob } from "../lib/download-manager";
import { formatEpisodeTitleParts } from "../lib/episode-title";

type DownloadManagerPanelProps = {
  items: PersistentDownloadJob[];
  onCancel: (episodeId: string) => void;
  onDismiss: (episodeId: string) => void;
};

export function DownloadManagerPanel({ items, onCancel, onDismiss }: DownloadManagerPanelProps) {
  if (items.length === 0) return null;
  const visibleItems = items.slice(0, 3);
  const activeCount = items.filter((item) => ["queued", "resolving", "downloading"].includes(item.state)).length;

  return <div className="mt-auto px-1 lg:px-0">
    <div className="overflow-hidden rounded-2xl border border-white/10 bg-[#151821]/95 shadow-[0_18px_50px_rgba(0,0,0,.4)] backdrop-blur-xl">
      <div className="flex items-center gap-2 border-b border-white/[.07] px-3 py-2.5"><span className="flex h-6 w-6 items-center justify-center rounded-lg bg-orange-300/15 text-orange-200"><Download className="h-3.5 w-3.5" /></span><span className="text-[11px] font-black uppercase tracking-[.18em] text-white/70">Downloads</span><span className="ml-auto rounded-full bg-white/10 px-2 py-1 text-[9px] font-bold text-white/45">{activeCount ? `${activeCount} active` : "Recent"}</span></div>
      <div className="grid gap-1.5 p-2">{visibleItems.map((item) => {
        const busy = item.state === "queued" || item.state === "resolving" || item.state === "downloading";
        const failed = item.state === "failed";
        const percent = Math.max(0, Math.min(item.percent, 100));
        const title = item.episodeTitle ? formatEpisodeTitleParts({ showTitle: item.showTitle, episodeTitle: item.episodeTitle, episodeCode: item.episodeCode, episodeNumber: item.episodeNumber }) : item.showTitle;
        return <div key={item.episodeId} className="rounded-xl bg-white/[.035] px-2.5 py-2"><div className="flex min-w-0 items-center gap-2"><span className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-lg ${failed ? "bg-red-400/15 text-red-200" : item.state === "completed" ? "bg-emerald-400/15 text-emerald-200" : "bg-white/10 text-white/65"}`}>{failed ? <AlertCircle className="h-3.5 w-3.5" /> : item.state === "completed" ? <Check className="h-3.5 w-3.5" /> : <LoaderCircle className={`h-3.5 w-3.5 ${busy ? "animate-spin" : ""}`} />}</span><div className="min-w-0 flex-1"><div className="truncate text-[11px] font-semibold text-white/85">{title}</div><div className="truncate text-[10px] text-white/40">{failed ? item.error ?? "Download failed" : item.message}</div></div><button onClick={() => busy ? onCancel(item.episodeId) : onDismiss(item.episodeId)} className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-white/35 hover:bg-white/10 hover:text-white" aria-label={busy ? "Cancel download" : "Dismiss download"}><X className="h-3 w-3" /></button></div>{busy ? <div className="mt-2 flex items-center gap-2"><div className="h-1 flex-1 overflow-hidden rounded-full bg-white/10"><div className="h-full rounded-full bg-gradient-to-r from-orange-300 to-cyan-300 transition-all" style={{ width: `${Math.max(4, percent)}%` }} /></div><span className="text-[9px] font-bold text-white/50">{percent}%</span></div> : null}</div>;
      })}</div>
    </div>
  </div>;
}
