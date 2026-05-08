import { NextRequest, NextResponse } from "next/server";
import { getMediaItem, updateMediaProgress } from "@/server/app-store";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const libraryToken = request.nextUrl.searchParams.get("libraryToken");

  if (!libraryToken) {
    return NextResponse.json({ error: "Library token is required." }, { status: 400 });
  }

  const item = await getMediaItem(id, libraryToken);
  if (!item) {
    return NextResponse.json({ error: "Media item not found." }, { status: 404 });
  }

  return NextResponse.json({ item });
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const body = (await request.json()) as {
    libraryToken?: string;
    resumePositionSeconds?: number;
  };

  if (!body.libraryToken || typeof body.resumePositionSeconds !== "number") {
    return NextResponse.json({ error: "Invalid progress payload." }, { status: 400 });
  }

  const item = await updateMediaProgress(id, body.libraryToken, body.resumePositionSeconds);
  if (!item) {
    return NextResponse.json({ error: "Media item not found." }, { status: 404 });
  }

  return NextResponse.json({ item });
}
