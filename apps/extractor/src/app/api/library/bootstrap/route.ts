import { NextResponse } from "next/server";
import { bootstrapLibrary } from "@/server/app-store";

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as { libraryToken?: string | null } | null;
  const library = await bootstrapLibrary(body?.libraryToken);

  return NextResponse.json({
    libraryToken: library.token,
  });
}
