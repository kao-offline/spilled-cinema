// Pure step planner for the TV auto-drifting rails (TvAutoRail).
// Ping-pong: drift one page, reverse at each end — no jarring jump-cut
// back to the start like a looping marquee would do.

export type AutoRailPlan = {
  /** scrollLeft to animate to */
  next: number;
  /** direction for the following tick */
  dir: 1 | -1;
  /** true when the rail fits on screen (nothing to drift) */
  settled: boolean;
};

export function planAutoRailStep(input: {
  scrollLeft: number;
  /** scrollWidth - clientWidth */
  max: number;
  dir: 1 | -1;
  step: number;
}): AutoRailPlan {
  const { scrollLeft, max, dir, step } = input;
  if (max <= 8) return { next: scrollLeft, dir, settled: true };

  let next = scrollLeft + dir * step;
  let nextDir = dir;
  if (next >= max - 8) {
    next = max;
    nextDir = -1;
  } else if (next <= 8) {
    next = 0;
    nextDir = 1;
  }
  return { next, dir: nextDir, settled: false };
}
