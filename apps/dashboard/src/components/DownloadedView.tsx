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
    <section className="animate-fade-in px-4 py-3 pb-16 sm:px-6 lg:px-10">
      <div className="mb-7 border-b border-white/[0.07] pb-5">
        <div className="text-[10px] font-black uppercase tracking-[0.3em] text-white/28">Available offline</div>
        <h2 className="mt-1.5 text-3xl font-black tracking-[-0.035em] text-white">Downloaded</h2>
        <p className="mt-2 text-sm text-white/40">Titles saved to your vault for uninterrupted playback.</p>
      </div>

      {totalSavedShows.length === 0 ? (
        <div className="col-span-full flex flex-col items-center justify-center rounded-[1.5rem] border border-dashed border-white/10 bg-white/[0.018] px-6 py-24 text-center">
          <span className="text-sm font-semibold text-white/42">No offline titles yet.</span>
          <span className="mt-2 text-xs text-white/25">Download an episode or movie and it will appear here.</span>
        </div>
      ) : (
        <div
          className="animate-fade-in grid grid-cols-3 gap-2.5 opacity-0 sm:grid-cols-[repeat(auto-fit,minmax(168px,220px))] sm:justify-center sm:gap-5 lg:justify-start xl:grid-cols-[repeat(auto-fit,minmax(190px,230px))]"
          style={{ animationDelay: "0.1s" }}
        >
          {totalSavedShows.map((show) => (
            <div key={show.slug} className="relative w-full max-w-[230px]">
              <ShowCard show={show} onOpen={onOpenShow} />
              <div className="pointer-events-none absolute left-3 top-3 rounded-full border border-white/10 bg-black/75 px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.16em] text-white/82 backdrop-blur-xl">
                {downloadedCountByShow[show.slug] ?? 0} saved
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
