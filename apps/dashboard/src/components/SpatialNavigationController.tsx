import { useEffect, type ReactNode } from "react";
import { findBestSpatialCandidate, type SpatialDirection } from "../lib/spatial-navigation";

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
  return Array.from(scope.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(isVisible);
}

function focusElement(element: HTMLElement) {
  element.focus({ preventScroll: true });
  element.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "nearest" });
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
  useEffect(() => {
    const handlePointer = () => document.documentElement.classList.remove("spatial-navigation-active");
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
          return;
        }
        const candidates = elements.filter((element) => element !== active).map((element) => ({ element, rect: element.getBoundingClientRect() }));
        const next = findBestSpatialCandidate(active.getBoundingClientRect(), candidates, direction);
        if (next) focusElement(next.element);
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
