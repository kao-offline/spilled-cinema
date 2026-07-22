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

type NativeHlsOptions = {
  canPlayNativeHls: boolean;
  userAgent?: string;
  platform?: string;
  maxTouchPoints?: number;
};

export function shouldPreferNativeHls(options: NativeHlsOptions) {
  if (!options.canPlayNativeHls) return false;
  const appleMobile = /iPad|iPhone|iPod/i.test(options.userAgent ?? "")
    || (options.platform === "MacIntel" && (options.maxTouchPoints ?? 0) > 1);
  return appleMobile;
}

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

export function getBufferedAheadSeconds(position: number, ranges: BufferedRange[], joinTolerance = 0.5) {
  let end = position;
  for (const range of ranges) {
    if (range.end <= position) continue;
    if (range.start > end + joinTolerance) break;
    end = Math.max(end, range.end);
  }
  return Math.max(0, end - position);
}

export function formatHlsQualityLabel(
  level: { width?: number; height?: number; bitrate?: number },
  index: number,
) {
  // Cinematic encodes crop the black bars, so a 1080p source is commonly
  // 1920x800 and a 720p source 1280x534. Classify those tiers by width instead
  // of incorrectly presenting the cropped pixel height as the quality.
  const width = level.width ?? 0;
  const height = level.height ?? 0;
  if (width >= 3400 || height >= 1800) return "2160p";
  if (width >= 2500 || height >= 1300) return "1440p";
  if (width >= 1700) return "1080p";
  if (width >= 1150) return "720p";
  if (width >= 800) return "480p";
  if (width >= 560) return "360p";
  if (height) return `${height}p`;
  if (level.bitrate) return `${Math.round(level.bitrate / 1000)} kbps`;
  return `Level ${index + 1}`;
}
