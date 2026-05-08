import { NextRequest, NextResponse } from "next/server";
import { getCaptureSession, markSessionSaved } from "@/server/app-store";

export async function GET(
  _: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const session = await getCaptureSession(id);

  if (!session) {
    return NextResponse.json({ error: "Capture session not found." }, { status: 404 });
  }

  return NextResponse.json({ session });
}

export async function PATCH(
  _: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const session = await markSessionSaved(id);

  if (!session) {
    return NextResponse.json({ error: "Capture session not found." }, { status: 404 });
  }

  return NextResponse.json({ session });
}
