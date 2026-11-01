// FoodData Central import and the dish seed, on the fixture extracts.
import path from "node:path";

import { and, eq, sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { db, getPool } from "@/db";
import { dishComponents, driTargets, foodPortions, foods, nutrients } from "@/db/schema";
import { NUTRIENT_CATALOGUE } from "@/lib/contracts/nutrients";
import { recomputeDishesUsing } from "@/lib/food/dishes";
import { run as importFdc } from "@/scripts/fdc-import.mjs";
import dishFile from "@/scripts/data/persian-dishes.json";

import { FDC_FIXTURES, importFdcFixtures, seedDishFixtures } from "../helpers/food-data";

const bySource = async (source: (typeof foods.$inferSelect)["source"], sourceId: string) =>
  (
    await db
      .select()
      .from(foods)
      .where(and(eq(foods.source, source), eq(foods.sourceId, sourceId)))
  )[0];

describe("FoodData Central import", () => {
  it("imports the three releases, idempotently", async () => {
    const first = await importFdcFixtures();
    const counts = Object.fromEntries(
      first.result.results.map((r: { dataset: string }) => [r.dataset, r]),
    );
    // Foundation: 5 foods; the sample row in food.csv is skipped.
    expect(counts.foundation).toMatchObject({ foods: 5, inserted: 5, updated: 0 });
    expect(counts.sr_legacy).toMatchObject({ foods: 64, inserted: 64 });
    expect(counts.fndds).toMatchObject({ foods: 13, inserted: 13 });

    const second = await importFdcFixtures();
    for (const r of second.result.results) expect(r).toMatchObject({ inserted: 0, stale: 0 });
    const [{ n }] = (await db.execute(sql`select count(*)::int as n from foods`)).rows as [
      { n: number },
    ];
    expect(n).toBe(82);
    const portions = await db.select().from(foodPortions);
    expect(portions.length).toBe(
      second.result.results.reduce((sum: number, r: { portions: number }) => sum + r.portions, 0),
    );

    // Reference tables.
    expect(await db.select().from(nutrients)).toHaveLength(NUTRIENT_CATALOGUE.length);
    expect((await db.select().from(driTargets)).length).toBeGreaterThan(200);
  });

  it("maps nutrients per 100 g, keeps every value, and reads survey nutrient numbers", async () => {
    await importFdcFixtures();
    // SR Legacy cooked white rice.
    const rice = (await bySource("fdc_sr_legacy", "168878"))!;
    expect(rice.nameEn).toBe("Rice, white, long-grain, regular, enriched, cooked");
    expect(rice.category).toBe("Cereal Grains and Pasta");
    expect(rice.nutrients.energy).toBe(130);
    expect(rice.nutrients.protein).toBeCloseTo(2.69);
    expect(rice.nutrients["fdc:1062"]).toBeGreaterThan(500); // kJ kept
    expect(rice.sourceNote).toMatch(/FDC ID 168878/);
    expect(rice.searchText).toBe("rice white long grain regular enriched cooked");

    // FNDDS uses nutrient numbers (208 = energy) in food_nutrient: mapped to the ids.
    const fndds = (await bySource("fdc_fndds", "2708408"))!;
    expect(fndds.nameEn).toBe("Rice, white, cooked, no added fat");
    expect(fndds.category).toBe("Rice");
    expect(fndds.nutrients.energy).toBeCloseTo(129, 0);
    expect(fndds.nutrients.folate).toBeGreaterThan(0);
    expect(fndds.synonyms).toContain("basmati or jasmine rice");
    const fnddsPortions = await db
      .select()
      .from(foodPortions)
      .where(eq(foodPortions.foodId, fndds.id));
    expect(fnddsPortions.map((p) => p.label)).toContain("1 cup, cooked");

    // A Foundation food with minerals only keeps them and has no energy.
    const tortilla = (await bySource("fdc_foundation", "2758997"))!;
    expect(tortilla.nutrients.energy).toBeUndefined();
    expect(tortilla.nutrients.iron).toBeGreaterThan(0);
    // The administrative note leaves SR names.
    const dates = (await bySource("fdc_sr_legacy", "168165"))!;
    expect(dates.nameEn).toBe("Raisins, dark, seedless");
  });

  it("removes foods a release no longer has only with --prune, and never dish components", async () => {
    await importFdcFixtures();
    const pool = getPool();
    await pool.query(
      `insert into foods (source, source_id, name_en, nutrients, search_text)
       values ('fdc_fndds', '1', 'Old survey food', '{"energy": 1}', 'old survey food'),
              ('fdc_fndds', '2', 'Old component', '{"energy": 1}', 'old component')`,
    );
    const component = (await bySource("fdc_fndds", "2"))!;
    const [dish] = await db
      .insert(foods)
      .values({
        source: "dish",
        sourceId: "t",
        kind: "dish",
        nameEn: "Test dish",
        servingGrams: 10,
      })
      .returning();
    await db
      .insert(dishComponents)
      .values({ dishId: dish!.id, componentId: component.id, grams: 10 });

    const lines: string[] = [];
    const kept = await importFdc(
      pool,
      ["--only", "fndds", "--dir", `fndds=${path.join(FDC_FIXTURES, "fndds")}`],
      (l: string) => lines.push(l),
    );
    expect(kept.results[0]).toMatchObject({ stale: 2, pruned: 0 });
    expect(lines.join("\n")).toMatch(/no longer in the release/);

    const pruned = await importFdc(
      pool,
      ["--only", "fndds", "--prune", "--dir", `fndds=${path.join(FDC_FIXTURES, "fndds")}`],
      () => undefined,
    );
    expect(pruned.results[0]).toMatchObject({ pruned: 1, stale: 1 });
    expect(await bySource("fdc_fndds", "1")).toBeUndefined();
    expect(await bySource("fdc_fndds", "2")).toBeDefined();
  });

  it("checks a given ZIP against the pinned SHA-256 and needs a cache folder to download", async () => {
    const pool = getPool();
    const file = path.join(FDC_FIXTURES, "sr_legacy", "food.csv");
    await expect(
      importFdc(pool, ["--only", "sr_legacy", "--zip", `sr_legacy=${file}`], () => undefined),
    ).rejects.toThrow(/SHA-256 differs/);
    const saved = process.env.FDC_CACHE_DIR;
    delete process.env.FDC_CACHE_DIR;
    try {
      await expect(importFdc(pool, ["--only", "sr_legacy"], () => undefined)).rejects.toThrow(
        /FDC_CACHE_DIR/,
      );
    } finally {
      if (saved !== undefined) process.env.FDC_CACHE_DIR = saved;
    }
  });
});

describe("Persian dish seed", () => {
  it("seeds every dish with components, Persian names, sources and plausible energy", async () => {
    await importFdcFixtures();
    const { result, lines } = await seedDishFixtures();
    expect(result.dishes).toHaveLength(dishFile.dishes.length);
    expect(dishFile.dishes.length).toBeGreaterThanOrEqual(19);
    for (const dish of result.dishes) expect(dish.plausible).toBe(true);
    expect(lines.at(-1)).toMatch(/dishes seeded\.$/);

    const required = [
      "ghormeh-sabzi",
      "gheymeh",
      "fesenjan",
      "kabab-koobideh",
      "joojeh-kabab",
      "chelow",
      "tahdig",
      "zereshk-polo",
      "sabzi-polo",
      "adas-polo",
      "ash-reshteh",
      "kashk-bademjan",
      "mirza-ghasemi",
      "kuku-sabzi",
      "kotlet",
      "olivieh",
      "shirazi-salad",
      "sholeh-zard",
      "doogh",
    ];
    // Only the seeded rows (another test in this file adds a dish of its own).
    const keys = new Set(dishFile.dishes.map((d) => d.key));
    const rows = (await db.select().from(foods).where(eq(foods.source, "dish"))).filter((r) =>
      keys.has(r.sourceId!),
    );
    expect(rows).toHaveLength(keys.size);
    expect(rows.map((r) => r.sourceId)).toEqual(expect.arrayContaining(required));
    for (const row of rows) {
      expect(row.kind).toBe("dish");
      expect(row.nameFa).toBeTruthy();
      expect(row.sourceNote).toMatch(/^Recipe estimate\./);
      expect(row.nutrients.energy).toBeGreaterThan(0);
    }

    const ghormeh = rows.find((r) => r.sourceId === "ghormeh-sabzi")!;
    const parts = await db
      .select()
      .from(dishComponents)
      .where(eq(dishComponents.dishId, ghormeh.id));
    const ghormehData = dishFile.dishes.find((d) => d.key === "ghormeh-sabzi")!;
    expect(parts).toHaveLength(ghormehData.components.length);
    const kcalServing = (ghormeh.nutrients.energy! * ghormeh.servingGrams!) / 100;
    expect(kcalServing).toBeGreaterThan(280);
    expect(kcalServing).toBeLessThan(480);

    // Running it again changes nothing in shape.
    const before = (await db.select().from(foods).where(eq(foods.source, "dish"))).length;
    await seedDishFixtures();
    expect(await db.select().from(foods).where(eq(foods.source, "dish"))).toHaveLength(before);
  });

  it("recomputes dishes when a component's values change (also on a new FDC import)", async () => {
    await importFdcFixtures();
    await seedDishFixtures();
    const doogh = (await bySource("dish", "doogh"))!;
    const yogurt = (await bySource("fdc_sr_legacy", "171284"))!;
    await db
      .update(foods)
      .set({ nutrients: { ...yogurt.nutrients, energy: yogurt.nutrients.energy! * 2 } })
      .where(eq(foods.id, yogurt.id));
    expect(await recomputeDishesUsing([yogurt.id])).toBeGreaterThanOrEqual(1);
    const doubled = (await bySource("dish", "doogh"))!;
    expect(doubled.nutrients.energy).toBeGreaterThan(doogh.nutrients.energy! * 1.8);

    // The importer restores the yogurt and recomputes every dish.
    const again = await importFdcFixtures();
    expect(again.result.dishes).toBeGreaterThanOrEqual(dishFile.dishes.length);
    expect((await bySource("dish", "doogh"))!.nutrients.energy).toBeCloseTo(
      doogh.nutrients.energy!,
      3,
    );
  });
});
