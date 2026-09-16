import { clsx } from "clsx";
import { Compass, Heart, Home, Library, UserRound } from "lucide-react";

export type MobileDockItem = "home" | "library" | "favorites" | "explore" | "account";

type MobileDockProps = {
  active: MobileDockItem;
  onHome: () => void;
  onLibrary: () => void;
  onFavorites: () => void;
  onExplore: () => void;
  onAccount?: () => void;
  accountLabel?: string | null;
};

export function MobileDock({ active, onHome, onLibrary, onFavorites, onExplore, onAccount, accountLabel }: MobileDockProps) {
  const items = [
    { id: "home" as const, label: "Home", icon: Home, action: onHome },
    { id: "library" as const, label: "Vault", icon: Library, action: onLibrary },
    { id: "favorites" as const, label: "Favorites", icon: Heart, action: onFavorites },
    { id: "explore" as const, label: "Explore", icon: Compass, action: onExplore },
    ...(onAccount ? [{ id: "account" as const, label: accountLabel ?? "Account", icon: UserRound, action: onAccount }] : []),
  ];

  return (
    <nav className={clsx("mobile-dock fixed inset-x-3 bottom-[max(.75rem,env(safe-area-inset-bottom))] z-[200] grid h-[68px] gap-1 rounded-[22px] border border-white/[0.08] bg-[#26282e]/95 p-1.5 shadow-[0_18px_44px_rgba(0,0,0,.5)] backdrop-blur-md lg:hidden", onAccount ? "grid-cols-5" : "grid-cols-4")} aria-label="Primary navigation">
      {items.map((item) => {
        const selected = active === item.id;
        return (
          <button key={item.id} type="button" onClick={item.action} className={clsx("flex min-h-12 flex-col gap-1 items-center justify-center rounded-[17px] transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70 active:scale-95", selected ? "bg-white text-[#131419] shadow-[0_7px_18px_rgba(0,0,0,.28)]" : "text-white/88 active:bg-white/10")} aria-label={item.label} aria-current={selected ? "page" : undefined}>
            <item.icon className="h-5 w-5" strokeWidth={2.1} />
            <span className="max-w-full truncate px-0.5 text-[9px] font-bold leading-none">{item.label}</span>
          </button>
        );
      })}
    </nav>
  );
}
