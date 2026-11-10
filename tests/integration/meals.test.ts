// Creating, reading and editing meals and items, and that nobody reaches another person's rows.
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { eq, sql } from "drizzle-orm";
import sharp from "sharp";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { db } from "@/db";
import { jobs, mealPhotos, meals } from "@/db/schema";
import { ANALYZE_MEAL_JOB } from "@/lib/contracts/analysis";
import { searchFoods, getFood } from "@/lib/food/search";
import { createPhotoMeal } from "@/lib/meals/create";
import {
  addItem,
  deleteItem,
  deleteMeal,
  duplicateMeal,
  getMeal,
  listMealsForDay,
  updateItem,
  updateMeal,
} from "@/lib/meals/service";
import { createManualMeal } from "@/lib/meals/manual";
import { getTargets, resetTarget, setCustomTarget, setHydrationGoal } from "@/lib/targets/service";
import { createFood, createItem, createMeal, createUser } from "@/tests/helpers/factories";

let root: string;
const jpeg = (w = 1200, h = 900) =>
  sharp({ create: { width: w, height: h, channels: 3, background: "#c86420" } })
    .jpeg()
    .toBuffer();

beforeAll(() => {
  root = mkdtempSync(path.join(os.tmpdir(), "cal-meal-photos-"));
  process.env.PHOTO_ROOT = root;
});

afterAll(() => {
  rmSync(root, { recursive: true, force: true });
});

const countFiles = (dir: string): number =>
  readdirSync(dir, { withFileTypes: true }).reduce(
    (n, entry) => n + (entry.isDirectory() ? countFiles(path.join(dir, entry.name)) : 1),
    0,
  );

describe("photo meals", () => {
  it("store photos, the meal and its analysis job together", async () => {
    const user = await createUser({
      mealWindows: {
        breakfast: ["06:00", "09:00"],
        lunch: ["12:00", "14:00"],
        dinner: ["18:00", "20:00"],
      },
    });
    const eatenAt = new Date("2026-10-31T09:45:00Z"); // 13:15 in Tehran
    const { meal, duplicate } = await createPhotoMeal({
      userId: user.id,
      clientId: "client-0001",
      eatenAt,
      tz: "Asia/Tehran",
      note: "ate half",
      photos: [await jpeg(), await jpeg(800, 800)],
    });
    expect(duplicate).toBe(false);
    expect(meal).toMatchObject({
      status: "queued",
      slot: "lunch",
      localDate: "2026-10-31",
      localTime: "13:15",
      note: "ate half",
    });
    expect(meal.photos.map((p) => p.urls.thumb)).toEqual(
      meal.photos.map((p) => `/api/photos/${p.id}/thumb`),
    );
    expect(countFiles(root)).toBe(6);

    const job = (await db.select().from(jobs).where(eq(jobs.kind, ANALYZE_MEAL_JOB)))[0]!;
    expect(job).toMatchObject({ status: "queued", userId: user.id, dedupeKey: `meal:${meal.id}` });
    expect(job.payload).toEqual({ mealId: meal.id, userId: user.id, reason: "upload" });

    const again = await createPhotoMeal({
      userId: user.id,
      clientId: "client-0001",
      eatenAt,
      tz: "Asia/Tehran",
      note: null,
      photos: [await jpeg()],
    });
    expect(again.duplicate).toBe(true);
    expect(again.meal.id).toBe(meal.id);
    expect(countFiles(root)).toBe(6);
  });

  it("leave no files behind when a photo cannot be read", async () => {
    const user = await createUser();
    const before = countFiles(root);
    await expect(
      createPhotoMeal({
        userId: user.id,
        clientId: null,
        eatenAt: new Date(),
        tz: "UTC",
        note: null,
        photos: [await jpeg(), Buffer.from("\xff\xd8\xff garbage", "latin1")],
      }),
    ).rejects.toThrow(/could not be read/);
    expect(countFiles(root)).toBe(before);
    expect((await db.select().from(meals).where(eq(meals.userId, user.id))).length).toBe(0);
  });
});

