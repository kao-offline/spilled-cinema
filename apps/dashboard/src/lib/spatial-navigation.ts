export type SpatialDirection = "left" | "right" | "up" | "down";

type SpatialRect = Pick<DOMRect, "left" | "right" | "top" | "bottom" | "width" | "height">;

function center(rect: SpatialRect) {
  return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
}

// Small forgiveness for subpixel gaps and rounded corners. Far smaller than
// any real row/rail gap, so adjacent rows never bleed into each other.
const LANE_TOLERANCE_PX = 8;

function spatialScore(source: SpatialRect, target: SpatialRect, direction: SpatialDirection): number | null {
  const origin = center(source);
  const point = center(target);
  const dx = point.x - origin.x;
  const dy = point.y - origin.y;
  const horizontal = direction === "left" || direction === "right";
  const primary = direction === "left" ? -dx : direction === "right" ? dx : direction === "up" ? -dy : dy;
  if (primary <= 1) return null;

  // Lean-back rule (tvOS / Leanback rows): an arrow press NEVER leaves its
  // lane. Left/right walk the current row; up/down walk the current column.
  // Reaching the end of a row is a predictable dead end — the cursor stops
  // instead of jumping diagonally somewhere "random".
  const sourceStart = (horizontal ? source.top : source.left) - LANE_TOLERANCE_PX;
  const sourceEnd = (horizontal ? source.bottom : source.right) + LANE_TOLERANCE_PX;
  const targetStart = horizontal ? target.top : target.left;
  const targetEnd = horizontal ? target.bottom : target.right;
  if (targetEnd < sourceStart || targetStart > sourceEnd) return null;

  const cross = horizontal ? Math.abs(dy) : Math.abs(dx);
  return primary + cross * 0.22;
}

/**
 * All candidates in `direction`, best first. Stable: ties keep DOM order so
 * repeated presses walk a rail instead of flickering between two cards.
 */
export function rankSpatialCandidates<T extends { rect: SpatialRect }>(
  source: SpatialRect,
  candidates: T[],
  direction: SpatialDirection,
): T[] {
  return candidates
    .map((candidate, index) => ({ candidate, index, score: spatialScore(source, candidate.rect, direction) }))
    .filter((entry): entry is { candidate: T; index: number; score: number } => entry.score !== null)
    .sort((left, right) => left.score - right.score || left.index - right.index)
    .map((entry) => entry.candidate);
}

export function findBestSpatialCandidate<T extends { rect: SpatialRect }>(
  source: SpatialRect,
  candidates: T[],
  direction: SpatialDirection,
): T | null {
  return rankSpatialCandidates(source, candidates, direction)[0] ?? null;
}
