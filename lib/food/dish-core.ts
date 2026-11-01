// Dish nutrients from components, shared by the app (lib/food/dishes.ts) and the Node scripts
// (scripts/seed-dishes.mjs, scripts/fdc-import.mjs). Node runs this file directly with its type
// stripping, so it has no runtime imports (type-only imports are erased) and plain syntax only.
//
// A dish is a food of kind "dish" made of components (food id + grams in one serving).
// servingGrams is the finished serving's weight; when cooking loses or gains water it differs
// from the components' sum, and the difference is booked to the water value.
import type { NutrientMap } from "../contracts/nutrients";

export type DishPart = { grams: number; per100g: NutrientMap };

export type DishNutrients = {
  /** Values per 100 g of the finished dish. */
  per100g: NutrientMap;
  /** Values for one serving. */
  perServing: NutrientMap;
  /** Weight of one serving as eaten. */
  servingGrams: number;
  /** Sum of the components' weights. */
  componentGrams: number;
};

const finite = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);

/** Keeps stored maps small: 4 decimal places are far below any value shown. */
export const tidy = (value: number) => Math.round(value * 10_000) / 10_000;

/** Nutrients of a dish from its parts. servingGrams null or 0 means the parts' sum. */
export const computeDish = (parts: DishPart[], servingGrams?: number | null): DishNutrients => {
  let componentGrams = 0;
  const totals: NutrientMap = {};
  for (const part of parts) {
    if (!finite(part.grams) || part.grams <= 0) continue;
    componentGrams += part.grams;
    for (const [code, value] of Object.entries(part.per100g ?? {}))
      if (finite(value)) totals[code] = (totals[code] ?? 0) + (value * part.grams) / 100;
  }
  const serving = finite(servingGrams) && servingGrams > 0 ? servingGrams : componentGrams;
  if (serving > 0 && finite(totals.water) && serving !== componentGrams)
    totals.water = Math.max(0, totals.water + serving - componentGrams);
  const perServing: NutrientMap = {};
  const per100g: NutrientMap = {};
  for (const [code, value] of Object.entries(totals)) {
    perServing[code] = tidy(value);
    if (serving > 0) per100g[code] = tidy((value * 100) / serving);
  }
  return { per100g, perServing, servingGrams: tidy(serving), componentGrams: tidy(componentGrams) };
};

/** Runs one SQL statement with $1.. parameters and returns its rows (pg Pool or a Drizzle adapter). */
export type QueryRows = (text: string, params: unknown[]) => Promise<Record<string, unknown>[]>;

/**
 * Recomputes the stored nutrients of every dish that uses one of these foods, directly or through
 * another dish, components before the dishes made of them, plus the dishes in alsoDishes
 * themselves. null recomputes every dish. Serving weights stay as they are. Returns the number
 * of dishes updated.
 */
export const recomputeDishes = async (
  query: QueryRows,
  changedFoodIds: string[] | null,
  alsoDishes: string[] = [],
): Promise<number> => {
  // 1. The dishes affected.
  const affected = new Set<string>(alsoDishes);
  if (changedFoodIds === null) {
    for (const row of await query("select distinct dish_id from dish_components", []))
      affected.add(String(row.dish_id));
  } else {
    let frontier = [...new Set([...changedFoodIds, ...alsoDishes])];
    for (let depth = 0; frontier.length && depth < 20; depth++) {
      const rows = await query(
        "select distinct dish_id from dish_components where component_id = any($1::uuid[])",
        [frontier],
      );
      frontier = [];
      for (const row of rows) {
        const id = String(row.dish_id);
        if (!affected.has(id)) {
          affected.add(id);
          frontier.push(id);
        }
      }
    }
  }
  if (!affected.size) return 0;

  // 2. Their components and serving weights.
  const ids = [...affected];
  const parts = await query(
    `select dc.dish_id, dc.component_id, dc.grams, c.nutrients
       from dish_components dc join foods c on c.id = dc.component_id
      where dc.dish_id = any($1::uuid[])
      order by dc.dish_id, dc.position, dc.id`,
    [ids],
  );
  const servings = new Map<string, number | null>();
  for (const row of await query("select id, serving_grams from foods where id = any($1::uuid[])", [
    ids,
  ]))
    servings.set(String(row.id), row.serving_grams === null ? null : Number(row.serving_grams));

  const byDish = new Map<string, { componentId: string; grams: number; per100g: NutrientMap }[]>();
  for (const row of parts) {
    const list = byDish.get(String(row.dish_id)) ?? [];
    list.push({
      componentId: String(row.component_id),
      grams: Number(row.grams),
      per100g: (row.nutrients ?? {}) as NutrientMap,
    });
    byDish.set(String(row.dish_id), list);
  }

  // 3. Components first (a dish made of other affected dishes waits for them). A cycle, which
  // the services refuse to create, is left as it is.
  const fresh = new Map<string, NutrientMap>();
  let pending = ids.filter((id) => byDish.has(id));
  let updated = 0;
  while (pending.length) {
    const ready = pending.filter((id) =>
      (byDish.get(id) ?? []).every((p) => !affected.has(p.componentId) || fresh.has(p.componentId)),
    );
    if (!ready.length) break;
    for (const id of ready) {
      const list = byDish.get(id) ?? [];
      const result = computeDish(
        list.map((p) => ({ grams: p.grams, per100g: fresh.get(p.componentId) ?? p.per100g })),
        servings.get(id),
      );
      fresh.set(id, result.per100g);
      await query(
        "update foods set nutrients = $2::jsonb, serving_grams = $3, updated_at = now() where id = $1",
        [id, JSON.stringify(result.per100g), result.servingGrams],
      );
      updated++;
    }
    pending = pending.filter((id) => !fresh.has(id));
  }
  return updated;
};
