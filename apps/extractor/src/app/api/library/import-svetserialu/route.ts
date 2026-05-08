import { NextRequest, NextResponse } from "next/server";
import { bootstrapLibrary, upsertMediaItems } from "@/server/app-store";
import { fetchSvetSerialuShow } from "@/server/svetserialu";

export async function POST(request: NextRequest) {
  const body = (await request.json()) as {
    libraryToken?: string;
    slug?: string;
  };

  const slug = body.slug?.trim().toLowerCase();
  if (!slug || !/^[a-z0-9-]+$/.test(slug)) {
    return NextResponse.json({ error: "Provide a valid show slug." }, { status: 400 });
  }

  try {
    const library = await bootstrapLibrary(body.libraryToken);
    const show = await fetchSvetSerialuShow(slug, library.token);
    const imported = await upsertMediaItems(show.items);

    return NextResponse.json({
      libraryToken: library.token,
      show: {
        slug,
        title: show.title,
        altTitle: show.altTitle,
        seasons: show.availableSeasons,
        importedCount: imported.createdCount,
        updatedCount: imported.updatedCount,
        totalItems: imported.items.length,
      },
    });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Failed to import show from svetserialu.to.",
      },
      { status: 500 },
    );
  }
}
