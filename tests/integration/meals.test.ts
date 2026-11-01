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
import { getTargets, resetTarget, setCustomTarget } from "@/lib/targets/service";
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

  it("keeps photo rows tied to their owner", async () => {
    const rows = await db
      .select({ userId: mealPhotos.userId, mealUser: meals.userId })
      .from(mealPhotos)
      .innerJoin(meals, eq(meals.id, mealPhotos.mealId));
    expect(rows.every((r) => r.userId === r.mealUser)).toBe(true);
  });
});
