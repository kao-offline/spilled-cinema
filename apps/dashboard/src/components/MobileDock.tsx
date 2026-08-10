import { clsx } from "clsx";
import { Compass, Heart, Home, Library } from "lucide-react";

export type MobileDockItem = "home" | "library" | "favorites" | "explore";

type MobileDockProps = {
  active: MobileDockItem;
  onHome: () => void;
  onLibrary: () => void;
  onFavorites: () => void;
  onExplore: () => void;
};

export function MobileDock({ active, onHome, onLibrary, onFavorites, onExplore }: MobileDockProps) {
  const items = [
    { id: "home" as const, label: "Home", icon: Home, action: onHome },
    { id: "library" as const, label: "Vault", icon: Library, action: onLibrary },
    { id: "favorites" as const, label: "Favorites", icon: Heart, action: onFavorites },
    { id: "explore" as const, label: "Explore", icon: Compass, action: onExplore },
  ];

  return (
    <nav className="mobile-dock fixed inset-x-3 bottom-[max(.75rem,env(safe-area-inset-bottom))] z-[200] grid h-[72px] grid-cols-4 gap-1.5 rounded-[24px] border border-white/[0.07] bg-[#303136]/96 p-1.5 shadow-[0_20px_50px_rgba(0,0,0,.58)] backdrop-blur-2xl lg:hidden" aria-label="Primary navigation">
      {items.map((item) => {
        const selected = active === item.id;
        return (
          <button key={item.id} type="button" onClick={item.action} className={clsx("flex items-center justify-center rounded-[18px] transition active:scale-95", selected ? "bg-white text-[#131419] shadow-[0_7px_18px_rgba(0,0,0,.28)]" : "text-white/92 active:bg-white/10")} aria-label={item.label} aria-current={selected ? "page" : undefined}>
            <item.icon className={clsx("h-7 w-7", selected && "fill-current")} strokeWidth={2.5} />
          </button>
        );
      })}
    </nav>
  );
}
