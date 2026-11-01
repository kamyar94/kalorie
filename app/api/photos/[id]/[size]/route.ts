// GET /api/photos/:id/:size (thumb | analysis | original): the photo's bytes, only for the person
// whose meal it belongs to. Anyone else gets the same 404 as for an id that does not exist.
import { and, eq, isNull } from "drizzle-orm";
import type { NextRequest } from "next/server";

import { db } from "@/db";
import { mealPhotos, meals } from "@/db/schema";
import { apiUser, errorJson } from "@/lib/http/route";
import { isUuid } from "@/lib/meals/service";
import { readPhotoFile } from "@/lib/photos/storage";

export const dynamic = "force-dynamic";

const COLUMNS = {
  thumb: mealPhotos.thumbPath,
  analysis: mealPhotos.analysisPath,
  original: mealPhotos.originalPath,
} as const;

export const GET = async (
  req: NextRequest,
  { params }: { params: Promise<{ id: string; size: string }> },
) => {
  const { user, error } = await apiUser(req);
  if (error) return error;
  const { id, size } = await params;
  if (!isUuid(id) || !(size in COLUMNS)) return errorJson(404, "Not found.");

  const row = (
    await db
      .select({ path: COLUMNS[size as keyof typeof COLUMNS] })
      .from(mealPhotos)
      .innerJoin(meals, eq(meals.id, mealPhotos.mealId))
      .where(and(eq(mealPhotos.id, id), eq(mealPhotos.userId, user.id), isNull(meals.deletedAt)))
      .limit(1)
  )[0];
  const bytes = row ? await readPhotoFile(row.path) : null;
  if (!bytes) return errorJson(404, "Not found.");

  return new Response(new Uint8Array(bytes), {
    headers: {
      "content-type": "image/jpeg",
      "content-length": String(bytes.length),
      // Photos never change for an id. "private" keeps shared caches out.
      "cache-control": "private, max-age=31536000, immutable",
      "content-disposition": "inline",
    },
  });
};
