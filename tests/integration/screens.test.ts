// The server side of the screens: answers and corrections queue a new analysis, manual meals,
// correction memory, recent foods, personal foods and barcodes, trends, settings, export and
// "delete my data", and that every new route keeps people apart.
import { and, eq, sql } from "drizzle-orm";
import { NextRequest } from "next/server";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { db } from "@/db";
import {
  aiKeys,
  dishComponents,
  foodMemory,
  foods,
  jobs,
  mealItems,
  mealPhotos,
  meals,
  users,
} from "@/db/schema";
import { deleteUserData, exportUserData, mealsToCsv } from "@/lib/account/data";
import {
  getPreferences,
  SettingsInputError,
  updatePreferences,
  updateProfile,
} from "@/lib/account/settings";
import type { SessionUser } from "@/lib/auth/accounts";
import type { FoodResult } from "@/lib/contracts/food-search";
import type { MealDto, MealItemDto } from "@/lib/contracts/meals";
import { rememberItem } from "@/lib/analysis/memory";
import {
  answerQuestion,
  correctMeal,
  retryAnalysis,
  retryKeyFailures,
} from "@/lib/analysis/requests";
import { findFoodByBarcode } from "@/lib/food/barcode-local";
import { createCustomFood } from "@/lib/food/custom-foods";
import { searchFoods } from "@/lib/food/search";
import { createManualMeal, ManualMealError } from "@/lib/meals/manual";
import { frequentFoods, recentFoods } from "@/lib/meals/recent-foods";
import { getMeal } from "@/lib/meals/service";
import { getTrends } from "@/lib/trends/service";
import { createFood, createItem, createMeal, createUser } from "@/tests/helpers/factories";
import { startMockServer, type MockServer } from "@/tests/helpers/mock-http";

const session = vi.hoisted(() => ({ user: null as SessionUser | null }));
vi.mock("@/lib/auth/session", () => ({
  getCurrentUser: async () => session.user,
}));

const ORIGIN = "http://127.0.0.1:3201";
const headers = { origin: ORIGIN, "x-forwarded-host": "127.0.0.1:3201" };

const asUser = async () => {
  const row = await createUser();
  return {
    id: row.id,
    username: row.username,
    displayName: row.displayName,
    role: row.role,
    timeZone: row.timeZone,
    units: row.units,
  } satisfies SessionUser;
};

