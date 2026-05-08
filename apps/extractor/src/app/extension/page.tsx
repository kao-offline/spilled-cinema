import Link from "next/link";
import { Zap, Puzzle, LayoutGrid, Globe, Box, Terminal } from "lucide-react";

export default function ExtensionPage() {
  return (
    <div className="max-w-5xl mx-auto pb-20">
      <section className="glass-panel relative overflow-hidden rounded-[48px] border-white/5 p-12 sm:p-16 shadow-[0_0_80px_rgba(0,242,255,0.05)]">
        <div className="absolute top-0 right-0 h-64 w-64 -translate-y-1/2 translate-x-1/2 rounded-full bg-[#00f2ff]/5 blur-[80px]" />
        
        <div className="relative z-10 space-y-12">
          <div className="space-y-6">
            <div className="inline-flex items-center gap-3 rounded-full border border-[#00f2ff]/20 bg-[#00f2ff]/5 px-5 py-2.5 text-[11px] font-black uppercase tracking-[0.3em] text-[#00f2ff]">
              <Puzzle className="h-4 w-4" />
              Runtime Extension
            </div>
            <h1 className="text-gradient text-5xl font-black tracking-tight leading-[1.1] sm:text-6xl max-w-2xl">
              High-Fidelity DOM Inspection.
            </h1>
            <p className="max-w-3xl text-xl leading-relaxed text-muted">
              The SpilledCinema extension provides the most robust isolation layer, bypassing iframe restrictions and cross-origin barriers to extract raw media directly from the active tab.
            </p>
          </div>

          <div className="grid gap-12 lg:grid-cols-[1fr_0.8fr]">
            <div className="space-y-8">
              <div className="flex items-center gap-3 text-sm font-black uppercase tracking-widest text-[#00f2ff]">
                 <Terminal className="h-4 w-4" />
                 Installation Protocol
              </div>
              
              <div className="space-y-6">
                {[
                  { icon: Globe, text: "Navigate to chrome://extensions in your browser environment." },
                  { icon: Box, text: "Enable the mandatory 'Developer Mode' toggle in the top-right corner." },
                  { icon: Box, text: "Click 'Load unpacked' and select the `browser-extension` project folder." },
                  { icon: Box, text: "Pin the SpilledCinema utility to your global toolbar for instant access." },
                  { icon: Zap, text: "Initialize a capture session, copy the ID, and execute the picker on the source tab." }
                ].map((step, i) => (
                  <div key={i} className="flex gap-6 group">
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-white/5 border border-white/5 text-[#00f2ff] transition-all group-hover:bg-[#00f2ff] group-hover:text-black">
                      <step.icon className="h-4 w-4" />
                    </div>
                    <div className="space-y-1 pt-2">
                       <div className="text-[10px] font-black text-white/30 uppercase tracking-widest">Phase {i + 1}</div>
                       <p className="text-base font-medium text-white/80 group-hover:text-white transition-colors">{step.text}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="space-y-8">
              <div className="rounded-[40px] border border-white/5 bg-white/5 p-10 backdrop-blur-3xl shadow-inner">
                <h4 className="text-xl font-black text-white tracking-tight mb-4">Environment Support</h4>
                <p className="text-sm leading-relaxed text-white/40 mb-8 font-medium">
                  Optimized for Chromium-based architectures including Google Chrome, Arc, Brave, and Edge. Extension-based capture is required for sites with strict Cross-Origin Read Blocking (CORB).
                </p>
                <div className="space-y-4">
                  <Link
                    href="/import"
                    className="btn-primary w-full flex items-center justify-center gap-3 rounded-full py-5 text-sm font-black shadow-2xl transition hover:scale-105 active:scale-95"
                  >
                    <Zap className="h-4 w-4 fill-current" />
                    CREATE SESSION
                  </Link>
                  <Link
                    href="/bookmarklet"
                    className="w-full flex items-center justify-center gap-3 rounded-full border border-white/10 bg-white/5 py-5 text-sm font-black text-white/60 hover:text-white transition-all"
                  >
                    <LayoutGrid className="h-4 w-4" />
                    COMPARE MODES
                  </Link>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}

