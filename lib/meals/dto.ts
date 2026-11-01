// Database rows to the DTOs of lib/contracts/meals.ts.
import type { mealItems, mealPhotos, meals } from "@/db/schema";
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
  itemCount: number,
): MealSummaryDto => {
  const questions = toQuestionDtos(row);
  return {
    id: row.id,
    eatenAt: row.eatenAt.toISOString(),
    tz: row.tz,
    localDate: row.localDate,
    localTime: localParts(row.eatenAt, row.tz).time,
    slot: row.slot,
    title: row.title,
    note: row.note,
    status: row.status,
    source: row.source,
    error: toErrorDto(row.error),
    photos: [...photos].sort((a, b) => a.position - b.position).map(toPhotoDto),
    itemCount,
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
  ...toSummaryDto(row, photos, items.length),
  items: items
    .map(({ row: item, foodName }) => toItemDto(item, foodName))
    .sort((a, b) => a.position - b.position),
  questions: toQuestionDtos(row),
});
