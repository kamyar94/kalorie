// DELETE /api/meals/:id/photos/:photoId?reanalyse=true -> { meal, reanalysed, notice }
// Removes one photo of the signed-in person's meal: the row first, then its files. The meal and
// its items stay, also when it was the last photo. reanalyse (default false) analyses the meal
// again from the photos left. Rate limited like uploads; another person's meal answers 404.
import type { NextRequest } from "next/server";

import { photosResponse, takePhotoEdit } from "@/lib/http/meal-photos";
import { apiUser } from "@/lib/http/route";
import { removeMealPhoto } from "@/lib/meals/photos";

export const dynamic = "force-dynamic";

export const DELETE = async (
  req: NextRequest,
  { params }: { params: Promise<{ id: string; photoId: string }> },
) => {
  const { user, error } = await apiUser(req);
  if (error) return error;
  const limited = await takePhotoEdit(user.id);
  if (limited) return limited;
  const { id, photoId } = await params;
  return photosResponse(
    await removeMealPhoto(user.id, id, photoId, {
      reanalyse: req.nextUrl.searchParams.get("reanalyse") === "true",
    }),
  );
};
