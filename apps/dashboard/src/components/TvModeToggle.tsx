import { Tv } from "lucide-react";

type TvModeToggleProps = {
  enabled: boolean;
  onChange: (enabled: boolean) => void;
};

export function TvModeToggle({ enabled, onChange }: TvModeToggleProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={enabled}
      onClick={() => onChange(!enabled)}
      className="group flex min-h-12 flex-1 items-center gap-3 rounded-2xl border border-white/8 bg-white/[.035] px-3 text-left text-white transition hover:border-white/15 hover:bg-white/[.07] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/50"
    >
      <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-white/[0.07] text-white/62 transition group-hover:text-white">
        <Tv className="h-4 w-4" aria-hidden="true" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-[10px] font-black uppercase tracking-[0.18em] text-white/88">TV mode</span>
        <span className="block text-[9px] font-semibold text-white/36">10-foot display</span>
      </span>
      <span className={`relative h-6 w-11 shrink-0 rounded-full border transition ${enabled ? "border-white bg-white" : "border-white/14 bg-white/8"}`} aria-hidden="true">
        <span className={`absolute top-1/2 h-4 w-4 -translate-y-1/2 rounded-full transition-transform ${enabled ? "translate-x-[1.35rem] bg-black" : "translate-x-1 bg-white/52"}`} />
      </span>
    </button>
  );
}
