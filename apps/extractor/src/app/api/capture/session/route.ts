import { NextRequest, NextResponse } from "next/server";
import { createBookmarkletHref, createBookmarkletInstructions } from "@/lib/bookmarklet";
import { createCaptureSession } from "@/server/app-store";
import { createId, isHttpUrl } from "@/lib/utils";

export async function POST(request: NextRequest) {
  const body = (await request.json()) as {
    sourcePageUrl?: string;
    libraryToken?: string | null;
  };

  if (!body.sourcePageUrl || !isHttpUrl(body.sourcePageUrl)) {
    return NextResponse.json(
      { error: "A valid http or https source page URL is required." },
      { status: 400 },
    );
  }

  const libraryToken = body.libraryToken ?? createId("lib");
  const session = await createCaptureSession(libraryToken, body.sourcePageUrl);
  const origin = new URL(request.url).origin;
  const bookmarkletHref = createBookmarkletHref({
    appOrigin: origin,
    sessionId: session.id,
  });

  return NextResponse.json({
    sessionId: session.id,
    reviewUrl: `/capture/${session.id}`,
    iframeReviewUrl: `/capture/frame/${session.id}`,
    ...createBookmarkletInstructions({
      sourcePageUrl: body.sourcePageUrl,
      bookmarkletHref,
    }),
  });
}
