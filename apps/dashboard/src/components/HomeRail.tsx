import { ChevronLeft, ChevronRight } from "lucide-react";
import { useRef } from "react";
import type { HomepageRail, HomepageRailItem } from "../lib/homepage-rails";
import { HomeMediaCard } from "./HomeMediaCard";

type HomeRailProps = {
  rail: HomepageRail;
  onOpenLocal: (item: HomepageRailItem) => void;
  onImportRemote: (item: HomepageRailItem) => void;
  layout?: "rail" | "grid";
};

export function HomeRail({ rail, onOpenLocal, onImportRemote, layout = "rail" }: HomeRailProps) {
  const scrollerRef = useRef<HTMLDivElement>(null);

  const scrollBy = (direction: -1 | 1) => {
    const node = scrollerRef.current;
    if (!node) return;
    const televisionLayout = window.matchMedia("(min-width: 1600px) and (min-height: 800px)").matches;
    node.scrollBy({ left: direction * Math.max(320, node.clientWidth * 0.82), behavior: televisionLayout ? "auto" : "smooth" });
  };

  return (
    <section className="ui-virtual-section relative py-3">
      <div className="mb-3 flex items-center justify-between px-5 sm:px-10 lg:px-16">
        <h2 className="text-lg font-black tracking-normal text-white sm:text-xl">{rail.title}</h2>
        <div className={layout === "grid" ? "hidden" : "hidden items-center gap-2 md:flex"}>
          <button type="button" onClick={() => scrollBy(-1)} className="flex h-8 w-8 items-center justify-center rounded-full bg-white/8 text-white/70 hover:bg-white/14" aria-label="Scroll left">
            <ChevronLeft className="h-4 w-4" />
          </button>
          <button type="button" onClick={() => scrollBy(1)} className="flex h-8 w-8 items-center justify-center rounded-full bg-white/8 text-white/70 hover:bg-white/14" aria-label="Scroll right">
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
      </div>
      <div ref={scrollerRef} className={layout === "grid" ? "grid grid-cols-2 gap-x-4 gap-y-7 px-5 pb-8 sm:grid-cols-3 sm:px-10 md:grid-cols-4 lg:grid-cols-5 lg:px-16 xl:grid-cols-6 2xl:grid-cols-7" : "no-scrollbar flex gap-4 overflow-x-auto px-5 pb-5 sm:px-10 lg:px-16"}>
        {rail.items.map((item) => (
          <HomeMediaCard
            key={item.id}
            item={item}
            railKind={rail.kind}
            layout={layout}
            onOpen={() => onOpenLocal(item)}
            onImport={() => onImportRemote(item)}
          />
        ))}
      </div>
    </section>
  );
}
