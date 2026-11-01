// Seeds shared dishes (docs/DESIGN.md section 5): composite foods of kind "dish" made of
// FoodData Central components, nutrients computed from them, each marked "recipe estimate" with
// its source. Run through the server tool after "cal import-fdc":
//
//   cal seed-dishes                    the Persian dishes in scripts/data/persian-dishes.json
//   cal seed-dishes --file other.json  another file in the same format
//
// Upserts are keyed by (source "dish", key), so running it again updates the dishes in place.
// Components refer to SR Legacy foods by FDC ID (that dataset is frozen, so the IDs never change).
import { readFile } from "node:fs/promises";

import { computeDish } from "../lib/food/dish-core.ts";
import { foodSearchText } from "../lib/food/normalize.ts";

import persianDishes from "./data/persian-dishes.json" with { type: "json" };
import { seedNutrientCatalogue } from "./lib/reference.mjs";

class SeedError extends Error {}

const COMPONENT_SOURCE = "fdc_sr_legacy";

const parseArgs = (argv) => {
  const options = { file: null };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--file") options.file = argv[++i];
    else throw new SeedError(`Unknown option ${argv[i]}. Options: --file PATH`);
  }
  return options;
};

const validate = (data) => {
  if (!data || !Array.isArray(data.dishes)) throw new SeedError("The file has no dishes list.");
  const keys = new Set();
  for (const dish of data.dishes) {
    const where = `Dish "${dish.key ?? dish.nameEn ?? "?"}"`;
    if (!/^[a-z0-9-]{2,60}$/.test(dish.key ?? "")) throw new SeedError(`${where}: bad key.`);
    if (keys.has(dish.key)) throw new SeedError(`${where}: key used twice.`);
    keys.add(dish.key);
    if (!dish.nameEn || !dish.nameFa) throw new SeedError(`${where}: needs nameEn and nameFa.`);
    if (!dish.source) throw new SeedError(`${where}: needs its source.`);
    if (!(dish.servingGrams > 0)) throw new SeedError(`${where}: needs servingGrams.`);
    if (!Array.isArray(dish.components) || !dish.components.length)
      throw new SeedError(`${where}: needs components.`);
    for (const c of dish.components)
      if (!Number.isInteger(c.fdc) || !(c.grams > 0))
        throw new SeedError(`${where}: every component needs an FDC ID and grams.`);
  }
  return data.dishes;
};

const round = (value, digits = 0) => {
  const factor = 10 ** digits;
  return Math.round((value ?? 0) * factor) / factor;
};

