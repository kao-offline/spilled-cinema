import { IframeCaptureShell } from "@/components/iframe-capture-shell";

export default async function IframeCapturePage({
  params,
}: {
  params: Promise<{ sessionId: string }>;
}) {
  const { sessionId } = await params;
  return <IframeCaptureShell sessionId={sessionId} />;
}
