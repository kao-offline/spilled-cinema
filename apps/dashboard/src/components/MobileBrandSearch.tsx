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
    <div className="lg:hidden">
      {onOpenLibrary ? (
        <button type="button" onClick={onOpenLibrary} className="mx-auto block" aria-label="Open library">{logo}</button>
      ) : (
        <div className="flex justify-center">{logo}</div>
      )}
      <div className="mt-4 flex gap-2.5">
        <label className="group flex h-12 min-w-0 flex-1 items-center gap-3 rounded-2xl border border-transparent bg-[#24262c] px-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.025)] transition focus-within:border-white/15 focus-within:bg-[#292b31]">
          <Search className="h-5 w-5 shrink-0 text-white/42 transition group-focus-within:text-white/65" />
          <input value={query} onFocus={onFocus} onChange={(event) => onQueryChange(event.target.value)} placeholder={placeholder} enterKeyHint="search" autoCapitalize="none" className="min-w-0 flex-1 bg-transparent text-base font-medium text-white outline-none placeholder:text-white/32" />
          {query ? <button type="button" onClick={() => onQueryChange("")} className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-white/8 text-white/55" aria-label="Clear search"><X className="h-4 w-4" /></button> : null}
        </label>
        <button type="button" onClick={onOpenSettings} className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-[#24262c] text-white transition active:scale-95" aria-label="Open settings"><Settings2 className="h-5 w-5" /></button>
      </div>
    </div>
  );
}
