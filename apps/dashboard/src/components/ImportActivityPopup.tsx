import { Check, Library, LoaderCircle, TriangleAlert } from "lucide-react";
import { clsx } from "clsx";
import { balanceImageResolution } from "../lib/image-resolution";

export type ImportActivity = {
  key: string;
  title: string;
  providerLabel: string;
  posterUrl?: string | null;
  status: "importing" | "added" | "already" | "busy" | "error";
  message?: string;
};

export function ImportActivityPopup({ activity }: { activity: ImportActivity | null }) {
  if (!activity) return null;
  const posterUrl = balanceImageResolution(activity.posterUrl, "poster-thumb");
  const good = activity.status === "added";
  const warning = activity.status === "already" || activity.status === "busy";

  return (
    <div className="pointer-events-none fixed inset-x-3 bottom-[max(6rem,env(safe-area-inset-bottom))] z-[230] flex justify-center sm:inset-x-auto sm:bottom-5 sm:right-5" role="status" aria-live="polite">
      <div className="flex w-full max-w-sm items-center gap-3 rounded-2xl border border-white/12 bg-[#0c0e13]/94 p-2.5 pr-4 text-white shadow-[0_24px_80px_rgba(0,0,0,.62)] backdrop-blur-2xl">
        <div className="relative h-14 w-11 shrink-0 overflow-hidden rounded-xl bg-white/8 ring-1 ring-white/10">
          {posterUrl ? <img src={posterUrl} alt="" className="h-full w-full object-cover" decoding="async" /> : <Library className="absolute left-1/2 top-1/2 h-5 w-5 -translate-x-1/2 -translate-y-1/2 text-white/32" />}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className={clsx("flex h-5 w-5 shrink-0 items-center justify-center rounded-full", good ? "bg-emerald-400/18 text-emerald-200" : warning ? "bg-amber-400/15 text-amber-100" : activity.status === "error" ? "bg-red-400/16 text-red-100" : "bg-white/10 text-white/78")}>
              {activity.status === "importing" ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" /> : good ? <Check className="h-3.5 w-3.5" /> : activity.status === "error" ? <TriangleAlert className="h-3.5 w-3.5" /> : <Library className="h-3.5 w-3.5" />}
            </span>
            <span className="text-[10px] font-black uppercase tracking-[0.18em] text-white/42">{activity.providerLabel}</span>
          </div>
          <div className="mt-1 truncate text-sm font-black text-white">{activity.title}</div>
          <div className="mt-0.5 truncate text-xs font-semibold text-white/48">
            {activity.message ?? (activity.status === "importing" ? "Adding to your vault…" : activity.status === "added" ? "Added to your vault" : activity.status === "already" ? "Already in your vault" : activity.status === "busy" ? "Another import is already running" : "Import failed")}
          </div>
        </div>
      </div>
    </div>
  );
}
