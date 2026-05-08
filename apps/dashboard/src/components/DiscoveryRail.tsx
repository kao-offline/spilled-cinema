import { ChevronLeft, ChevronRight } from "lucide-react";
import useEmblaCarousel from "embla-carousel-react";
import { WheelGesturesPlugin } from "embla-carousel-wheel-gestures";
import { Children, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { KeyboardEvent, ReactNode } from "react";

type DiscoveryRailProps = {
  title: string;
  subtitle?: string;
  countLabel: string;
  children: ReactNode;
};

const EDGE_OVERLAY_WIDTH = 86;

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

export function DiscoveryRail({ title, subtitle, countLabel, children }: DiscoveryRailProps) {
  const slides = useMemo(() => Children.toArray(children), [children]);
  const wheelPlugin = useMemo(() => WheelGesturesPlugin({ forceWheelAxis: "x" }), []);
  const [viewportRef, emblaApi] = useEmblaCarousel(
    {
      align: "start",
      containScroll: "trimSnaps",
      dragFree: true,
      skipSnaps: false,
    },
    [wheelPlugin],
  );
  const [canScrollPrev, setCanScrollPrev] = useState(false);
  const [canScrollNext, setCanScrollNext] = useState(false);
  const [hasOverflow, setHasOverflow] = useState(false);
  const [viewportRect, setViewportRect] = useState<DOMRect | null>(null);
  const frameRef = useRef<number | null>(null);

  const syncRailGeometry = useCallback(() => {
    if (!emblaApi) {
      setViewportRect(null);
      return;
    }

    const viewportNode = emblaApi.rootNode();
    const containerNode = emblaApi.containerNode();
    const nextRect = viewportNode.getBoundingClientRect();

    setHasOverflow(containerNode.scrollWidth > viewportNode.clientWidth + 2);
    setViewportRect((current) => {
      if (
        current &&
        current.top === nextRect.top &&
        current.left === nextRect.left &&
        current.width === nextRect.width &&
        current.height === nextRect.height
      ) {
        return current;
      }
      return nextRect;
    });
  }, [emblaApi]);

  const syncScrollState = useCallback(() => {
    if (!emblaApi) {
      setCanScrollPrev(false);
      setCanScrollNext(false);
      setHasOverflow(false);
      return;
    }

    const viewportNode = emblaApi.rootNode();
    const containerNode = emblaApi.containerNode();
    setCanScrollPrev(emblaApi.canScrollPrev());
    setCanScrollNext(emblaApi.canScrollNext());
    setHasOverflow(containerNode.scrollWidth > viewportNode.clientWidth + 2);
  }, [emblaApi]);

  const queueScrollStateSync = useCallback(() => {
    if (frameRef.current !== null) {
      return;
    }
    frameRef.current = window.requestAnimationFrame(() => {
      frameRef.current = null;
      syncScrollState();
    });
  }, [syncScrollState]);

  useEffect(() => {
    if (!emblaApi) {
      return;
    }

    syncRailGeometry();
    queueScrollStateSync();

    const handleEmblaResize = () => {
      syncRailGeometry();
      queueScrollStateSync();
    };
    emblaApi.on("init", handleEmblaResize);
    emblaApi.on("reInit", handleEmblaResize);
    emblaApi.on("resize", handleEmblaResize);
    emblaApi.on("slidesChanged", handleEmblaResize);
    emblaApi.on("scroll", queueScrollStateSync);
    emblaApi.on("select", queueScrollStateSync);

    const viewportNode = emblaApi.rootNode();
    const resizeObserver = new ResizeObserver(() => {
      syncRailGeometry();
      queueScrollStateSync();
    });
    resizeObserver.observe(viewportNode);
    resizeObserver.observe(emblaApi.containerNode());

    const handleViewportMove = () => syncRailGeometry();
    window.addEventListener("resize", handleViewportMove);
    window.addEventListener("scroll", handleViewportMove, true);

    return () => {
      emblaApi.off("init", handleEmblaResize);
      emblaApi.off("reInit", handleEmblaResize);
      emblaApi.off("resize", handleEmblaResize);
      emblaApi.off("slidesChanged", handleEmblaResize);
      emblaApi.off("scroll", queueScrollStateSync);
      emblaApi.off("select", queueScrollStateSync);
      resizeObserver.disconnect();
      if (frameRef.current !== null) {
        window.cancelAnimationFrame(frameRef.current);
        frameRef.current = null;
      }
      window.removeEventListener("resize", handleViewportMove);
      window.removeEventListener("scroll", handleViewportMove, true);
    };
  }, [emblaApi, queueScrollStateSync, syncRailGeometry]);

  function scrollPrev() {
    emblaApi?.scrollPrev();
  }

  function scrollNext() {
    emblaApi?.scrollNext();
  }

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === "ArrowLeft") {
      event.preventDefault();
      scrollPrev();
    }
    if (event.key === "ArrowRight") {
      event.preventDefault();
      scrollNext();
    }
  }

  function renderArrow(direction: "prev" | "next") {
    if (!viewportRect || !hasOverflow) {
      return null;
    }

    const active = direction === "prev" ? canScrollPrev : canScrollNext;
    const top = viewportRect.top;
    const left = direction === "prev"
      ? clamp(viewportRect.left, 0, Math.max(0, window.innerWidth - EDGE_OVERLAY_WIDTH))
      : clamp(viewportRect.right - EDGE_OVERLAY_WIDTH, 0, Math.max(0, window.innerWidth - EDGE_OVERLAY_WIDTH));

    return (
      <div
        key={direction}
        style={{
          position: "fixed",
          left,
          top,
          width: EDGE_OVERLAY_WIDTH,
          height: viewportRect.height,
          zIndex: 120,
        }}
        className={[
          "pointer-events-none flex items-center transition-opacity duration-200 ease-out",
          direction === "prev"
            ? "justify-start bg-[linear-gradient(90deg,rgba(7,9,12,0.94)_0%,rgba(7,9,12,0.72)_42%,rgba(7,9,12,0)_100%)]"
            : "justify-end bg-[linear-gradient(270deg,rgba(7,9,12,0.94)_0%,rgba(7,9,12,0.72)_42%,rgba(7,9,12,0)_100%)]",
          active ? "opacity-100" : "opacity-0",
        ].join(" ")}
      >
        <button
          type="button"
          aria-label={direction === "prev" ? `Scroll ${title} left` : `Scroll ${title} right`}
          onClick={direction === "prev" ? scrollPrev : scrollNext}
          disabled={!active}
          className={[
            "pointer-events-auto inline-flex h-full w-14 items-center text-white/78 transition-colors duration-150",
            direction === "prev" ? "justify-start pl-3" : "justify-end pr-3",
            active ? "hover:text-white" : "pointer-events-none",
          ].join(" ")}
        >
          {direction === "prev" ? <ChevronLeft className="h-5 w-5" /> : <ChevronRight className="h-5 w-5" />}
        </button>
      </div>
    );
  }

  return (
    <>
      <section className="min-w-0 space-y-4">
        <div className="flex min-w-0 items-end justify-between gap-4">
          <div className="min-w-0">
            <h2 className="text-lg font-semibold text-white">{title}</h2>
            {subtitle ? <p className="text-[11px] uppercase tracking-[0.16em] text-white/34">{subtitle}</p> : null}
          </div>
          <div className="shrink-0 text-[10px] font-semibold uppercase tracking-[0.16em] text-white/28">{countLabel}</div>
        </div>

        <div
          ref={viewportRef}
          tabIndex={0}
          onKeyDown={handleKeyDown}
          className="min-w-0 w-full overflow-hidden focus:outline-none"
          aria-label={`${title} carousel`}
        >
          <div className="flex gap-4 touch-pan-y select-none">
            {slides.map((slide, index) => (
              <div key={index} className="min-w-0 flex-[0_0_auto]">
                {slide}
              </div>
            ))}
          </div>
        </div>
      </section>

      {viewportRect && hasOverflow
        ? createPortal([renderArrow("prev"), renderArrow("next")], document.body)
        : null}
    </>
  );
}
