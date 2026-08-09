import { Download, Library, X } from "lucide-react";
import { balanceImageResolution } from "../lib/image-resolution";

type RemoteImportPreviewProps = {
  title: string;
  providerLabel: string;
  mediaType?: "movie" | "serial";
  year?: string | null;
  posterUrl?: string | null;
  busy: boolean;
  alreadyImported: boolean;
  onClose: () => void;
  onImport: () => void;
};

export function RemoteImportPreview({ title, providerLabel, mediaType, year, posterUrl, busy, alreadyImported, onClose, onImport }: RemoteImportPreviewProps) {
  const artwork = balanceImageResolution(posterUrl, "poster-card");
  return (
    <div className="fixed inset-0 z-[210] flex items-center justify-center bg-black/62 px-4 py-8 backdrop-blur-sm" role="dialog" aria-modal="true" aria-label={`Import ${title}`} onMouseDown={onClose}>
      <div className="relative flex w-full max-w-md gap-4 overflow-hidden rounded-[24px] border border-white/12 bg-[#0d1016]/96 p-3 shadow-[0_32px_110px_rgba(0,0,0,.72)]" onMouseDown={(event) => event.stopPropagation()}>
        <div className="aspect-[2/3] w-28 shrink-0 overflow-hidden rounded-[16px] bg-white/8 ring-1 ring-white/10">
          {artwork ? <img src={artwork} alt="" className="h-full w-full object-cover" decoding="async" /> : null}
        </div>
        <div className="flex min-w-0 flex-1 flex-col py-2 pr-1">
          <button type="button" onClick={onClose} className="absolute right-3 top-3 flex h-8 w-8 items-center justify-center rounded-full bg-white/8 text-white/54 transition hover:bg-white/14 hover:text-white" aria-label="Close import preview"><X className="h-4 w-4" /></button>
          <div className="pr-8 text-[10px] font-black uppercase tracking-[0.2em] text-white/36">{providerLabel}</div>
          <h3 className="mt-2 line-clamp-2 text-xl font-black leading-tight text-white">{title}</h3>
          <div className="mt-2 text-xs font-semibold text-white/42">{[mediaType === "movie" ? "Movie" : mediaType === "serial" ? "Series" : null, year].filter(Boolean).join(" · ")}</div>
          <button type="button" onClick={onImport} disabled={busy || alreadyImported} className="mt-auto inline-flex h-11 items-center justify-center gap-2 rounded-full bg-white px-4 text-sm font-black text-black transition hover:bg-white/88 disabled:cursor-not-allowed disabled:bg-white/10 disabled:text-white/45">
            {alreadyImported ? <><Library className="h-4 w-4" /> In vault</> : <><Download className="h-4 w-4" /> {busy ? "Importing…" : "Import"}</>}
          </button>
        </div>
      </div>
    </div>
  );
}
