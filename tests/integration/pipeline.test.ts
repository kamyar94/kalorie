// The phases together on real food data: the FoodData Central fixture extracts and the seeded
// Persian dishes are imported with the server tool's own commands, a photo is uploaded, the worker's
// handler runs the analysis against the provider mock (vision call, then the matching call), the
// items match imported foods, a hand edit recomputes the meal, and trends add the day up.
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { sql } from "drizzle-orm";
import sharp from "sharp";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { db } from "@/db";
import { saveProviderKey } from "@/lib/ai/service";
import { analyzeMealHandler } from "@/lib/analysis/handler";
import { ANALYZE_MEAL_JOB } from "@/lib/contracts/analysis";
import { searchFoods } from "@/lib/food/search";
import { createPhotoMeal } from "@/lib/meals/create";
import { getMeal, updateItem } from "@/lib/meals/service";
import { drainJobs } from "@/lib/queue/worker";
import { getTrends } from "@/lib/trends/service";
import { GOOD_MEAL, matchingReply } from "@/tests/fixtures/analysis";
import {
  aiReplies,
  startAiMock,
  TEST_API_KEY,
  useAiMock,
  type AiMock,
} from "@/tests/helpers/ai-mock";
import { createUser } from "@/tests/helpers/factories";
import { importFdcFixtures, seedDishFixtures } from "@/tests/helpers/food-data";

let ai: AiMock;
let restore: () => void;
let root: string;

beforeAll(async () => {
  ai = await startAiMock();
  restore = useAiMock(ai);
  root = mkdtempSync(path.join(os.tmpdir(), "cal-pipeline-"));
  process.env.PHOTO_ROOT = root;
  await importFdcFixtures();
  await seedDishFixtures();
});

afterAll(async () => {
  restore();
  await ai.close();
  rmSync(root, { recursive: true, force: true });
});

const jpeg = () =>
  sharp({ create: { width: 640, height: 480, channels: 3, background: "#c08040" } })
    .jpeg()
    .toBuffer();

describe("photo to trends on imported food data", () => {
  it("matches imported foods and dishes, keeps edits and adds the day up", async () => {
    const user = await createUser();
    await saveProviderKey(user.id, "google", TEST_API_KEY);
    ai.queue("google", aiReplies.google.json(GOOD_MEAL), matchingReply("google"));

    const { meal: created } = await createPhotoMeal({
      userId: user.id,
      clientId: null,
      eatenAt: new Date("2026-10-31T16:30:00Z"),
      tz: "Asia/Tehran",
      note: null,
      photos: [await jpeg()],
    });
    await drainJobs({ [ANALYZE_MEAL_JOB]: analyzeMealHandler });

    const meal = (await getMeal(user.id, created.id))!;
    expect(meal.status).toBe("ready");
    expect(meal.items).toHaveLength(4);
    const byName = Object.fromEntries(meal.items.map((i) => [i.name, i]));

    // Matched to imported rows: FoodData Central foods and the seeded doogh dish.
    const ids = meal.items.map((i) => i.foodId).filter((id): id is string => !!id);
    const rows = await db.execute<{ id: string; source: string; name_en: string }>(
      sql`select id, source, name_en from foods where id in ${sql.raw(`('${ids.join("','")}')`)}`,
    );
    const source = Object.fromEntries(rows.rows.map((r) => [r.id, r]));
    const rice = byName["Rice, white, cooked"]!;
    expect(source[rice.foodId!]?.source).toMatch(/^fdc_/);
    expect(source[rice.foodId!]?.name_en).toMatch(/^Rice, white/);
    expect(rice.nutrientSource).toBe("food");
    const doogh = byName["Doogh"]!;
    expect(source[doogh.foodId!]?.source).toBe("dish");
    expect(source[doogh.foodId!]?.name_en).toMatch(/^Doogh/);
    expect(source[byName["Chicken breast, grilled"]!.foodId!]?.name_en).toMatch(/^Chicken/);

    // Nutrients follow the food per 100 g, and the totals are the sum of the items.
    const riceFood = (
      await searchFoods({ query: source[rice.foodId!]!.name_en, userId: user.id })
    ).find((f) => f.id === rice.foodId)!;
    expect(rice.nutrients.energy).toBeCloseTo((riceFood.per100g.energy! * rice.grams) / 100, 0);
    const sum = meal.items.reduce((total, item) => total + (item.nutrients.energy ?? 0), 0);
    expect(meal.totals.energy).toBeCloseTo(sum, 0);

    // A hand edit recomputes the item and the meal, and the day in trends follows.
    await updateItem(user.id, rice.id, { grams: rice.grams * 2 });
    const edited = (await getMeal(user.id, created.id))!;
    const riceAfter = edited.items.find((i) => i.id === rice.id)!;
    expect(riceAfter.edited).toBe(true);
    expect(riceAfter.nutrients.energy).toBeCloseTo(rice.nutrients.energy! * 2, 0);
    expect(edited.totals.energy).toBeCloseTo(meal.totals.energy! + rice.nutrients.energy!, 0);
    const trends = await getTrends(user.id, "day", "2026-10-31");
    expect(trends.loggedDays).toBe(1);
    expect(trends.average.energy).toBeCloseTo(edited.totals.energy!, 0);
  });
});
