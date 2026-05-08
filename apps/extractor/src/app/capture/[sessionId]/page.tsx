import { CaptureReview } from "@/components/capture-review";

export default async function CapturePage({
  params,
}: {
  params: Promise<{ sessionId: string }>;
}) {
  const { sessionId } = await params;
  return <CaptureReview sessionId={sessionId} />;
}
