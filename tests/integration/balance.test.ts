// Trends "Most and least nutritious" against Postgres (lib/balance/service.ts): the three best and
// three worst meals of a period and of all time from the stored totals, drinks on their own, meals
// still being worked out, failed meals, meals with too few nutrients, deleted meals and someone
// else's meals left out, the covers of the shown meals, and "All time" over thousands of meals.
// The person has no profile, so the targets are the defaults (2,000 kcal and the US Daily
// Values). Dates are fixed and passed in, so nothing depends on when the tests run. Values are
// made up.
import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { db } from "@/db";
import { mealPhotos } from "@/db/schema";
import { balanceRanking, getBalanceRankings, splitRanking } from "@/lib/balance/service";
import type { NutrientMap } from "@/lib/contracts/nutrients";
import { getTargets } from "@/lib/targets/service";
import { createItem, createMeal, createUser } from "@/tests/helpers/factories";

const WEEK = { from: "2026-11-09", to: "2026-11-15" };

/**
 * A meal's totals at `factor` of each nutrient's share for its energy (the default targets),
 * with the limits at `limits` of theirs.
 */
const mix = (energy: number, factor: number, limits = 0.5): NutrientMap => {
  const share = Math.max(energy / 2000, 0.05);
  return {
    energy,
    protein: 50 * share * factor,
    fiber: 28 * share * factor,
    vit_a: 900 * share * factor,
    vit_c: 90 * share * factor,
    vit_e: 15 * share * factor,
    calcium: 1300 * share * factor,
    iron: 18 * share * factor,
    potassium: 4700 * share * factor,
    magnesium: 420 * share * factor,
    fat_sat: 20 * share * limits,
    sugars_added: 50 * share * limits,
    sodium: 2300 * share * limits,
    // Every other FoodData Central value is kept in the totals too; the ranking ignores them.
    "fdc:1110": 3,
  };
};

const meal = (
  userId: string,
  localDate: string,
  title: string,
  totals: NutrientMap,
  values: Parameters<typeof createMeal>[1] = {},
) =>
  createMeal(userId, {
    localDate,
    eatenAt: new Date(`${localDate}T12:30:00Z`),
    tz: "UTC",
    slot: "lunch",
    title,
    totals,
    ...values,
  });

