import { Cpu, Download, ServerCog, X } from "lucide-react";
import { clsx } from "clsx";
import type { DownloadEngine, LibraryEpisode } from "../lib/types";

type DownloadEngineModalProps = {
  episode: LibraryEpisode | null;
  preferredEngine: DownloadEngine;
  localBackendAvailable: boolean;
  vaultConnected: boolean;
  onClose: () => void;
  onSelect: (engine: DownloadEngine) => void;
};

const ENGINES: Array<{
  id: DownloadEngine;
  label: string;
  note: string;
  icon: typeof ServerCog;
}> = [
  {
    id: "localffmpeg",
    label: "Local FFmpeg",
    note: "Downloads through the Node runtime and stores managed files in the app library.",
    icon: ServerCog,
  },
  {
    id: "wasm",
    label: "FFmpeg.wasm",
    note: "Downloads and muxes in the browser, then saves the final MP4 through the browser download flow.",
    icon: Cpu,
  },
];

export function DownloadEngineModal({
  episode,
  preferredEngine,
  localBackendAvailable,
  vaultConnected,
  onClose,
  onSelect,
}: DownloadEngineModalProps) {
  if (!episode) {
    return null;
  }

  return (
    <div className="fixed inset-0 z-[141] flex items-center justify-center bg-black/80 px-3 py-6 backdrop-blur-xl">
      <div className="relative w-full max-w-2xl overflow-hidden rounded-[28px] border border-white/10 bg-[#101218]/95 shadow-[0_40px_120px_rgba(0,0,0,0.65)]">
        <div className="absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-orange-400 via-cyan-400 to-emerald-400" />

        <button
          onClick={onClose}
          className="absolute right-4 top-4 z-10 flex h-11 w-11 items-center justify-center rounded-full bg-white/5 text-white/50 transition hover:bg-white/10 hover:text-white"
          aria-label="Close engine chooser"
        >
          <X className="h-5 w-5" />
        </button>

        <div className="p-6 sm:p-8">
          <div className="mb-6 space-y-2">
            <div className="text-[10px] font-black uppercase tracking-[0.45em] text-white/30">
              Choose download engine
            </div>
            <h3 className="text-2xl font-bold tracking-tight text-white sm:text-3xl">
              {episode.showTitle}
            </h3>
            <p className="text-sm text-white/45">
              Select how this video should be downloaded.
            </p>
          </div>

          <div className="grid gap-3">
            {ENGINES.map((engine) => {
              const selected = preferredEngine === engine.id;
              const disabled =
                !vaultConnected ||
                (engine.id === "localffmpeg" && !localBackendAvailable);
              const Icon = engine.icon;

              return (
                <button
                  key={engine.id}
                  type="button"
                  disabled={disabled}
                  onClick={() => onSelect(engine.id)}
                  className={clsx(
                    "group flex w-full items-center justify-between gap-4 rounded-[20px] border p-4 text-left transition",
                    disabled
                      ? "cursor-not-allowed border-white/8 bg-white/[0.03] text-white/25"
                      : selected
                        ? "border-orange-400/40 bg-orange-500/10 hover:border-orange-300/60"
                        : "border-white/10 bg-white/5 hover:border-white/20 hover:bg-white/10",
                  )}
                >
                  <div className="flex min-w-0 flex-1 items-center gap-3">
                    <span
                      className={clsx(
                        "flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl shadow-[inset_0_0_0_1px_rgba(255,255,255,0.04)]",
                        disabled ? "bg-white/5 text-white/25" : "bg-white/10 text-white/80",
                      )}
                    >
                      <Icon className="h-5 w-5" />
                    </span>

                    <div className="min-w-0 space-y-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-sm font-semibold text-white">{engine.label}</span>
                        {selected ? (
                          <span className="rounded-full bg-orange-400/15 px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.18em] text-orange-200">
                            Preferred
                          </span>
                        ) : null}
                        {disabled ? (
                          <span className="rounded-full bg-red-500/15 px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.18em] text-red-200">
                            {!vaultConnected ? "Vault required" : "Backend offline"}
                          </span>
                        ) : null}
                      </div>
                      <div className="text-xs text-white/35">{engine.note}</div>
                    </div>
                  </div>

                  <div
                    className={clsx(
                      "rounded-full px-4 py-2 text-[10px] font-black uppercase tracking-[0.28em] transition",
                      disabled
                        ? "bg-white/6 text-white/30"
                        : "bg-white text-black shadow-[0_8px_24px_rgba(255,255,255,0.25)] group-hover:bg-cyan-300",
                    )}
                  >
                    {disabled ? "Unavailable" : "Use"}
                  </div>
                </button>
              );
            })}
          </div>

          <div className="mt-6 flex items-center justify-between text-[11px] uppercase tracking-[0.25em] text-white/25">
            <span className="inline-flex items-center gap-2">
              <Download className="h-3.5 w-3.5" />
              Episode {episode.episodeCode ?? episode.episodeNumber ?? "?"}
            </span>
            <button onClick={onClose} className="text-white/40 transition hover:text-white">
              Cancel
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
