import { useEffect, useRef, type ReactNode } from "react";
import { rankSpatialCandidates, type SpatialDirection } from "../lib/spatial-navigation";

const FOCUSABLE_SELECTOR = [
  "button:not(:disabled)",
  "a[href]",
  "input:not(:disabled)",
  "select:not(:disabled)",
  "textarea:not(:disabled)",
  "[tabindex]:not([tabindex='-1'])",
  "[role='button']",
].join(",");

function isVisible(element: HTMLElement) {
  if (element.closest("[hidden],[aria-hidden='true'],[inert]")) return false;
  const style = window.getComputedStyle(element);
  if (style.display === "none" || style.visibility === "hidden") return false;
  const rect = element.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0;
}

function activeNavigationScope() {
  const modals = Array.from(document.querySelectorAll<HTMLElement>("[aria-modal='true']")).filter(isVisible);
  return modals.at(-1) ?? document.body;
}

function focusableElements(scope: HTMLElement) {
  // tabindex="-1" means mouse-only (e.g. a card's overflow button that
  // duplicates the primary action). The remote must skip those stops so one
  // card is always one press, never a bounce between title and dots.
  return Array.from(scope.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR))
    .filter((element) => element.getAttribute("tabindex") !== "-1")
    .filter(isVisible);
}

/**
 * True when the element (or any ancestor) is viewport-docked. Only the
 * element itself is not enough: nav buttons are static, their header is
 * what is fixed — and that is exactly what poisons viewport-space scoring.
 */
function isViewportDocked(element: HTMLElement) {
  let node: HTMLElement | null = element;
  while (node && node !== document.body) {
    if (window.getComputedStyle(node).position === "fixed") return true;
    node = node.parentElement;
  }
  return false;
}

/**
 * Rect in DOCUMENT coordinates. Viewport rects lie as soon as the page
 * scrolls: a fixed header (the TV nav) never scrolls away, so in viewport
 * space it is always "nearest" and steals every Up press from deep content.
 * Content gets the scroll offset added back; fixed chrome is pinned to its
 * natural place at the top, making all distances scroll-invariant.
 */
function documentRect(element: HTMLElement) {
  const box = element.getBoundingClientRect();
  const docked = isViewportDocked(element);
  const left = box.left + (docked ? 0 : window.scrollX);
  const top = box.top + (docked ? 0 : window.scrollY);
  return { left, top, right: left + box.width, bottom: top + box.height, width: box.width, height: box.height };
}

function focusElement(element: HTMLElement, direction?: SpatialDirection) {
  element.focus({ preventScroll: true });
  // Remote-friendly glide: preventScroll above suppresses the browser's
  // instant jump, then this single animated pass carries the selection.
  // Vertical moves CENTER the card so the page always travels with focus
  // (nearest would scroll zero pixels when the target is already peeking
  // into view, stranding context like the hero cut off above). Horizontal
  // rail walks keep nearest so the page never swims sideways.
  const vertical = direction === "up" || direction === "down";
  element.scrollIntoView({ behavior: "smooth", block: vertical ? "center" : "nearest", inline: "nearest" });
}

function firstFocusable(elements: HTMLElement[]) {
  return [...elements].sort((left, right) => {
    const a = left.getBoundingClientRect();
    const b = right.getBoundingClientRect();
    const sameRow = Math.abs(a.top - b.top) <= 12;
    return sameRow ? a.left - b.left : a.top - b.top;
  })[0] ?? null;
}

function shouldKeepNativeKeys(target: HTMLElement | null, key: string) {
  if (!target) return false;
  if (target.closest(".spilled-universal-player,[data-spatial-navigation='off'],textarea,select,[contenteditable='true']")) return true;
  const input = target.closest<HTMLInputElement>("input");
  if (!input) return false;
  if (["range", "number", "date", "time"].includes(input.type)) return true;
  return key === "ArrowLeft" || key === "ArrowRight" || key === "Enter";
}

export function SpatialNavigationController({ children }: { children: ReactNode }) {
  // Remembers the last hop so a repeated press in the SAME direction can
  // never bounce straight back (A → B → A). Deliberate backtracking with the
  // opposite arrow still works — only the exact return hop is skipped.
  const lastMoveRef = useRef<{ from: HTMLElement; to: HTMLElement; direction: SpatialDirection } | null>(null);

  useEffect(() => {
    const handlePointer = () => {
      document.documentElement.classList.remove("spatial-navigation-active");
      lastMoveRef.current = null;
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey) return;
      const target = event.target instanceof HTMLElement ? event.target : null;
      if (shouldKeepNativeKeys(target, event.key)) return;

      const directionByKey: Partial<Record<string, SpatialDirection>> = {
        ArrowLeft: "left",
        ArrowRight: "right",
        ArrowUp: "up",
        ArrowDown: "down",
      };
      const direction = directionByKey[event.key];
      const scope = activeNavigationScope();
      const elements = focusableElements(scope);

      if (direction) {
        if (elements.length === 0) return;
        event.preventDefault();
        document.documentElement.classList.add("spatial-navigation-active");
        const active = document.activeElement instanceof HTMLElement && scope.contains(document.activeElement)
          ? document.activeElement
          : null;
        if (!active || !elements.includes(active)) {
          const first = firstFocusable(elements);
          if (first) focusElement(first);
          lastMoveRef.current = null;
          return;
        }
        const ranked = rankSpatialCandidates(
          documentRect(active),
          elements.filter((element) => element !== active).map((element) => ({ element, rect: documentRect(element) })),
          direction,
        );
        let pick = ranked[0] ?? null;
        const last = lastMoveRef.current;
        if (pick && last && last.direction === direction && active === last.to && pick.element === last.from) {
          pick = ranked[1] ?? null;
        }
        if (pick) {
          lastMoveRef.current = { from: active, to: pick.element, direction };
          focusElement(pick.element, direction);
        } else {
          lastMoveRef.current = null;
        }
        return;
      }

      if (event.key === "Enter") {
        const active = document.activeElement instanceof HTMLElement ? document.activeElement : null;
        if (active?.matches("[role='button']:not(button):not(a),[role='menuitem']:not(button):not(a)")) {
          event.preventDefault();
          active.click();
          return;
        }
        if (active && active !== document.body) return;
        const first = firstFocusable(elements);
        if (!first) return;
        event.preventDefault();
        document.documentElement.classList.add("spatial-navigation-active");
        focusElement(first);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("pointerdown", handlePointer, { passive: true });
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("pointerdown", handlePointer);
      document.documentElement.classList.remove("spatial-navigation-active");
    };
  }, []);

  return children;
}
