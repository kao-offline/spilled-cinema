type BufferedRange = {
  start: number;
  end: number;
};

type HlsBufferProfile = {
  aheadSeconds: number;
  maximumAheadSeconds: number;
  maximumBytes: number;
  bandwidthEstimate: number;
};

export function selectHlsBufferProfile(options: {
  saveData?: boolean;
  effectiveType?: string;
  compactViewport?: boolean;
}): HlsBufferProfile {
  const constrained = Boolean(options.saveData) || /(?:^|-)2g$/i.test(options.effectiveType ?? "");
  if (constrained) {
    return {
      aheadSeconds: 30,
      maximumAheadSeconds: 75,
      maximumBytes: 48 * 1024 * 1024,
      bandwidthEstimate: 800_000,
    };
  }
  if (options.compactViewport || /3g$/i.test(options.effectiveType ?? "")) {
    return {
      aheadSeconds: 75,
      maximumAheadSeconds: 180,
      maximumBytes: 96 * 1024 * 1024,
      bandwidthEstimate: 1_500_000,
    };
  }
  return {
    aheadSeconds: 120,
    maximumAheadSeconds: 300,
    maximumBytes: 192 * 1024 * 1024,
    bandwidthEstimate: 3_000_000,
  };
}

export function findSmallBufferGapTarget(position: number, ranges: BufferedRange[], maximumGap = 1.5) {
  for (const range of ranges) {
    const gap = range.start - position;
    if (gap > 0.01 && gap <= maximumGap) return range.start + 0.01;
  }
  return null;
}
