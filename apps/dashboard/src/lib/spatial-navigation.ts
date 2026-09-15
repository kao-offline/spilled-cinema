export type SpatialDirection = "left" | "right" | "up" | "down";

type SpatialRect = Pick<DOMRect, "left" | "right" | "top" | "bottom" | "width" | "height">;

function center(rect: SpatialRect) {
  return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
}

export function findBestSpatialCandidate<T extends { rect: SpatialRect }>(
  source: SpatialRect,
  candidates: T[],
  direction: SpatialDirection,
): T | null {
  const origin = center(source);
  let best: { candidate: T; score: number } | null = null;

  for (const candidate of candidates) {
    const target = center(candidate.rect);
    const dx = target.x - origin.x;
    const dy = target.y - origin.y;
    const primary = direction === "left" ? -dx : direction === "right" ? dx : direction === "up" ? -dy : dy;
    if (primary <= 1) continue;

    const cross = direction === "left" || direction === "right" ? Math.abs(dy) : Math.abs(dx);
    const sourceCrossStart = direction === "left" || direction === "right" ? source.top : source.left;
    const sourceCrossEnd = direction === "left" || direction === "right" ? source.bottom : source.right;
    const targetCrossStart = direction === "left" || direction === "right" ? candidate.rect.top : candidate.rect.left;
    const targetCrossEnd = direction === "left" || direction === "right" ? candidate.rect.bottom : candidate.rect.right;
    const overlapsLane = targetCrossEnd >= sourceCrossStart && targetCrossStart <= sourceCrossEnd;
    const score = primary + cross * (overlapsLane ? 0.22 : 2.6);

    if (!best || score < best.score) best = { candidate, score };
  }

  return best?.candidate ?? null;
}
