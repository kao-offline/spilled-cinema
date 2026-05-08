import type { ImportedShow } from "../lib/types";
import { ShowCard } from "./ShowCard";

type DownloadedViewProps = {
  shows: ImportedShow[];
  downloadedCountByShow: Record<string, number>;
  onOpenShow: (slug: string) => void;
};

export function DownloadedView({ shows, downloadedCountByShow, onOpenShow }: DownloadedViewProps) {
  const totalSavedShows = shows.filter((show) => (downloadedCountByShow[show.slug] ?? 0) > 0);

  return (
    <section className="mt-4 animate-fade-in px-4 pb-12 sm:px-6 lg:px-10">
      <div className="mb-6 flex items-center justify-between">
        <h2 className="text-xl font-semibold tracking-tight text-white">Downloaded</h2>
      </div>

      {totalSavedShows.length === 0 ? (
        <div className="col-span-full py-24 flex flex-col items-center justify-center text-center rounded-2xl border border-dashed border-white/10">
          <span className="text-sm font-medium text-white/40">No offline shows yet. Download episodes first.</span>
        </div>
      ) : (
        <div
          className="animate-fade-in grid grid-cols-[repeat(auto-fit,minmax(180px,220px))] justify-center gap-5 opacity-0 lg:justify-start xl:grid-cols-[repeat(auto-fit,minmax(190px,230px))]"
          style={{ animationDelay: "0.1s" }}
        >
          {totalSavedShows.map((show) => (
            <div key={show.slug} className="relative w-full max-w-[230px]">
              <ShowCard show={show} onOpen={onOpenShow} />
              <div className="pointer-events-none absolute left-3 top-3 rounded-full bg-black/80 px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.2em] text-emerald-300">
                {downloadedCountByShow[show.slug] ?? 0} saved
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
