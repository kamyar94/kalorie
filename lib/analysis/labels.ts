// A readable nutrition label becomes one of the person's own foods (source "ai", kind "packaged"),
// so the item is counted from the printed facts instead of a guess, and the next photo of the same
// barcode finds it by barcode. One food per person and barcode (or product name without one):
// a later photo updates its values.
import { sql } from "drizzle-orm";

import { db as defaultDb, type DbOrTx } from "@/db";
import { foods } from "@/db/schema";
import type { AnalysisItem, AnalysisLabel } from "@/lib/contracts/analysis";
import type { FoodResult } from "@/lib/contracts/food-search";
import { estimateToNutrients, type NutrientMap } from "@/lib/contracts/nutrients";
import { getFood } from "@/lib/food/search";
import { foodSearchText, normalizeFoodText } from "@/lib/food/normalize";

export const LABEL_SOURCE_NOTE = "Read from the package label in a meal photo";

/** Values per 100 g from a label: as printed per 100 g, or per serving scaled by its grams. */
export const labelPer100g = (label: AnalysisLabel): NutrientMap | null => {
  const per100g = estimateToNutrients(label.per100g);
  if (typeof per100g.energy === "number") return per100g;
  if (label.perServing && label.servingGrams && label.servingGrams > 0) {
    const serving = estimateToNutrients(label.perServing);
    if (typeof serving.energy !== "number") return null;
    const factor = 100 / label.servingGrams;
    return Object.fromEntries(
      Object.entries(serving).map(([code, value]) => [code, value * factor]),
    ) as NutrientMap;
  }
  return null;
};

/** Saves (or refreshes) the person's food for a label; null when the label lacks the energy. */
export const foodFromLabel = async (
  userId: string,
  item: AnalysisItem,
  dbx: DbOrTx = defaultDb,
): Promise<FoodResult | null> => {
  const label = item.label;
  if (!label) return null;
  const per100g = labelPer100g(label);
  if (!per100g) return null;
  const nameKey = normalizeFoodText(item.name).slice(0, 100);
  const sourceId = label.barcode ? `barcode:${label.barcode}` : nameKey ? `name:${nameKey}` : null;
  if (!sourceId) return null;

  const values = {
    source: "ai" as const,
    sourceId,
    ownerId: userId,
    kind: "packaged" as const,
    nameEn: item.name,
    nameFa: item.local_name,
    barcode: label.barcode,
    nutrients: per100g,
    densityGPerMl: null,
    servingGrams: label.servingGrams,
    sourceNote: LABEL_SOURCE_NOTE,
    searchText: foodSearchText({ nameEn: item.name, nameFa: item.local_name }),
  };
  const [row] = await dbx
    .insert(foods)
    .values(values)
    .onConflictDoUpdate({
      target: [foods.ownerId, foods.source, foods.sourceId],
      targetWhere: sql`${foods.sourceId} is not null and ${foods.ownerId} is not null`,
      set: {
        nameEn: values.nameEn,
        nameFa: values.nameFa,
        nutrients: values.nutrients,
        servingGrams: values.servingGrams,
        searchText: values.searchText,
        updatedAt: new Date(),
      },
    })
    .returning({ id: foods.id });
  return row ? getFood(row.id, userId, dbx) : null;
};

/** The same food in memory only, without saving it (the eval script). */
export const labelFood = (item: AnalysisItem): FoodResult | null => {
  const per100g = item.label ? labelPer100g(item.label) : null;
  if (!item.label || !per100g) return null;
  return {
    id: `label:${item.label.barcode ?? normalizeFoodText(item.name)}`,
    source: "ai",
    kind: "packaged",
    nameEn: item.name,
    nameFa: item.local_name,
    brand: null,
    category: null,
    barcode: item.label.barcode,
    per100g,
    densityGPerMl: null,
    servingGrams: item.label.servingGrams,
    portions: [],
    sourceNote: LABEL_SOURCE_NOTE,
    personal: true,
    score: 1,
  };
};
