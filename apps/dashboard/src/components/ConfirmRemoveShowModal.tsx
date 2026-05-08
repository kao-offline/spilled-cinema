import { Trash2, X } from "lucide-react";
import type { ImportedShow } from "../lib/types";

type ConfirmRemoveShowModalProps = {
  show: ImportedShow | null;
  downloadedCount: number;
  onCancel: () => void;
  onConfirm: (show: ImportedShow) => void;
};

export function ConfirmRemoveShowModal({
  show,
  downloadedCount,
  onCancel,
  onConfirm,
}: ConfirmRemoveShowModalProps) {
  if (!show) {
    return null;
  }

  const hasDownloads = downloadedCount > 0;

  return (
    <div className="fixed inset-0 z-[130] flex items-center justify-center bg-black/80 px-4 sm:px-6 backdrop-blur-md">
      <div className="glass-nav relative w-full max-w-[560px] overflow-hidden rounded-[26px] border border-white/10 bg-[#101117]/95 p-7 text-white shadow-[0_40px_120px_rgba(0,0,0,0.65)]">
        <button
          onClick={onCancel}
          className="absolute right-4 top-4 flex h-10 w-10 items-center justify-center rounded-full bg-white/5 text-white/60 transition hover:bg-white/10 hover:text-white"
          aria-label="Close"
        >
          <X className="h-5 w-5" />
        </button>

        <div className="flex items-start gap-4">
          <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-red-500/15 text-red-200 ring-1 ring-red-400/20">
            <Trash2 className="h-6 w-6" />
          </div>
          <div>
            <div className="text-[10px] font-black uppercase tracking-[0.32em] text-white/40">
              Remove Show
            </div>
            <h2 className="mt-2 text-2xl font-bold text-white">Remove {show.title}?</h2>
            <p className="mt-2 text-sm text-white/60">
              This will remove the show from your library.
            </p>
            {hasDownloads ? (
              <p className="mt-2 text-sm text-red-200/80">
                {downloadedCount} downloaded episode{downloadedCount === 1 ? "" : "s"} will be erased as well.
              </p>
            ) : null}
          </div>
        </div>

        <div className="mt-7 flex items-center justify-end gap-3">
          <button
            onClick={onCancel}
            className="rounded-full border border-white/10 bg-white/5 px-5 py-2.5 text-sm font-bold text-white/70 shadow-[inset_0_0_0_1px_rgba(255,255,255,0.02)] transition hover:bg-white/10 hover:text-white"
          >
            Cancel
          </button>
          <button
            onClick={() => onConfirm(show)}
            className="rounded-full bg-red-500 px-5 py-2.5 text-sm font-bold text-white shadow-[0_12px_30px_rgba(239,68,68,0.3)] transition hover:bg-red-400"
          >
            Remove
          </button>
        </div>
      </div>
    </div>
  );
}
