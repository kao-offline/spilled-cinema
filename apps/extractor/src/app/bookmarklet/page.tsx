import Link from "next/link";
import { Zap, HelpCircle, ArrowRight, ShieldCheck } from "lucide-react";

export default function BookmarkletPage() {
  return (
    <div className="max-w-4xl mx-auto pb-20">
      <section className="glass-panel relative overflow-hidden rounded-[48px] border-white/5 p-12 sm:p-16 shadow-[0_0_80px_rgba(0,242,255,0.05)]">
        <div className="absolute top-0 right-0 h-64 w-64 -translate-y-1/2 translate-x-1/2 rounded-full bg-[#00f2ff]/5 blur-[80px]" />
        
        <div className="relative z-10 space-y-10">
          <div className="space-y-6">
            <div className="inline-flex items-center gap-3 rounded-full border border-[#00f2ff]/20 bg-[#00f2ff]/5 px-5 py-2.5 text-[11px] font-black uppercase tracking-[0.3em] text-[#00f2ff]">
              <HelpCircle className="h-4 w-4" />
              Workflow Guide
            </div>
            <h1 className="text-gradient text-5xl font-black tracking-tight leading-[1.1] sm:text-6xl">
              How Capture <br/> Re-Engineering Works.
            </h1>
            <p className="max-w-2xl text-xl leading-relaxed text-muted">
              SpilledCinema isolates the raw media stream from the complex chrome of modern web pages, providing a clean, internal playback environment.
            </p>
          </div>

          <div className="grid gap-8 md:grid-cols-2">
            <div className="space-y-6">
              <h3 className="text-sm font-black uppercase tracking-[0.2em] text-white/40">The Process</h3>
              <ol className="space-y-6">
                {[
                  "Initialize a capture session from any public video URL.",
                  "Open the source page in a new tab.",
                  "Execute the bookmarklet or extension on the page.",
                  "Review the extracted provider candidate in SpilledCinema.",
                  "Commit to your library for persistent cinematic access."
                ].map((step, i) => (
                  <li key={i} className="flex gap-5 group">
                    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-white/5 text-[11px] font-black text-white group-hover:bg-[#00f2ff] group-hover:text-black transition-all">
                      {i + 1}
                    </span>
                    <span className="text-base font-medium text-white/70 group-hover:text-white transition-colors">
                      {step}
                    </span>
                  </li>
                ))}
              </ol>
            </div>

            <div className="space-y-8">
              <div className="rounded-[32px] border border-white/5 bg-white/5 p-8 backdrop-blur-xl">
                <div className="flex items-center gap-3 text-[#00f2ff] mb-4">
                  <ShieldCheck className="h-5 w-5" />
                  <h4 className="text-xs font-black uppercase tracking-widest">Protocol Support</h4>
                </div>
                <p className="text-sm leading-relaxed text-white/50 font-medium">
                  Optimized for **HTML5 Video**, **HLS Adaptive Streams**, and **Embedded Provider Iframes**. 
                  Direct extraction of Encrypted Media (DRM), blob-only players, or protected manifests is currently restricted in the MVP.
                </p>
              </div>

              <div className="pt-4">
                <Link
                  href="/import"
                  className="btn-primary w-full flex items-center justify-center gap-3 rounded-full py-5 text-base font-black shadow-2xl transition hover:scale-105 active:scale-95"
                >
                  <Zap className="h-5 w-5 fill-current" />
                  START A SESSION
                  <ArrowRight className="h-5 w-5" />
                </Link>
              </div>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}

