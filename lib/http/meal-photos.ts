// Shared parts of the meal photo routes (POST/PATCH /api/meals/:id/photos and
// DELETE /api/meals/:id/photos/:photoId): the answer for a result and the rate limit.
import type { MealPhotosResult } from "@/lib/meals/photos";
import { takeRateLimit, uploadWindows } from "@/lib/rate-limit";

import { errorJson, json } from "./route";

export const photosResponse = (result: MealPhotosResult, status = 200) =>
  result.ok
    ? json(
        { meal: result.meal, reanalysed: result.reanalysed, notice: result.notice },
        { status, headers: { "cache-control": "no-store" } },
      )
    : errorJson(result.status, result.error);

/** The same limits as uploads, counted apart so editing photos does not use up uploads. */
export const takePhotoEdit = async (userId: string) => {
  const limit = await takeRateLimit(`meal-photos:${userId}`, uploadWindows());
  return limit.ok
    ? null
    : errorJson(429, "Too many photo changes in a short time. Try again later.", {
        "retry-after": String(limit.retryAfter),
      });
};