describe("meal service", () => {
  it("lists a day, edits items with instant rescaling, and keeps totals", async () => {
    const user = await createUser();
    const rice = await createFood({
      nameEn: "Rice, cooked",
      nutrients: { energy: 130, protein: 2.7, carbs: 28 },
    });
    const meal = await createMeal(user.id);
    const estimated = await createItem(user.id, meal.id, {
      name: "Stew",
      grams: 300,
      nutrients: { energy: 450, protein: 30 },
      nutrientSource: "ai_estimate",
      components: [{ name: "beef", grams: 100, nutrients: { energy: 250 } }],
    });

    const added = (await addItem(user.id, meal.id, { name: "Rice", foodId: rice.id, grams: 200 }))!;
    expect(added).toMatchObject({
      foodId: rice.id,
      foodName: "Rice, cooked",
      nutrientSource: "food",
      edited: true,
    });
    expect(added.nutrients.energy).toBeCloseTo(260);

    // A food's values per 100 g follow the new weight and count.
    const doubled = (await updateItem(user.id, added.id, { grams: 150, count: 2 }))!;
    expect(doubled.nutrients.energy).toBeCloseTo(390);
    // Without a food, everything scales in proportion, components too.
    const half = (await updateItem(user.id, estimated.id, { grams: 150 }))!;
    expect(half.nutrients).toEqual({ energy: 225, protein: 15 });
    expect(half.components[0]).toMatchObject({ grams: 50, nutrients: { energy: 125 } });
    expect(half.edited).toBe(true);

    const full = (await getMeal(user.id, meal.id))!;
    expect(full.items.map((i) => i.name)).toEqual(["Stew", "Rice"]);
    expect(full.totals.energy).toBeCloseTo(615);
    const day = await listMealsForDay(user.id, "2026-10-31");
    expect(day).toHaveLength(1);
    expect(day[0]!.itemCount).toBe(2);

    expect(await deleteItem(user.id, estimated.id)).toBe(true);
    expect((await getMeal(user.id, meal.id))!.totals.energy).toBeCloseTo(390);
  });

  it("gives every new or changed item an emoji, and rows from before one from their names", async () => {
    const user = await createUser();
    const rice = await createFood({ nameEn: "Rice, cooked", nutrients: { energy: 130 } });
    const chicken = await createFood({
      nameEn: "Chicken breast, roasted",
      nutrients: { energy: 165 },
    });
    const meal = await createMeal(user.id);
    const older = await createItem(user.id, meal.id, { name: "Fesenjan", position: 0 });
    expect(older.emoji).toBeNull();
    const added = (await addItem(user.id, meal.id, { name: "", foodId: rice.id, grams: 150 }))!;
    expect(added).toMatchObject({ name: "Rice, cooked", emoji: "🍚" });
    const water = (await addItem(user.id, meal.id, {
      name: "Glass of water",
      kind: "drink",
      ml: 250,
      nutrients: {},
    }))!;
    expect(water.emoji).toBe("💧");
    const unknown = (await addItem(user.id, meal.id, { name: "Mystery bar", nutrients: {} }))!;
    expect(unknown.emoji).toBe("🍽️");

    // Another food: its emoji. Only the amount: the emoji stays.
    const changed = (await updateItem(user.id, added.id, { foodId: chicken.id }))!;
    expect(changed.emoji).toBe("🍗");
    expect((await updateItem(user.id, added.id, { grams: 200 }))!.emoji).toBe("🍗");
    expect((await updateItem(user.id, unknown.id, { name: "Chocolate bar" }))!.emoji).toBe("🍫");

    const full = (await getMeal(user.id, meal.id))!;
    expect(full.items.map((i) => i.emoji)).toEqual(["🍲", "🍗", "💧", "🍫"]);
    const [summary] = await listMealsForDay(user.id, "2026-10-31");
    expect(summary!.foods).toEqual([
      { name: "Fesenjan", emoji: "🍲", drink: false },
      { name: "Rice, cooked", emoji: "🍗", drink: false },
      { name: "Glass of water", emoji: "💧", drink: true },
      { name: "Chocolate bar", emoji: "🍫", drink: false },
    ]);

    const copy = (await duplicateMeal(user.id, meal.id, {
      eatenAt: new Date().toISOString(),
      tz: "UTC",
    }))!;
    expect(copy.items.map((i) => i.emoji)).toEqual(["🍲", "🍗", "💧", "🍫"]);
  });

  it("moves a meal to another day and slot when its time changes", async () => {
    const user = await createUser();
    const meal = await createMeal(user.id);
    const moved = (await updateMeal(user.id, meal.id, {
      eatenAt: "2026-10-30T19:00:00Z",
      tz: "UTC",
    }))!;
    expect(moved).toMatchObject({ localDate: "2026-10-30", slot: "dinner" });
    const renamed = (await updateMeal(user.id, meal.id, {
      title: "  Dinner at home  ",
      slot: "snack",
    }))!;
    expect(renamed).toMatchObject({ title: "Dinner at home", slot: "snack" });
  });

  it("duplicates a meal to another time as a ready copy", async () => {
    const user = await createUser();
    const meal = await createMeal(user.id, { title: "Oats", totals: { energy: 300 } });
    await createItem(user.id, meal.id, { name: "Oats", nutrients: { energy: 300 } });
    const copy = (await duplicateMeal(user.id, meal.id, {
      eatenAt: "2026-11-01T07:30:00Z",
      tz: "UTC",
    }))!;
    expect(copy).toMatchObject({
      source: "duplicate",
      status: "ready",
      localDate: "2026-11-01",
      slot: "breakfast",
      title: "Oats",
    });
    expect(copy.items).toHaveLength(1);
    expect(copy.id).not.toBe(meal.id);
  });
});

