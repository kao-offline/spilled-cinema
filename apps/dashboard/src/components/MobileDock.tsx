import { clsx } from "clsx";
import { Compass, Heart, Home, Library, Server } from "lucide-react";

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
    { id: "server" as const, label: "Server", icon: Server, action: () => window.location.assign("/connect") },
  ];

  return (
    <nav className="mobile-dock fixed inset-x-3 bottom-[max(.75rem,env(safe-area-inset-bottom))] z-[200] grid h-[74px] grid-cols-5 gap-1 rounded-[24px] border border-white/[0.07] bg-[#303136]/96 p-1.5 shadow-[0_20px_50px_rgba(0,0,0,.58)] backdrop-blur-2xl lg:hidden" aria-label="Primary navigation">
      {items.map((item) => {
        const selected = item.id !== "server" && active === item.id;
        const server = item.id === "server";
        return (
          <button key={item.id} data-tutorial={server ? "mobile-connect-node" : undefined} type="button" onClick={item.action} className={clsx("flex min-w-0 flex-col items-center justify-center gap-1 rounded-[18px] transition active:scale-95", selected ? "bg-white text-[#131419] shadow-[0_7px_18px_rgba(0,0,0,.28)]" : server ? "bg-orange-300/[0.09] text-orange-100 active:bg-orange-300/15" : "text-white/78 active:bg-white/10")} aria-label={server ? "Connect to server" : item.label} aria-current={selected ? "page" : undefined}>
            <item.icon className={clsx("h-5 w-5", selected && item.id === "home" && "fill-current")} strokeWidth={2.5} />
            <span className={clsx("max-w-full truncate text-[9px] font-black tracking-[-0.01em]", server ? "text-orange-100" : selected ? "text-[#131419]" : "text-white/66")}>{item.label}</span>
          </button>
        );
      })}
    </nav>
  );
}
