export type LibraryToken = string;
export type CaptureSessionId = string;
export type MediaItemId = string;

export type CaptureStatus =
  | "pending"
  | "captured"
  | "needs_review"
  | "saved"
  | "failed";

export type ExtractedMediaKind =
  | "direct_mp4"
  | "direct_webm"
  | "hls"
  | "embed"
  | "unknown";

export type ExtractedMediaCandidate = {
  kind: ExtractedMediaKind;
  url: string;
  mimeType?: string;
  originHint?: string;
};

export type ExtractedSubtitleTrack = {
  url: string;
  label?: string;
  srclang?: string;
  kind?: string;
  default?: boolean;
};

export type CapturePayload = {
  sessionId: CaptureSessionId;
  pageUrl: string;
  pageTitle?: string;
  clickedElementTag?: string;
  posterUrl?: string;
  mediaCandidates: ExtractedMediaCandidate[];
  subtitleTracks: ExtractedSubtitleTrack[];
  detectedDurationSeconds?: number;
  notes?: string;
};

export type CaptureSession = {
  id: CaptureSessionId;
  libraryToken: LibraryToken;
  sourcePageUrl: string;
  status: CaptureStatus;
  createdAt: number;
  lastError?: string;
  capturePayload?: CapturePayload;
};

export type MediaItem = {
  id: MediaItemId;
  libraryToken: LibraryToken;
  title: string;
  sourcePageUrl: string;
  sourceHost: string;
  posterUrl?: string;
  playback: {
    primaryUrl: string;
    kind: Exclude<ExtractedMediaKind, "unknown">;
    subtitleTracks: ExtractedSubtitleTrack[];
  };
  tags: string[];
  durationSeconds?: number;
  resumePositionSeconds: number;
  createdAt: number;
  updatedAt: number;
};

export type PlayerPreferences = {
  volume: number;
  muted: boolean;
  playbackRate: number;
  subtitleMode: "showing" | "hidden";
};