describe("isolation between people", () => {
  it("treats another person's meals, items, photos and foods as missing", async () => {
    const owner = await createUser();
    const other = await createUser();
    const meal = await createMeal(owner.id);
    const item = await createItem(owner.id, meal.id);
    const privateFood = await createFood({
      nameEn: "Grandma's kuku",
      ownerId: owner.id,
      searchText: "grandma kuku",
    });

    expect(await getMeal(other.id, meal.id)).toBeNull();
    expect(await listMealsForDay(other.id, "2026-10-31")).toEqual([]);
    expect(await updateMeal(other.id, meal.id, { title: "mine now" })).toBeNull();
    expect(await deleteMeal(other.id, meal.id)).toBe(false);
    expect(
      await duplicateMeal(other.id, meal.id, { eatenAt: new Date().toISOString(), tz: "UTC" }),
    ).toBeNull();
    expect(await addItem(other.id, meal.id, { name: "x" })).toBeNull();
    expect(await updateItem(other.id, item.id, { grams: 1 })).toBeNull();
    expect(await deleteItem(other.id, item.id)).toBe(false);
    // Nor can someone attach another person's private food to their own meal.
    const theirMeal = await createMeal(other.id);
    expect(await addItem(other.id, theirMeal.id, { name: "x", foodId: privateFood.id })).toBeNull();
    expect(await getFood(privateFood.id, other.id)).toBeNull();
    expect(await searchFoods({ query: "kuku", userId: other.id })).toEqual([]);
    expect((await searchFoods({ query: "kuku", userId: owner.id }))[0]?.id).toBe(privateFood.id);

    const unchanged = (await getMeal(owner.id, meal.id))!;
    expect(unchanged.title).toBeNull();
    expect(unchanged.items).toHaveLength(1);
  });

  it("hides deleted meals from their owner too", async () => {
    const owner = await createUser();
    const meal = await createMeal(owner.id);
    expect(await deleteMeal(owner.id, meal.id)).toBe(true);
    expect(await getMeal(owner.id, meal.id)).toBeNull();
    expect(await listMealsForDay(owner.id, "2026-10-31")).toEqual([]);
  });
});

