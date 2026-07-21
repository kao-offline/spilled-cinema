import { ChevronLeft, ChevronRight } from "lucide-react";
import { useRef } from "react";
import type { HomepageRail, HomepageRailItem } from "../lib/homepage-rails";
import { HomeMediaCard } from "./HomeMediaCard";

type HomeRailProps = {
  rail: HomepageRail;
  onOpenLocal: (item: HomepageRailItem) => void;
  onImportRemote: (item: HomepageRailItem) => void;
};

export function HomeRail({ rail, onOpenLocal, onImportRemote }: HomeRailProps) {
  const scrollerRef = useRef<HTMLDivElement>(null);

  const scrollBy = (direction: -1 | 1) => {
    const node = scrollerRef.current;
    if (!node) return;
    node.scrollBy({ left: direction * Math.max(320, node.clientWidth * 0.82), behavior: "smooth" });
  };

  return (
    <section className="relative py-3">
      <div className="mb-3 flex items-center justify-between px-5 sm:px-10 lg:px-16">
        <h2 className="text-lg font-black tracking-normal text-white sm:text-xl">{rail.title}</h2>
        <div className="hidden items-center gap-2 md:flex">
          <button type="button" onClick={() => scrollBy(-1)} className="flex h-8 w-8 items-center justify-center rounded-full bg-white/8 text-white/70 hover:bg-white/14" aria-label="Scroll left">
            <ChevronLeft className="h-4 w-4" />
          </button>
          <button type="button" onClick={() => scrollBy(1)} className="flex h-8 w-8 items-center justify-center rounded-full bg-white/8 text-white/70 hover:bg-white/14" aria-label="Scroll right">
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
      </div>
      <div ref={scrollerRef} className="no-scrollbar flex gap-4 overflow-x-auto px-5 pb-5 sm:px-10 lg:px-16">
        {rail.items.map((item) => (
          <HomeMediaCard
            key={item.id}
            item={item}
            railKind={rail.kind}
            onOpen={() => onOpenLocal(item)}
            onImport={() => onImportRemote(item)}
          />
        ))}
      </div>
    </section>
  );
}
