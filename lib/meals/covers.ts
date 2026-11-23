// The pictures of a few meals for list rows (Trends' most and least nutritious, the suggestions):
// the cover photo's thumbnail and the foods with their emoji, read for the shown meals only.
import { and, eq, inArray } from "drizzle-orm";

import { db as defaultDb, type DbOrTx } from "@/db";
import { foods, mealItems, mealPhotos } from "@/db/schema";
import type { MealFoodDto } from "@/lib/contracts/meals";
import { emojiFor } from "@/lib/food/emoji";

import { photoUrl } from "./dto";
import { isDrink } from "./hydration";

/** The cover photo (position 0) and the foods of a few meals, for a list row's picture. */
export const mealCovers = async (userId: string, ids: string[], dbx: DbOrTx = defaultDb) => {
  if (!ids.length) return new Map<string, { photoUrl: string | null; foods: MealFoodDto[] }>();
  const [photos, items] = await Promise.all([
    dbx
      .select({ id: mealPhotos.id, mealId: mealPhotos.mealId, position: mealPhotos.position })
      .from(mealPhotos)
      .where(and(inArray(mealPhotos.mealId, ids), eq(mealPhotos.userId, userId))),
    dbx
      .select({
        mealId: mealItems.mealId,
        position: mealItems.position,
        name: mealItems.name,
        localName: mealItems.localName,
        kind: mealItems.kind,
        emoji: mealItems.emoji,
        foodName: foods.nameEn,
      })
      .from(mealItems)
      .leftJoin(foods, eq(foods.id, mealItems.foodId))
      .where(and(inArray(mealItems.mealId, ids), eq(mealItems.userId, userId))),
  ]);
  return new Map(
    ids.map((id) => {
      const cover = photos
        .filter((p) => p.mealId === id)
        .sort((a, b) => a.position - b.position)[0];
      const own = items.filter((i) => i.mealId === id).sort((a, b) => a.position - b.position);
      return [
        id,
        {
          photoUrl: cover ? photoUrl(cover.id, "thumb") : null,
          foods: own.map((item) => ({
            name: item.name,
            emoji: item.emoji ?? emojiFor(item.name, item.kind, [item.foodName, item.localName]),
            drink: isDrink(item),
          })),
        },
      ];
    }),
  );
};
