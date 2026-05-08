import type { Metadata } from "next";
import Link from "next/link";
import { Zap, LayoutGrid, Plus } from "lucide-react";
import "./globals.css";

export const metadata: Metadata = {
  title: "SpilledCinema",
  description: "Capture clean, isolated video players from the open web and keep them in one cinematic library.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="h-full antialiased no-scrollbar" suppressHydrationWarning>
      <body className="min-h-full bg-background" suppressHydrationWarning>
        <div className="mx-auto flex min-h-screen max-w-7xl flex-col px-6 py-8 lg:px-20 lg:py-10">
          <header 
            className="glass-panel sticky top-6 z-50 mb-12 flex items-center justify-between rounded-full px-8 py-4 border-white/5 shadow-[0_20px_50px_rgba(0,0,0,0.5)]"
          >
            <Link href="/" className="flex items-center gap-4 group">
              <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-[#00f2ff] to-[#8e44ad] text-sm font-black text-black transition-transform group-hover:scale-110 group-hover:rotate-3 shadow-[0_0_20px_rgba(0,242,255,0.4)]">
                SC
              </div>
              <div className="hidden sm:block">
                <div className="text-xl font-black tracking-[0.25em] uppercase text-white">
                  SPILLED<span className="text-[#00f2ff]">CINEMA</span>
                </div>
                <div className="text-[10px] font-bold text-white/30 uppercase tracking-widest mt-0.5">
                  Universal Media Isolation
                </div>
              </div>
            </Link>
            
            <nav className="flex items-center gap-4">
              <Link
                href="/import"
                className="flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-6 py-3 text-xs font-black uppercase tracking-widest text-white/60 hover:text-[#00f2ff] hover:border-[#00f2ff]/30 transition-all"
              >
                <Plus className="h-4 w-4" />
                <span className="hidden md:inline">Import</span>
              </Link>
              <Link
                href="/bookmarklet"
                className="flex items-center gap-2 rounded-full bg-white/10 px-6 py-3 text-xs font-black uppercase tracking-widest text-white hover:bg-white/15 transition-all"
              >
                <LayoutGrid className="h-4 w-4" />
                <span className="hidden md:inline">Library Tools</span>
              </Link>
            </nav>
          </header>
          
          <main className="flex-1">{children}</main>
          
          <footer className="mt-20 py-10 border-t border-white/5 text-center">
            <div className="flex items-center justify-center gap-2 text-white/20 text-xs font-black uppercase tracking-[0.4em]">
              <Zap className="h-4 w-4" />
              SpilledCinema Reconstruction Engine
            </div>
          </footer>
        </div>
      </body>
    </html>
  );
}