const request = (url: string, method = "GET", body?: unknown, extra: Record<string, string> = {}) =>
  new NextRequest(`${ORIGIN}${url}`, {
    method,
    headers: { ...headers, ...(body ? { "content-type": "application/json" } : {}), ...extra },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

const ctx = (params: Record<string, string>) => ({ params: Promise.resolve(params) }) as never;

let ann: SessionUser;
let ben: SessionUser;
let rice: Awaited<ReturnType<typeof createFood>>;
/** Open Food Facts stand-in: it knows no product. */
let off: MockServer;

beforeAll(async () => {
  off = await startMockServer();
  off.reply(() => ({ status: 404, json: { status: 0, status_verbose: "product not found" } }));
  vi.stubEnv("OFF_BASE_URL", off.url);
  ann = await asUser();
  ben = await asUser();
  rice = await createFood({
    nameEn: "Rice, white, cooked",
    source: "fdc_sr_legacy",
    nutrients: { energy: 130, protein: 2.7, carbs: 28 },
    searchText: "rice white cooked",
    barcode: "0036000291452",
  });
});

afterAll(async () => {
  vi.unstubAllEnvs();
  await off.close();
});

beforeEach(async () => {
  session.user = ann;
  await db.execute(sql`delete from rate_limits`);
});

/** Photo meals need a photo row before they can be analysed again. */
const withPhoto = async <T extends { id: string; userId: string }>(meal: T) => {
  await db.insert(mealPhotos).values({
    mealId: meal.id,
    userId: meal.userId,
    position: 0,
    originalPath: "x/original.jpg",
    analysisPath: "x/analysis.jpg",
    thumbPath: "x/thumb.jpg",
    width: 10,
    height: 10,
    bytes: 10,
    sha256: "0".repeat(64),
  });
  return meal;
};

const photoMealWithQuestion = async (userId: string) =>
  withPhoto(
    await createMeal(userId, {
      status: "needs_input",
      source: "photo",
      questions: [{ id: "q1", text: "Was it fried?", answers: ["Yes", "No"] }],
    }),
  );

const mealOf = (result: Awaited<ReturnType<typeof answerQuestion>>) =>
  result.ok ? result.meal : null;

const jobsFor = async (mealId: string) =>
  db
    .select()
    .from(jobs)
    .where(sql`${jobs.payload}->>'mealId' = ${mealId}`);

describe("a saved key analyses again the meals that stopped for a key problem", () => {
  const failedPhotoMeal = async (userId: string, kind: string, overrides = {}) =>
    withPhoto(
      await createMeal(userId, {
        source: "photo",
        status: "failed",
        error: { kind, message: "x" },
        ...overrides,
      }),
    );

  it("queues this person's recent photo meals that failed for no key, a refused key or no credit", async () => {
    const person = await createUser();
    const noKey = await failedPhotoMeal(person.id, "no-key");
    const refused = await failedPhotoMeal(person.id, "auth");
    const noCredit = await failedPhotoMeal(person.id, "quota");
    // Not these: another failure, a meal over a week old, a deleted one, a manual one, another person's.
    const notFood = await failedPhotoMeal(person.id, "not-food");
    const old = await failedPhotoMeal(person.id, "no-key", {
      createdAt: new Date(Date.now() - 8 * 86_400_000),
    });
    const deleted = await failedPhotoMeal(person.id, "no-key", { deletedAt: new Date() });
    const manual = await createMeal(person.id, {
      source: "manual",
      status: "failed",
      error: { kind: "no-key", message: "x" },
    });
    const others = await failedPhotoMeal(ben.id, "no-key");

    expect(await retryKeyFailures(person.id)).toBe(3);
    for (const meal of [noKey, refused, noCredit]) {
      expect((await getMeal(person.id, meal.id))!.status).toBe("queued");
      const queued = await jobsFor(meal.id);
      expect(queued).toHaveLength(1);
      expect(queued[0]!.payload).toMatchObject({ reason: "retry", userId: person.id });
    }
    for (const meal of [notFood, old, deleted, manual, others])
      expect(await jobsFor(meal.id)).toHaveLength(0);
    expect((await getMeal(ben.id, others.id))!.status).toBe("failed");

    // Saving the key again finds nothing left to do.
    expect(await retryKeyFailures(person.id)).toBe(0);
  });
});

describe("answers and corrections", () => {
  it("stores the answer, queues the meal and a job", async () => {
    const meal = await photoMealWithQuestion(ann.id);
    const updated = mealOf(await answerQuestion(ann.id, meal.id, "q1", " No "));
    expect(updated).toMatchObject({ status: "queued" });
    expect(updated!.questions[0]).toMatchObject({ id: "q1", answer: "No" });
    expect(updated!.openQuestions).toBe(0);
    const queued = await jobsFor(meal.id);
    expect(queued).toHaveLength(1);
    expect(queued[0]!.payload).toMatchObject({ reason: "answer", userId: ann.id });
  });

  it("refuses unknown questions, empty answers, others' meals and manual meals", async () => {
    const meal = await photoMealWithQuestion(ann.id);
    expect(await answerQuestion(ann.id, meal.id, "nope", "Yes")).toMatchObject({ status: 404 });
    expect(await answerQuestion(ann.id, meal.id, "q1", "  ")).toMatchObject({ status: 400 });
    expect(await answerQuestion(ben.id, meal.id, "q1", "Yes")).toMatchObject({ status: 404 });
    const manual = await createMeal(ann.id, { source: "manual" });
    expect(await retryAnalysis(ann.id, manual.id)).toMatchObject({ status: 409 });
    expect(await jobsFor(meal.id)).toHaveLength(0);
  });

  it("keeps corrections in order and passes replaceEdits on", async () => {
    const meal = await withPhoto(
      await createMeal(ann.id, {
        source: "photo",
        status: "failed",
        error: { kind: "server", message: "x" },
      }),
    );
    await correctMeal(ann.id, meal.id, "it was chicken, not beef");
    const second = mealOf(
      await correctMeal(ann.id, meal.id, "only half the rice", { replaceEdits: true }),
    );
    expect(second!.status).toBe("queued");
    expect(second!.error).toBeNull();
    const row = (await db.select().from(meals).where(eq(meals.id, meal.id)))[0]!;
    expect(row.corrections.map((c) => c.text)).toEqual([
      "it was chicken, not beef",
      "only half the rice",
    ]);
    const queued = await jobsFor(meal.id);
    expect(queued.some((j) => (j.payload as { replaceEdits?: boolean }).replaceEdits)).toBe(true);
  });
});

describe("manual meals", () => {
  it("logs a ready meal from foods, with totals", async () => {
    const meal = await createManualMeal(ann.id, {
      eatenAt: "2026-10-30T16:00:00Z",
      tz: "Asia/Tehran",
      items: [{ name: "Rice", foodId: rice.id, grams: 200 }],
    });
    expect(meal).toMatchObject({
      status: "ready",
      source: "manual",
      localDate: "2026-10-30",
      slot: "dinner",
    });
    expect(meal.items[0]!.nutrients.energy).toBeCloseTo(260);
    expect(meal.totals.energy).toBeCloseTo(260);
  });

  it("saves nothing when a food is not visible to the person", async () => {
    const secret = await createFood({ nameEn: "Ben's stew", ownerId: ben.id });
    const before = (await db.select().from(meals).where(eq(meals.userId, ann.id))).length;
    await expect(
      createManualMeal(ann.id, {
        eatenAt: new Date().toISOString(),
        tz: "UTC",
        items: [{ name: "Stew", foodId: secret.id }],
      }),
    ).rejects.toBeInstanceOf(ManualMealError);
    expect((await db.select().from(meals).where(eq(meals.userId, ann.id))).length).toBe(before);
  });
});

describe("memory, recent foods, personal foods and barcodes", () => {
  it("remembers a corrected item; edits of the same meal count once", async () => {
    const first = await createMeal(ann.id);
    const second = await createMeal(ann.id);
    const nutrients = { energy: 500 };
    const a = await createItem(ann.id, first.id, { name: "Kabab koobideh", grams: 200, nutrients });
    const again = await createItem(ann.id, first.id, {
      name: "Kabab koobideh",
      grams: 220,
      nutrients,
    });
    const b = await createItem(ann.id, second.id, {
      name: "kabab  Koobideh",
      grams: 100,
      count: 2,
      nutrients,
    });
    expect(await rememberItem(ann.id, a.id)).not.toBeNull();
    expect(await rememberItem(ann.id, again.id)).not.toBeNull();
    expect(await rememberItem(ann.id, b.id)).not.toBeNull();
    expect(await rememberItem(ben.id, a.id)).toBeNull();
    const rows = await db
      .select()
      .from(foodMemory)
      .where(and(eq(foodMemory.userId, ann.id), sql`${foodMemory.nameKey} like 'kabab%'`));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ nameKey: "kabab koobideh", count: 2, typicalGrams: 210 });
  });

  it("lists recent and frequent foods with the last amount", async () => {
    const person = await createUser();
    const meal = await createMeal(person.id);
    await createItem(person.id, meal.id, { foodId: rice.id, grams: 150 });
    await createItem(person.id, meal.id, { foodId: rice.id, grams: 180, portionText: "1 cup" });
    const recent = await recentFoods(person.id);
    expect(recent).toHaveLength(1);
    expect(recent[0]).toMatchObject({ lastGrams: 180, lastPortionText: "1 cup", uses: 2 });
    expect((await frequentFoods(person.id))[0]!.food.id).toBe(rice.id);
    expect(await recentFoods(ben.id)).toEqual([]);
  });

  it("creates personal foods only their owner finds, by name and barcode", async () => {
    const food = await createCustomFood(ann.id, {
      nameEn: "Grandma's gheymeh",
      nameFa: "قیمه",
      barcode: "4006381333931",
      per100g: { energy: 150, protein: 9 },
    });
    expect(food.personal).toBe(true);
    expect((await searchFoods({ query: "gheymeh", userId: ann.id }))[0]?.id).toBe(food.id);
    expect(await searchFoods({ query: "gheymeh", userId: ben.id })).toEqual([]);
    expect((await findFoodByBarcode(ann.id, "4006381333931"))?.id).toBe(food.id);
    expect(await findFoodByBarcode(ben.id, "4006381333931")).toBeNull();
    // UPC-A digits find the product stored as EAN-13.
    expect((await findFoodByBarcode(ben.id, "036000291452"))?.id).toBe(rice.id);
  });
});