/** cal seed-dishes: the hook scripts/cal.mjs calls. */
export const run = async (pool, argv = [], out = console.log) => {
  const options = parseArgs(argv);
  const data = options.file ? JSON.parse(await readFile(options.file, "utf8")) : persianDishes;
  const dishes = validate(data);
  await seedNutrientCatalogue(pool);

  // The components, all at once.
  const ids = [...new Set(dishes.flatMap((d) => d.components.map((c) => String(c.fdc))))];
  const { rows: found } = await pool.query(
    `select id, source_id, name_en, nutrients from foods
      where source = $1 and owner_id is null and source_id = any($2::text[])`,
    [COMPONENT_SOURCE, ids],
  );
  const byFdc = new Map(found.map((row) => [row.source_id, row]));
  const missing = ids.filter((id) => !byFdc.has(id));
  if (missing.length)
    throw new SeedError(
      `${missing.length} component foods are not in the database (FDC ${missing.slice(0, 8).join(", ")}${missing.length > 8 ? ", ..." : ""}). Run "cal import-fdc" first.`,
    );

  const report = [];
  const client = await pool.connect();
  try {
    await client.query("begin");
    for (const dish of dishes) {
      const parts = dish.components.map((c) => ({
        food: byFdc.get(String(c.fdc)),
        grams: c.grams,
        note: c.as ?? null,
      }));
      const computed = computeDish(
        parts.map((p) => ({ grams: p.grams, per100g: p.food.nutrients })),
        dish.servingGrams,
      );
      const synonyms = (dish.synonyms ?? []).map(String);
      const sourceNote = `Recipe estimate. ${dish.source} Nutrients computed from USDA FoodData Central (SR Legacy) components.`;
      const { rows } = await client.query(
        `insert into foods (source, source_id, kind, name_en, name_fa, synonyms, category, nutrients,
                            density_g_per_ml, serving_grams, source_note, data_release, search_text)
         values ('dish', $1, 'dish', $2, $3, $4::text[], $5, $6::jsonb, $7, $8, $9, $10, $11)
         on conflict (source, source_id) where source_id is not null and owner_id is null
         do update set kind = 'dish', name_en = excluded.name_en, name_fa = excluded.name_fa,
                       synonyms = excluded.synonyms, category = excluded.category,
                       nutrients = excluded.nutrients, density_g_per_ml = excluded.density_g_per_ml,
                       serving_grams = excluded.serving_grams, source_note = excluded.source_note,
                       data_release = excluded.data_release, search_text = excluded.search_text,
                       updated_at = now()
         returning id`,
        [
          dish.key,
          dish.nameEn,
          dish.nameFa,
          synonyms,
          dish.category ?? null,
          JSON.stringify(computed.per100g),
          dish.densityGPerMl ?? null,
          computed.servingGrams,
          sourceNote,
          `dishes v${data.version ?? 1}`,
          foodSearchText({ nameEn: dish.nameEn, nameFa: dish.nameFa, synonyms }),
        ],
      );
      const dishId = rows[0].id;
      await client.query("delete from dish_components where dish_id = $1", [dishId]);
      await client.query(
        `insert into dish_components (dish_id, component_id, grams, position, note)
         select $1, (r->>'component_id')::uuid, (r->>'grams')::real, (r->>'position')::int, r->>'note'
           from jsonb_array_elements($2::jsonb) r`,
        [
          dishId,
          JSON.stringify(
            parts.map((p, position) => ({
              component_id: p.food.id,
              grams: p.grams,
              position,
              note: p.note,
            })),
          ),
        ],
      );
      await client.query("delete from food_portions where food_id = $1", [dishId]);
      const portions = dish.portions?.length
        ? dish.portions
        : [{ label: "1 serving", labelFa: "۱ پرس", grams: computed.servingGrams }];
      await client.query(
        `insert into food_portions (food_id, label, label_fa, amount, unit, grams, position)
         select $1, r->>'label', r->>'labelFa', 1, 'portion', (r->>'grams')::real, (r->>'position')::int
           from jsonb_array_elements($2::jsonb) r`,
        [dishId, JSON.stringify(portions.map((p, position) => ({ ...p, position })))],
      );
      const kcal = computed.perServing.energy ?? 0;
      const [low, high] = dish.expectedKcal ?? [null, null];
      report.push({
        key: dish.key,
        name: dish.nameEn,
        servingGrams: computed.servingGrams,
        kcal: round(kcal),
        protein: round(computed.perServing.protein, 1),
        carbs: round(computed.perServing.carbs, 1),
        fat: round(computed.perServing.fat, 1),
        kcalPer100g: round(computed.per100g.energy),
        expected: low === null ? null : [low, high],
        plausible: low === null ? null : kcal >= low && kcal <= high,
      });
    }
    await client.query("commit");
  } catch (error) {
    await client.query("rollback").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }

  for (const r of report)
    out(
      `${r.name.padEnd(64)} ${String(r.servingGrams).padStart(4)} g  ${String(r.kcal).padStart(4)} kcal  P ${r.protein}  C ${r.carbs}  F ${r.fat}${r.expected ? `  (expected ${r.expected[0]}-${r.expected[1]}${r.plausible ? "" : ", OUTSIDE"})` : ""}`,
    );
  const outside = report.filter((r) => r.plausible === false);
  out(
    `${report.length} dishes seeded.${outside.length ? ` ${outside.length} outside their expected range: ${outside.map((r) => r.key).join(", ")}.` : ""}`,
  );
  return { dishes: report };
};
