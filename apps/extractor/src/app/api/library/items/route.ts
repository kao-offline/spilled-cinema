import { NextRequest, NextResponse } from "next/server";
import { createMediaItem, listMediaItems } from "@/server/app-store";
import type { MediaItem } from "@/lib/types";

export async function GET(request: NextRequest) {
  const libraryToken = request.nextUrl.searchParams.get("libraryToken");
  if (!libraryToken) {
    return NextResponse.json({ error: "Library token is required." }, { status: 400 });
  }

  const items = await listMediaItems(libraryToken);
  return NextResponse.json({ items });
}

type CreateMediaItemRequest = Omit<
  MediaItem,
  "id" | "createdAt" | "updatedAt" | "resumePositionSeconds"
>;

export async function POST(request: NextRequest) {
  const body = (await request.json()) as Partial<CreateMediaItemRequest>;

  if (!body.libraryToken || !body.title || !body.sourcePageUrl || !body.playback?.primaryUrl) {
    return NextResponse.json({ error: "Invalid media item payload." }, { status: 400 });
  }

  const item = await createMediaItem({
    libraryToken: body.libraryToken,
    title: body.title,
    sourcePageUrl: body.sourcePageUrl,
    sourceHost: body.sourceHost ?? "unknown-source",
    posterUrl: body.posterUrl,
    playback: body.playback,
    tags: body.tags ?? [],
    durationSeconds: body.durationSeconds,
  });

  return NextResponse.json({ item }, { status: 201 });
}