describe("trends, settings, export and deleting data", () => {
  it("adds up a week of meals", async () => {
    const person = await createUser();
    await createMeal(person.id, {
      localDate: "2026-10-30",
      eatenAt: new Date("2026-10-30T12:00:00Z"),
      totals: { energy: 900 },
    });
    await createMeal(person.id, {
      localDate: "2026-10-31",
      eatenAt: new Date("2026-10-31T19:00:00Z"),
      slot: "dinner",
      totals: { energy: 1100 },
    });
    const trends = await getTrends(person.id, "week", "2026-10-31");
    expect(trends.loggedDays).toBe(2);
    expect(trends.average.energy).toBe(1000);
    expect(trends.targets.energy?.target).toBe(2000);
  });

  it("saves the profile and preferences and refuses bad values", async () => {
    await updateProfile(ann.id, {
      sex: "male",
      birthYear: 1990,
      heightCm: 180,
      weightKg: 80,
      activityLevel: "moderate",
      goal: "keep",
    });
    const prefs = await updatePreferences(ann.id, {
      units: "imperial",
      timeZone: "Asia/Tehran",
      cuisines: ["Persian home cooking"],
      notifications: { analysisReady: true, questions: "yes" },
    });
    expect(prefs).toMatchObject({
      units: "imperial",
      timeZone: "Asia/Tehran",
      cuisines: ["Persian home cooking"],
      notifications: { analysisReady: true, questions: false },
    });
    await expect(updatePreferences(ann.id, { timeZone: "Mars/Base" })).rejects.toBeInstanceOf(
      SettingsInputError,
    );
    expect((await getPreferences(ann.id))!.timeZone).toBe("Asia/Tehran");
  });

  it("exports the person's meals and deletes only their data", async () => {
    const person = await createUser();
    const meal = await createMeal(person.id, { title: "Lunch" });
    await createItem(person.id, meal.id, { name: "Rice", nutrients: { energy: 260 } });
    await db
      .insert(aiKeys)
      .values({ userId: person.id, provider: "google", encryptedKey: "x", keyLastFour: "abcd" });
    const other = await createMeal(ben.id);

    const data = (await exportUserData(person.id))!;
    expect(data.meals).toHaveLength(1);
    expect(data.meals[0]!.items[0]!.name).toBe("Rice");
    expect(JSON.stringify(data)).not.toContain("passwordHash");
    expect(mealsToCsv(data)).toContain("Rice");

    expect(await deleteUserData(person.id)).toEqual({ meals: 1 });
    expect(await db.select().from(meals).where(eq(meals.userId, person.id))).toEqual([]);
    expect(await db.select().from(aiKeys).where(eq(aiKeys.userId, person.id))).toEqual([]);
    expect((await db.select().from(users).where(eq(users.id, person.id))).length).toBe(1);
    expect(await getMeal(ben.id, other.id)).not.toBeNull();
  });

  it("deletes a person's own dish together with their own food inside it", async () => {
    const person = await createUser();
    // The food is inserted first, so a single delete reaches it before the dish that uses it.
    const sauce = await createFood({ nameEn: "My sauce", ownerId: person.id });
    const dish = await createFood({ nameEn: "My pasta", ownerId: person.id, kind: "dish" });
    await db.insert(dishComponents).values({ dishId: dish.id, componentId: sauce.id, grams: 50 });

    expect(await deleteUserData(person.id)).toEqual({ meals: 0 });
    expect(await db.select().from(foods).where(eq(foods.ownerId, person.id))).toEqual([]);
    expect(
      await db.select().from(dishComponents).where(eq(dishComponents.dishId, dish.id)),
    ).toEqual([]);
  });
});

