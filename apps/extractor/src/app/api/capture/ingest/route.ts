import { NextRequest, NextResponse } from "next/server";
import type { CapturePayload } from "@/lib/types";
import { sanitizeCapturePayload, uniqueByUrl } from "@/lib/utils";
import { getCaptureSession, ingestCapturePayload } from "@/server/app-store";

function withCors(response: NextResponse) {
  response.headers.set("Access-Control-Allow-Origin", "*");
  response.headers.set("Access-Control-Allow-Methods", "POST, OPTIONS");
  response.headers.set("Access-Control-Allow-Headers", "Content-Type");
  return response;
}

export async function OPTIONS() {
  return withCors(new NextResponse(null, { status: 204 }));
}

export async function POST(request: NextRequest) {
  const body = (await request.json()) as CapturePayload;
  const session = await getCaptureSession(body.sessionId);

  if (!session) {
    return withCors(
      NextResponse.json({ error: "Unknown capture session." }, { status: 404 }),
    );
  }

  const payload = sanitizeCapturePayload({
    ...body,
    mediaCandidates: uniqueByUrl(body.mediaCandidates ?? []),
    subtitleTracks: uniqueByUrl(body.subtitleTracks ?? []),
  });

  if (!payload.pageUrl || !Array.isArray(payload.mediaCandidates)) {
    return withCors(
      NextResponse.json({ error: "Invalid capture payload." }, { status: 400 }),
    );
  }

  const next = await ingestCapturePayload(payload);
  return withCors(NextResponse.json({ ok: true, session: next }));
}
