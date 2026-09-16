import { Search, Settings2, X } from "lucide-react";

type MobileBrandSearchProps = {
  query: string;
  onQueryChange: (value: string) => void;
  onFocus?: () => void;
  onOpenLibrary?: () => void;
  onOpenSettings: () => void;
  placeholder?: string;
};

export function MobileBrandSearch({
  query,
  onQueryChange,
  onFocus,
  onOpenLibrary,
  onOpenSettings,
  placeholder = "Search any movie, series or paste a link…",
}: MobileBrandSearchProps) {
  const logo = <img src="/Spilled.svg" alt="Spilled" className="h-7 w-auto brightness-0 invert" />;

  return (
    <div className="lg:hidden" role="search">
      {onOpenLibrary ? (
        <button type="button" onClick={onOpenLibrary} className="mx-auto block" aria-label="Open library">{logo}</button>
      ) : (
        <div className="flex justify-center">{logo}</div>
      )}
      <div className="mt-4 flex gap-2.5">
        <label data-tutorial="search-bar" className="group flex h-13 min-w-0 flex-1 items-center gap-3 rounded-[18px] border border-white/[0.09] bg-[#17191f] px-4 shadow-[inset_0_1px_rgba(255,255,255,.035)] transition focus-within:border-white/22 focus-within:bg-[#1c1e25] focus-within:ring-2 focus-within:ring-white/10">
          <span className="sr-only">Search movies and series</span>
          <Search className="h-4 w-4 shrink-0 text-white/40 transition group-focus-within:text-white/60" />
          <input type="search" value={query} onFocus={onFocus} onChange={(event) => onQueryChange(event.target.value)} placeholder={placeholder} enterKeyHint="search" autoCapitalize="none" className="min-w-0 flex-1 bg-transparent text-base font-medium text-white outline-none placeholder:text-white/55 [&::-webkit-search-cancel-button]:hidden" />
        </label>
        {query ? <button type="button" onClick={() => onQueryChange("")} className="flex min-h-11 min-w-11 shrink-0 items-center justify-center rounded-[18px] bg-white/8 text-white/70 focus-visible:outline-2" aria-label="Clear search"><X className="h-4 w-4" /></button> : null}
        <button data-tutorial="homepage-settings" type="button" onClick={onOpenSettings} className="flex h-13 w-13 shrink-0 items-center justify-center rounded-[18px] border border-white/[0.09] bg-[#17191f] text-white/65 shadow-[inset_0_1px_rgba(255,255,255,.035)] transition hover:border-white/18 hover:bg-[#1c1e25] hover:text-white active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70" aria-label="Open settings"><Settings2 className="h-5 w-5" /></button>
      </div>
    </div>
  );
}