describe("routes", () => {
  const routes = async () => ({
    meal: await import("@/app/api/meals/[id]/route"),
    items: await import("@/app/api/meals/[id]/items/route"),
    item: await import("@/app/api/items/[id]/route"),
    remember: await import("@/app/api/items/[id]/remember/route"),
    answers: await import("@/app/api/meals/[id]/answers/route"),
    duplicate: await import("@/app/api/meals/[id]/duplicate/route"),
    manual: await import("@/app/api/manual-meals/route"),
    foods: await import("@/app/api/foods/route"),
    food: await import("@/app/api/foods/[id]/route"),
    barcode: await import("@/app/api/foods/barcode/[code]/route"),
    used: await import("@/app/api/foods/used/route"),
    exportRoute: await import("@/app/api/export/route"),
    me: await import("@/app/api/me/route"),
  });

  it("edit an item, rescale it, and keep the meal totals", async () => {
    const r = await routes();
    const meal = await createMeal(ann.id);
    const item = await createItem(ann.id, meal.id, {
      foodId: rice.id,
      grams: 100,
      nutrients: { energy: 130 },
    });
    const patched = await r.item.PATCH(
      request(`/api/items/${item.id}`, "PATCH", { grams: 250 }),
      ctx({ id: item.id }),
    );
    expect(patched.status).toBe(200);
    const body = (await patched.json()) as MealItemDto;
    expect(body.nutrients.energy).toBeCloseTo(325);
    expect(body.edited).toBe(true);
    const got = (await (
      await r.meal.GET(request(`/api/meals/${meal.id}`), ctx({ id: meal.id }))
    ).json()) as MealDto;
    expect(got.totals.energy).toBeCloseTo(325);
    expect(
      (
        await r.remember.POST(
          request(`/api/items/${item.id}/remember`, "POST"),
          ctx({ id: item.id }),
        )
      ).status,
    ).toBe(200);
  });

  it("treat another person's meals, items and foods as missing", async () => {
    const r = await routes();
    const meal = await createMeal(ben.id);
    const item = await createItem(ben.id, meal.id);
    const own = await createFood({ nameEn: "Ben's soup", ownerId: ben.id });
    const id = { id: meal.id };
    expect(
      (await r.meal.PATCH(request(`/api/meals/${meal.id}`, "PATCH", { title: "x" }), ctx(id)))
        .status,
    ).toBe(404);
    expect((await r.meal.DELETE(request(`/api/meals/${meal.id}`, "DELETE"), ctx(id))).status).toBe(
      404,
    );
    expect(
      (await r.items.POST(request(`/api/meals/${meal.id}/items`, "POST", { name: "x" }), ctx(id)))
        .status,
    ).toBe(404);
    expect(
      (
        await r.answers.POST(
          request(`/api/meals/${meal.id}/answers`, "POST", { questionId: "q", answer: "a" }),
          ctx(id),
        )
      ).status,
    ).toBe(404);
    expect(
      (
        await r.duplicate.POST(
          request(`/api/meals/${meal.id}/duplicate`, "POST", {
            eatenAt: new Date().toISOString(),
            tz: "UTC",
          }),
          ctx(id),
        )
      ).status,
    ).toBe(404);
    expect(
      (
        await r.item.PATCH(
          request(`/api/items/${item.id}`, "PATCH", { grams: 1 }),
          ctx({ id: item.id }),
        )
      ).status,
    ).toBe(404);
    expect(
      (await r.item.DELETE(request(`/api/items/${item.id}`, "DELETE"), ctx({ id: item.id })))
        .status,
    ).toBe(404);
    expect(
      (
        await r.remember.POST(
          request(`/api/items/${item.id}/remember`, "POST"),
          ctx({ id: item.id }),
        )
      ).status,
    ).toBe(404);
    expect((await r.food.GET(request(`/api/foods/${own.id}`), ctx({ id: own.id }))).status).toBe(
      404,
    );
    const manual = await r.manual.POST(
      request("/api/manual-meals", "POST", {
        eatenAt: new Date().toISOString(),
        tz: "UTC",
        items: [{ name: "Soup", foodId: own.id }],
      }),
    );
    expect(manual.status).toBe(400);
    const exported = await (await r.exportRoute.GET(request("/api/export?format=json"))).json();
    expect(JSON.stringify(exported)).not.toContain(meal.id);
    expect(((await (await r.me.GET(request("/api/me"))).json()) as { id: string }).id).toBe(ann.id);
    // Ben's item is untouched.
    const still = await db
      .select()
      .from(mealItems)
      .where(and(eq(mealItems.id, item.id), eq(mealItems.userId, ben.id)));
    expect(still).toHaveLength(1);
  });

  it("search, barcode, custom food and the used-foods list", async () => {
    const r = await routes();
    const found = (await (await r.foods.GET(request("/api/foods?q=rice"))).json()) as {
      foods: FoodResult[];
    };
    expect(found.foods.map((f) => f.id)).toContain(rice.id);
    expect(
      (
        await r.barcode.GET(
          request("/api/foods/barcode/036000291452"),
          ctx({ code: "036000291452" }),
        )
      ).status,
    ).toBe(200);
    expect(
      (await r.barcode.GET(request("/api/foods/barcode/12345670"), ctx({ code: "12345670" })))
        .status,
    ).toBe(404);
    expect(
      (await r.barcode.GET(request("/api/foods/barcode/abc"), ctx({ code: "abc" }))).status,
    ).toBe(400);
    const created = await r.foods.POST(
      request("/api/foods", "POST", { nameEn: "Dates", per: "100g", nutrients: { energy: 280 } }),
    );
    expect(created.status).toBe(201);
    const bad = await r.foods.POST(
      request("/api/foods", "POST", { nameEn: "", per: "100g", nutrients: { energy: 1 } }),
    );
    expect(bad.status).toBe(400);
    expect((await r.used.GET(request("/api/foods/used"))).status).toBe(200);
  });

  it("refuse cross-site changes and anonymous requests", async () => {
    const r = await routes();
    const meal = await createMeal(ann.id);
    const forged = await r.meal.DELETE(
      request(`/api/meals/${meal.id}`, "DELETE", undefined, { origin: "https://evil.example.net" }),
      ctx({ id: meal.id }),
    );
    expect(forged.status).toBe(403);
    session.user = null;
    expect((await r.me.GET(request("/api/me"))).status).toBe(401);
    expect((await r.foods.GET(request("/api/foods?q=rice"))).status).toBe(401);
    expect(await getMeal(ann.id, meal.id)).not.toBeNull();
  });

  it("log a manual meal and duplicate it", async () => {
    const r = await routes();
    const response = await r.manual.POST(
      request("/api/manual-meals", "POST", {
        eatenAt: new Date(Date.now() - 3_600_000).toISOString(),
        tz: "Europe/Berlin",
        items: [{ name: "Rice", foodId: rice.id, grams: 150 }],
      }),
    );
    expect(response.status).toBe(201);
    const meal = (await response.json()) as MealDto;
    expect(meal.totals.energy).toBeCloseTo(195);
    const copy = await r.duplicate.POST(
      request(`/api/meals/${meal.id}/duplicate`, "POST", {
        eatenAt: new Date().toISOString(),
        tz: "Europe/Berlin",
      }),
      ctx({ id: meal.id }),
    );
    expect(copy.status).toBe(201);
    expect(((await copy.json()) as MealDto).items).toHaveLength(1);
    const future = await r.manual.POST(
      request("/api/manual-meals", "POST", {
        eatenAt: new Date(Date.now() + 86_400_000).toISOString(),
        tz: "UTC",
        items: [{ name: "x" }],
      }),
    );
    expect(future.status).toBe(400);
  });
});