describe("food search stub and targets", () => {
  it("finds shared foods with typos, the person's own foods first", async () => {
    const user = await createUser();
    await createFood({
      nameEn: "Chicken kabab",
      searchText: "chicken kabab joojeh kabab",
      source: "dish",
    });
    const own = await createFood({
      nameEn: "My chicken kabab",
      searchText: "my chicken kabab",
      ownerId: user.id,
    });
    const results = await searchFoods({ query: "chiken kabab", userId: user.id });
    expect(results[0]!.id).toBe(own.id);
    expect(results[0]!.personal).toBe(true);
    expect(results).toHaveLength(2);
    expect(await searchFoods({ query: "   ", userId: user.id })).toEqual([]);
  });

  it("gives default targets, then profile targets, and keeps custom ones", async () => {
    const user = await createUser();
    expect((await getTargets(user.id)).targets.energy).toMatchObject({
      target: 2000,
      basis: "default",
    });
    await db.execute(sql`update users set sex = 'female', birth_year = 1990, height_cm = 165, weight_kg = 60,
                         activity_level = 'light', goal = 'keep' where id = ${user.id}`);
    const computed = await getTargets(user.id);
    expect(computed.fromProfile).toBe(true);
    expect(computed.targets.protein).toMatchObject({ target: 96, basis: "profile" });
    await setCustomTarget(user.id, "protein", { target: 120 });
    expect((await getTargets(user.id)).targets.protein).toMatchObject({
      target: 120,
      custom: true,
    });
    await resetTarget(user.id, "protein");
    expect((await getTargets(user.id)).targets.protein?.target).toBe(96);
  });

  it("gives a water goal from the profile's sex and keeps the person's own until reset", async () => {
    const user = await createUser();
    expect((await getTargets(user.id)).hydration).toEqual({
      goalMl: 1800,
      custom: false,
      basis: "default",
    });
    await db.execute(sql`update users set sex = 'male' where id = ${user.id}`);
    expect((await getTargets(user.id)).hydration).toEqual({
      goalMl: 2000,
      custom: false,
      basis: "profile",
    });
    await setHydrationGoal(user.id, 2250);
    const own = await getTargets(user.id);
    expect(own.hydration).toEqual({ goalMl: 2250, custom: true, basis: "custom" });
    // It is not a nutrient target (the water nutrient counts food too).
    expect(own.targets.water).toBeUndefined();
    await expect(setHydrationGoal(user.id, 50)).rejects.toThrow();
    await resetTarget(user.id, "hydration");
    expect((await getTargets(user.id)).hydration.goalMl).toBe(2000);
  });

  it("counts the water of a meal's drinks, not food or alcohol", async () => {
    const user = await createUser();
    const at = new Date(Date.now() - 3_600_000).toISOString();
    const water = await createManualMeal(user.id, {
      eatenAt: at,
      tz: "UTC",
      title: "Water",
      items: [{ name: "Water", kind: "drink", ml: 250, grams: 250, nutrients: { energy: 0 } }],
    });
    expect(water.items[0]).toMatchObject({ emoji: "💧", ml: 250, nutrients: { energy: 0 } });
    const lunch = await createManualMeal(user.id, {
      eatenAt: at,
      tz: "UTC",
      items: [
        { name: "Rice", grams: 200, nutrients: { energy: 260 } },
        { name: "Coffee", kind: "drink", ml: 200, nutrients: { energy: 4 } },
        { name: "Beer", kind: "drink", ml: 330, nutrients: { energy: 140, alcohol: 13 } },
      ],
    });
    const day = await listMealsForDay(user.id, water.localDate);
    const byId = new Map(day.map((m) => [m.id, m]));
    expect(byId.get(water.id)).toMatchObject({
      waterMl: 250,
      foods: [{ name: "Water", emoji: "💧", drink: true }],
    });
    expect(byId.get(lunch.id)!.waterMl).toBe(200);
    expect(byId.get(lunch.id)!.foods.map((f) => f.drink)).toEqual([false, true, true]);
  });

  it("names manual meals by the rules, and a new time names them again unless chosen by hand", async () => {
    const user = await createUser();
    // Today in UTC, at set clock times (the service takes any time; the routes check the range).
    const day = new Date().toISOString().slice(0, 10);
    const at = (time: string) => `${day}T${time}:00Z`;
    const log = (
      time: string,
      items: Parameters<typeof createManualMeal>[1]["items"],
      slot?: "dessert",
    ) =>
      createManualMeal(user.id, { eatenAt: at(time), tz: "UTC", items, ...(slot ? { slot } : {}) });

    expect((await log("13:00", [{ name: "Apple", nutrients: { energy: 95 } }])).slot).toBe("snack");
    const lunch = await log("13:00", [{ name: "Rice and chicken", nutrients: { energy: 600 } }]);
    expect(lunch.slot).toBe("lunch");
    expect(
      (await log("22:40", [{ name: "Yogurt and honey", nutrients: { energy: 260 } }])).slot,
    ).toBe("supper");
    expect(
      (await log("08:30", [{ name: "Coffee", kind: "drink", ml: 250, nutrients: { energy: 4 } }]))
        .slot,
    ).toBe("drink");
    const chosen = await log("13:00", [{ name: "Cake", nutrients: { energy: 400 } }], "dessert");
    expect(chosen).toMatchObject({ slot: "dessert", slotLocked: true });

    // A new time names the meal again; a slot chosen by hand stays.
    expect((await updateMeal(user.id, lunch.id, { eatenAt: at("19:30") }))!.slot).toBe("dinner");
    expect((await updateMeal(user.id, chosen.id, { eatenAt: at("19:30") }))!.slot).toBe("dessert");
    // Adding food to the drink makes it a meal again.
    const drink = (await listMealsForDay(user.id, day)).find((m) => m.slot === "drink")!;
    await addItem(user.id, drink.id, { name: "Croissant", nutrients: { energy: 300 } });
    expect((await getMeal(user.id, drink.id))!.slot).toBe("breakfast");
  });

  it("keeps photo rows tied to their owner", async () => {
    const rows = await db
      .select({ userId: mealPhotos.userId, mealUser: meals.userId })
      .from(mealPhotos)
      .innerJoin(meals, eq(meals.id, mealPhotos.mealId));
    expect(rows.every((r) => r.userId === r.mealUser)).toBe(true);
  });
});
