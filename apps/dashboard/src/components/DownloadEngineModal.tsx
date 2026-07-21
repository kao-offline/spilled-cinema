import { Cpu, Download, ServerCog, X } from "lucide-react";
import { clsx } from "clsx";
import type { DownloadEngine, LibraryEpisode } from "../lib/types";

type DownloadEngineModalProps = {
  episode: LibraryEpisode | null;
  preferredEngine: DownloadEngine;
  localBackendAvailable: boolean;
  vaultConnected: boolean;
  privateNodeAvailable: boolean;
  onClose: () => void;
  onSelect: (engine: DownloadEngine, target: "local-vault" | "private-node") => void;
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
    label: "FFmpeg.wasm Fast",
    note: "Experimental browser path with parallel HLS fetching, retry, wake lock, and local muxing.",
    icon: Cpu,
  },
];

export function DownloadEngineModal({
  episode,
  preferredEngine,
  localBackendAvailable,
  vaultConnected,
  privateNodeAvailable,
  onClose,
  onSelect,
}: DownloadEngineModalProps) {
  if (!episode) {
    return null;
  }

  return (
    <div className="fixed inset-0 z-[141] flex items-center justify-center bg-black/82 px-3 py-6 backdrop-blur-2xl">
      <div className="relative max-h-[calc(100dvh-2rem)] w-full max-w-xl overflow-y-auto rounded-[1.5rem] border border-white/[0.1] bg-[#0b0c10]/96 shadow-[0_40px_120px_rgba(0,0,0,0.72)] custom-scrollbar">

        <button
          onClick={onClose}
          className="absolute right-4 top-4 z-10 flex h-10 w-10 items-center justify-center rounded-full border border-white/[0.08] bg-white/[0.04] text-white/45 transition hover:border-white/15 hover:bg-white/[0.09] hover:text-white"
          aria-label="Close engine chooser"
        >
          <X className="h-5 w-5" />
        </button>

        <div className="p-5 sm:p-7">
          <div className="mb-5 border-b border-white/[0.07] pb-5 pr-12">
            <div className="text-[10px] font-black uppercase tracking-[0.3em] text-white/30">
              Download method
            </div>
            <h3 className="mt-2 text-2xl font-black tracking-[-0.03em] text-white">
              {episode.showTitle}
            </h3>
            <p className="mt-1.5 text-sm leading-6 text-white/42">
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
                  onClick={() => onSelect(engine.id, "local-vault")}
                  className={clsx(
                    "group flex w-full items-center justify-between gap-3 rounded-2xl border p-3.5 text-left transition",
                    disabled
                      ? "cursor-not-allowed border-white/8 bg-white/[0.03] text-white/25"
                      : selected
                        ? "border-white/22 bg-white/[0.085] hover:border-white/32"
                        : "border-white/[0.07] bg-white/[0.025] hover:border-white/16 hover:bg-white/[0.065]",
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
                          <span className="rounded-full border border-white/10 bg-white/[0.07] px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.16em] text-white/62">
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
                        : "bg-white text-black group-hover:bg-white/85",
                    )}
                  >
                    {disabled ? "Unavailable" : "Use"}
                  </div>
                </button>
              );
            })}
            <button
              type="button"
              disabled={!privateNodeAvailable}
              onClick={() => onSelect("localffmpeg", "private-node")}
              className={clsx(
                "group flex w-full items-center justify-between gap-3 rounded-2xl border p-3.5 text-left transition",
                privateNodeAvailable
                  ? "border-white/14 bg-white/[0.045] hover:border-white/24 hover:bg-white/[0.075]"
                  : "cursor-not-allowed border-white/8 bg-white/[0.03] text-white/25",
              )}
            >
              <div className="flex min-w-0 flex-1 items-center gap-3">
                <span className={clsx("flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl", privateNodeAvailable ? "bg-white/[0.07] text-white/72" : "bg-white/5 text-white/25")}>
                  <ServerCog className="h-5 w-5" />
                </span>
                <div className="min-w-0 space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-semibold text-white">Private node</span>
                    <span className="rounded-full border border-white/10 bg-white/[0.05] px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.16em] text-white/55">
                      Server storage
                    </span>
                    {!privateNodeAvailable ? (
                      <span className="rounded-full bg-red-500/15 px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.18em] text-red-200">
                        Sign in first
                      </span>
                    ) : null}
                  </div>
                  <div className="text-xs text-white/35">Downloads on your private server and links the record to the selected watcher profile.</div>
                </div>
              </div>
              <div className={clsx("rounded-full px-4 py-2 text-[10px] font-black uppercase tracking-[0.28em]", privateNodeAvailable ? "bg-white text-black" : "bg-white/6 text-white/30")}>
                {privateNodeAvailable ? "Use" : "Unavailable"}
              </div>
            </button>
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