describe("most and least nutritious meals", () => {
  it("ranks the period's judged meals, three each way, and leaves out what cannot be judged", async () => {
    const ann = await createUser();
    const ben = await createUser();
    const { targets } = await getTargets(ann.id);

    const lentils = await meal(ann.id, "2026-11-10", "Lentil stew", mix(600, 1));
    const salad = await meal(ann.id, "2026-11-11", "Bean salad", mix(600, 0.9));
    const oats = await meal(ann.id, "2026-11-12", "Oats with berries", mix(500, 0.8), {
      slot: "breakfast",
    });
    const toast = await meal(ann.id, "2026-11-12", "Cheese toast", mix(600, 0.5, 1.2));
    const pastry = await meal(ann.id, "2026-11-13", "Cream pastry", mix(500, 0.2, 2.5), {
      slot: "snack",
    });
    const chips = await meal(ann.id, "2026-11-14", "Crisps", mix(300, 0.3, 1.8), {
      slot: "snack",
    });
    const feast = await meal(ann.id, "2026-11-15", "Party platter", mix(1600, 0.6, 1.5), {
      slot: "dinner",
    });
    await createItem(ann.id, lentils.id, { name: "Lentils", kind: "dish", emoji: "🍲" });
    await createItem(ann.id, lentils.id, { name: "Tea", kind: "drink" });
    await createItem(ann.id, pastry.id, { name: "Tea", kind: "drink", emoji: "🍵" });
    await createItem(ann.id, pastry.id, { name: "Cream pastry", kind: "dish", emoji: "🥐" });
    await db.insert(mealPhotos).values({
      mealId: salad.id,
      userId: ann.id,
      position: 0,
      originalPath: "x/o.jpg",
      analysisPath: "x/a.jpg",
      thumbPath: "x/t.jpg",
      width: 800,
      height: 600,
      bytes: 1000,
      sha256: "0".repeat(64),
    });

    // Not judged: drinks on their own (not counted as left out), still analysing, failed with
    // its totals, too few nutrients (an AI estimate), and a deleted meal (not counted at all).
    const smoothie = await meal(ann.id, "2026-11-10", "Smoothie", mix(300, 1.5), {
      slot: "drink",
    });
    await createItem(ann.id, smoothie.id, { name: "Smoothie", kind: "drink" });
    await meal(ann.id, "2026-11-11", "Analysing", mix(600, 1), { status: "analysing" });
    await meal(ann.id, "2026-11-12", "Failed", mix(600, 1), { status: "failed" });
    await meal(ann.id, "2026-11-13", "Estimate", {
      energy: 500,
      protein: 30,
      fiber: 5,
      sodium: 400,
    });
    await meal(ann.id, "2026-11-14", "Deleted", mix(600, 1), { deletedAt: new Date() });
    // Outside the week, and someone else's.
    const older = await meal(ann.id, "2026-10-01", "Old soup", mix(600, 1.2));
    const fry = await meal(ann.id, "2025-06-01", "Fry-up", mix(1400, 0.2, 3), {
      slot: "breakfast",
    });
    await meal(ben.id, "2026-11-12", "Ben's salad", mix(600, 1));

    const week = await balanceRanking(ann.id, WEEK, targets);
    expect(week.judged).toBe(7);
    expect(week.leftOut).toBe(3);
    expect(week.best.map((m) => m.title)).toEqual([
      "Lentil stew",
      "Bean salad",
      "Oats with berries",
    ]);
    expect(week.worst.map((m) => m.title)).toEqual(["Cream pastry", "Party platter", "Crisps"]);
    expect(week.best[0]).toMatchObject({
      mealId: lentils.id,
      localDate: "2026-11-10",
      slot: "lunch",
      energy: 600,
      score: 100,
      reason: "Plenty of protein, fiber and vitamin A; little saturated fat",
      photoUrl: null,
    });
    // The pictures: a photo's thumbnail, else the foods (the first food that is not a drink).
    expect(week.best[0]!.foods.map((f) => [f.emoji, f.drink])).toEqual([
      ["🍲", false],
      [expect.any(String), true],
    ]);
    expect(week.best[1]!.photoUrl).toMatch(/^\/api\/photos\/[0-9a-f-]{36}\/thumb$/);
    const scores = [...week.best, ...week.worst].map((m) => m.score);
    expect(Math.min(...week.best.map((m) => m.score))).toBeGreaterThanOrEqual(
      Math.max(...week.worst.map((m) => m.score)),
    );
    expect(scores.every((s) => s >= 0 && s <= 100)).toBe(true);
    // All three limits at 2.5 times their share: the first in the list is named, then the size.
    expect(week.worst[0]!.reason).toBe("Saturated fat 2.5× its share; twice a usual snack");
    expect(week.worst.find((m) => m.mealId === feast.id)!.reason).toContain("a usual dinner");
    expect(week.best.some((m) => m.mealId === toast.id)).toBe(false);
    expect([...week.best, ...week.worst].some((m) => m.mealId === chips.id)).toBe(true);
    expect(week.worst.some((m) => m.mealId === pastry.id)).toBe(true);
    expect(oats.id).toBe(week.best[2]!.mealId);

    // All time adds the older meals: the soup is among the best, the fry-up is the worst.
    const all = await balanceRanking(ann.id, null, targets);
    expect(all.judged).toBe(9);
    expect(all.best.map((m) => m.mealId)).toContain(older.id);
    expect(all.worst[0]!.mealId).toBe(fry.id);
    expect(all.worst[0]!.localDate).toBe("2025-06-01");

    // Both lists at once, as Trends asks for them.
    const both = await getBalanceRankings(ann.id, WEEK);
    expect(both.period).toEqual(week);
    expect(both.allTime).toEqual(all);
    // Someone else's meals only in their own lists.
    const bens = await getBalanceRankings(ben.id, WEEK);
    expect(bens.period.best.map((m) => m.title)).toEqual(["Ben's salad"]);
    expect(bens.period.worst).toEqual([]);
  });

  it("splits fewer than six meals into a better and a worse half, never one meal twice", () => {
    const at = (n: number) => new Date(Date.UTC(2026, 10, n));
    const ranked = (scores: number[]) =>
      splitRanking(scores.map((score, i) => ({ score, eatenAt: at(i + 1) })));
    const names = (list: { score: number }[]) => list.map((m) => m.score);
    expect(names(ranked([]).best)).toEqual([]);
    expect(names(ranked([50]).best)).toEqual([50]);
    expect(names(ranked([50]).worst)).toEqual([]);
    expect(names(ranked([40, 60]).best)).toEqual([60]);
    expect(names(ranked([40, 60]).worst)).toEqual([40]);
    expect(names(ranked([40, 60, 80, 20, 70]).best)).toEqual([80, 70, 60]);
    expect(names(ranked([40, 60, 80, 20, 70]).worst)).toEqual([20, 40]);
    expect(names(ranked([1, 2, 3, 4, 5, 6, 7, 8]).best)).toEqual([8, 7, 6]);
    expect(names(ranked([1, 2, 3, 4, 5, 6, 7, 8]).worst)).toEqual([1, 2, 3]);
    // A tie goes to the more recent meal, both ways.
    const tie = splitRanking([
      { id: "older", score: 50, eatenAt: at(1) },
      { id: "newer", score: 50, eatenAt: at(2) },
    ]);
    expect(tie.best.map((m) => m.id)).toEqual(["newer"]);
    expect(tie.worst.map((m) => m.id)).toEqual(["older"]);
  });

  it("keeps All time quick with thousands of meals", async () => {
    const cam = await createUser();
    const { targets } = await getTargets(cam.id);
    // 4,000 meals over eleven years, each with a full set of totals (and an FDC value).
    await db.execute(sql`
      insert into meals (user_id, eaten_at, tz, local_date, slot, status, source, title, totals)
      select ${cam.id}::uuid, d + time '12:30', 'UTC', d::date, 'lunch', 'ready', 'manual',
        'Meal ' || n,
        jsonb_build_object('energy', 300 + n % 700, 'protein', 5 + n % 40, 'fiber', n % 12,
          'vit_a', n % 500, 'vit_c', n % 60, 'vit_e', n % 9, 'calcium', n % 400,
          'iron', n % 6, 'potassium', n % 1500, 'magnesium', n % 150, 'fat_sat', n % 20,
          'sugars_added', n % 35, 'sodium', n % 1800, 'fdc:1110', 1)
      from generate_series(1, 4000) n,
        lateral (select date '2015-01-01' + (n % 4000) as d) days
    `);
    const started = performance.now();
    const all = await balanceRanking(cam.id, null, targets);
    const took = performance.now() - started;
    expect(all.judged).toBe(4000);
    expect(all.best).toHaveLength(3);
    expect(all.worst).toHaveLength(3);
    // Generous for a busy test machine; about a tenth of this was seen here.
    expect(took).toBeLessThan(5000);
  });
});
