import { Tv } from "lucide-react";

type TvModeToggleProps = {
  enabled: boolean;
  onChange: (enabled: boolean) => void;
};

export function TvModeToggle({ enabled, onChange }: TvModeToggleProps) {
  return (
    <footer className="fixed bottom-5 right-5 z-[80] hidden lg:block" aria-label="Display mode">
      <button
        type="button"
        role="switch"
        aria-checked={enabled}
        onClick={() => onChange(!enabled)}
        className="group flex items-center gap-3 rounded-full border border-white/10 bg-[#0b0d12]/82 px-3 py-2 text-left text-white shadow-[0_16px_48px_rgba(0,0,0,.38)] backdrop-blur-xl transition hover:border-white/20 hover:bg-[#11141b]/92 focus-visible:outline-none"
      >
        <span className="flex h-8 w-8 items-center justify-center rounded-full bg-white/[0.07] text-white/62 transition group-hover:text-white">
          <Tv className="h-4 w-4" aria-hidden="true" />
        </span>
        <span>
          <span className="block text-[10px] font-black uppercase tracking-[0.18em] text-white/88">TV mode</span>
          <span className="block text-[9px] font-semibold text-white/36">10-foot display</span>
        </span>
        <span className={`relative ml-1 h-6 w-11 rounded-full border transition ${enabled ? "border-white bg-white" : "border-white/14 bg-white/8"}`} aria-hidden="true">
          <span className={`absolute top-1/2 h-4 w-4 -translate-y-1/2 rounded-full transition-transform ${enabled ? "translate-x-[1.35rem] bg-black" : "translate-x-1 bg-white/52"}`} />
        </span>
      </button>
    </footer>
  );
}
