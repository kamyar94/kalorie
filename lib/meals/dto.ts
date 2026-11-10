// Database rows to the DTOs of lib/contracts/meals.ts.
import type { mealItems, mealPhotos, meals } from "@/db/schema";
import { emojiFor } from "@/lib/food/emoji";
import { isDrink, totalWaterMl } from "@/lib/meals/hydration";
import type {
  MealDto,
  MealErrorDto,
  MealItemDto,
  MealPhotoDto,
  MealQuestionDto,
  MealSummaryDto,
} from "@/lib/contracts/meals";

import { localParts } from "./time";

type MealRow = typeof meals.$inferSelect;
type PhotoRow = typeof mealPhotos.$inferSelect;
type ItemRow = typeof mealItems.$inferSelect;

/** The item columns a meal summary needs (the timeline line and the plate icon). */
export type SummaryItemRow = Pick<
  ItemRow,
  "position" | "name" | "localName" | "kind" | "emoji" | "ml" | "grams" | "count" | "nutrients"
> & {
  foodName: string | null;
};

const itemEmoji = (row: SummaryItemRow) =>
  row.emoji ?? emojiFor(row.name, row.kind, [row.foodName, row.localName]);

export const photoUrl = (photoId: string, size: "thumb" | "analysis" | "original") =>
  `/api/photos/${photoId}/${size}`;

export const toPhotoDto = (row: PhotoRow): MealPhotoDto => ({
  id: row.id,
  position: row.position,
  width: row.width,
  height: row.height,
  urls: {
    thumb: photoUrl(row.id, "thumb"),
    analysis: photoUrl(row.id, "analysis"),
    original: photoUrl(row.id, "original"),
  },
});

// Error kinds the person fixes in the AI settings (same list as needsAiSettings in lib/ai/errors).
const SETTINGS_KINDS = new Set(["no-key", "auth", "quota", "config"]);

export const toErrorDto = (error: MealRow["error"]): MealErrorDto | null =>
  error
    ? {
        kind: error.kind,
        message: error.message,
        settingsLink: SETTINGS_KINDS.has(error.kind),
      }
    : null;

export const toQuestionDtos = (row: MealRow): MealQuestionDto[] =>
  (row.questions ?? []).map((q) => ({
    id: q.id,
    text: q.text,
    answers: q.answers ?? [],
    answer: q.answer ?? null,
  }));

export const toItemDto = (row: ItemRow, foodName: string | null = null): MealItemDto => ({
  id: row.id,
  mealId: row.mealId,
  position: row.position,
  name: row.name,
  localName: row.localName,
  kind: row.kind,
  // Rows from before emojis were stored get one from their names.
  emoji: itemEmoji({ ...row, foodName }),
  preparation: row.preparation,
  foodId: row.foodId,
  foodName,
  grams: row.grams,
  ml: row.ml,
  portionText: row.portionText,
  count: row.count,
  modelGrams: row.modelGrams,
  gramsLow: row.gramsLow,
  gramsHigh: row.gramsHigh,
  confidence: row.confidence,
  edited: row.edited,
  nutrients: row.nutrients ?? {},
  nutrientSource: row.nutrientSource,
  components: (row.components ?? []).map((c) => ({
    name: c.name,
    grams: c.grams,
    foodId: c.foodId ?? null,
    nutrients: c.nutrients ?? {},
  })),
});

export const toSummaryDto = (
  row: MealRow,
  photos: PhotoRow[],
  items: SummaryItemRow[],
): MealSummaryDto => {
  const questions = toQuestionDtos(row);
  const sorted = [...items].sort((a, b) => a.position - b.position);
  return {
    id: row.id,
    eatenAt: row.eatenAt.toISOString(),
    tz: row.tz,
    localDate: row.localDate,
    localTime: localParts(row.eatenAt, row.tz).time,
    slot: row.slot,
    slotLocked: row.slotLocked,
    title: row.title,
    note: row.note,
    status: row.status,
    source: row.source,
    error: toErrorDto(row.error),
    photos: [...photos].sort((a, b) => a.position - b.position).map(toPhotoDto),
    itemCount: items.length,
    foods: sorted.map((item) => ({
      name: item.name,
      emoji: itemEmoji(item),
      drink: isDrink(item),
    })),
    waterMl: totalWaterMl(sorted),
    openQuestions: questions.filter((q) => !q.answer).length,
    totals: row.totals ?? {},
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
};

export const toMealDto = (
  row: MealRow,
  photos: PhotoRow[],
  items: { row: ItemRow; foodName: string | null }[],
): MealDto => ({
  ...toSummaryDto(
    row,
    photos,
    items.map(({ row: item, foodName }) => ({ ...item, foodName })),
  ),
  items: items
    .map(({ row: item, foodName }) => toItemDto(item, foodName))
    .sort((a, b) => a.position - b.position),
  questions: toQuestionDtos(row),
});
