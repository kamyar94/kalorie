// Mealie, openGym and Web Push against Postgres and the recorded-shape mocks
// (tests/helpers/mock-integrations.ts), on the FoodData Central fixture foods: connecting with a
// token, planned meals and one-tap logging, recipe nutrition from Mealie or computed from the
// ingredients, "Save nutrition to Mealie", search, the analysis context, plan suggestions and
// writing a confirmed plan; pairing openGym, weigh-ins for the targets, workouts with an energy
// estimate, token renewal, never writing; push subscriptions, encrypted sending, expired
// subscriptions, and a notification after an analysis. Every part keeps people apart.
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { and, eq, sql } from "drizzle-orm";
import { NextRequest } from "next/server";
import sharp from "sharp";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { db } from "@/db";
import {
  bodyMeasurements,
  dishComponents,
  foods,
  integrations,
  jobs,
  mealItems,
  meals,
  pushSubscriptions,
  users,
} from "@/db/schema";
import { listActivities } from "@/lib/activities/service";
import { saveProviderKey } from "@/lib/ai/service";
import { setAnalysisFinishedListener } from "@/lib/analysis/events";
import { setPlannedRecipesSource } from "@/lib/analysis/planned";
import type { SessionUser } from "@/lib/auth/accounts";
import { decryptSecret, integrationContext } from "@/lib/crypto";
import { getDayPlan, getIntegrationStatuses, getWeightHistory } from "@/lib/integrations/day";
import {
  clearPlannedCache,
  confirmMealPlan,
  connectMealie,
  getRecipeInfo,
  localToday,
  logPlannedMeal,
  plannedRecipesForAnalysis,
  saveNutritionToMealie,
  searchMealieRecipes,
  suggestMealPlan,
  testMealie,
} from "@/lib/integrations/mealie/service";
import { pairOpenGym, syncOpenGym } from "@/lib/integrations/opengym/service";
import { readCredential } from "@/lib/integrations/store";
import { createPhotoMeal } from "@/lib/meals/create";
import { getMeal } from "@/lib/meals/service";
import { generateVapidKeys } from "@/lib/push/webpush";
import { notifyUser, onAnalysisFinished, PUSH_JOB, saveSubscription } from "@/lib/push/service";
import { drainJobs } from "@/lib/queue/worker";
import { getTargets } from "@/lib/targets/service";
import { getTrends } from "@/lib/trends/service";
import { installWorkerHooks, jobHandlers } from "@/worker/handlers";
import { startAiMock, TEST_API_KEY, useAiMock, type AiMock } from "@/tests/helpers/ai-mock";
import { createUser } from "@/tests/helpers/factories";
import { importFdcFixtures, seedDishFixtures } from "@/tests/helpers/food-data";
import {
  decryptPush,
  MEALIE_TOKEN,
  startIntegrationMocks,
  verifyVapid,
  type IntegrationMocks,
} from "@/tests/helpers/mock-integrations";
import { E2E_MEAL } from "@/tests/helpers/mock-integrations";
import { aiReplies } from "@/tests/helpers/ai-mock";
import { promptOf, matchingReply } from "@/tests/fixtures/analysis";

const session = vi.hoisted(() => ({ user: null as SessionUser | null }));
vi.mock("@/lib/auth/session", () => ({ getCurrentUser: async () => session.user }));

let mocks: IntegrationMocks;
let ai: AiMock;
let restoreAi: () => void;
let photoRoot: string;
const vapid = generateVapidKeys();

const setEnv = (values: Record<string, string>) => {
  for (const [key, value] of Object.entries(values)) vi.stubEnv(key, value);
};

beforeAll(async () => {
  mocks = await startIntegrationMocks();
  ai = await startAiMock();
  restoreAi = useAiMock(ai);
  photoRoot = mkdtempSync(path.join(os.tmpdir(), "cal-integrations-"));
  await importFdcFixtures();
  await seedDishFixtures();
});

afterAll(async () => {
  restoreAi();
  await ai.close();
  await mocks.close();
  rmSync(photoRoot, { recursive: true, force: true });
});

beforeEach(async () => {
  mocks.reset();
  ai.reset();
  clearPlannedCache();
  setAnalysisFinishedListener(null);
  setPlannedRecipesSource(null);
  vi.unstubAllEnvs();
  setEnv({
    MEALIE_BASE_URL: mocks.env.MEALIE_BASE_URL!,
    OPENGYM_BASE_URL: mocks.env.OPENGYM_BASE_URL!,
    PUSH_ENDPOINT_ORIGINS: mocks.env.PUSH_ENDPOINT_ORIGINS!,
    VAPID_PUBLIC_KEY: vapid.publicKey,
    VAPID_PRIVATE_KEY: vapid.privateKey,
    VAPID_SUBJECT: "mailto:admin@example.org",
    PHOTO_ROOT: photoRoot,
  });
  await db.execute(sql`delete from rate_limits`);
  await db.execute(sql`delete from jobs`);
});

const writes = (service: string) =>
  mocks.requests.filter((r) => r.service === service && r.method !== "GET");

const connected = async (overrides = {}) => {
  const user = await createUser(overrides);
  expect(await connectMealie(user.id, MEALIE_TOKEN)).toEqual({ ok: true });
  return user;
};

describe("Mealie", () => {
  it("tests the token before storing it, encrypted, for that person only", async () => {
    const user = await createUser();
    expect(await connectMealie(user.id, "short")).toMatchObject({ ok: false, status: 400 });
    expect(await connectMealie(user.id, "wrong-token-0123456789")).toMatchObject({
      ok: false,
      status: 422,
    });
    expect(await readCredential(user.id, "mealie")).toBeNull();

    expect(await connectMealie(user.id, MEALIE_TOKEN)).toEqual({ ok: true });
    const row = (await db.select().from(integrations).where(eq(integrations.userId, user.id)))[0]!;
    expect(row.encryptedCredential).not.toContain(MEALIE_TOKEN);
    expect(decryptSecret(row.encryptedCredential!, integrationContext(user.id, "mealie"))).toBe(
      MEALIE_TOKEN,
    );
    expect(mocks.requests.at(-1)).toMatchObject({
      service: "mealie",
      path: "/api/users/self",
      authorization: `Bearer ${MEALIE_TOKEN}`,
    });
    const [mealie] = await getIntegrationStatuses(user.id);
    expect(mealie).toMatchObject({
      kind: "mealie",
      available: true,
      connected: true,
      status: "ok",
    });
    const other = await createUser();
    expect((await getIntegrationStatuses(other.id))[0]).toMatchObject({ connected: false });
    expect(await testMealie(other.id)).toMatchObject({ ok: false, status: 422 });
  });

  it("is off without a server address", async () => {
    vi.stubEnv("MEALIE_BASE_URL", "");
    const user = await createUser();
    expect(await connectMealie(user.id, MEALIE_TOKEN)).toMatchObject({ ok: false, status: 503 });
    expect((await getIntegrationStatuses(user.id))[0]).toMatchObject({ available: false });
  });

  it("shows today's planned recipes and logs one with servings", async () => {
    const user = await connected();
    const today = localToday(user.timeZone);
    mocks.mealie.today = today;
    mocks.mealie.plan(today, "dinner", "chicken-and-rice");
    mocks.mealie.plan(today, "side", null, "Salad from the garden");
    mocks.mealie.plan("2020-01-01", "lunch", "salmon-salad");

    const plan = await getDayPlan(user.id, today, { today });
    expect(plan.mealieConnected).toBe(true);
    expect(plan.planned).toHaveLength(2);
    expect(plan.planned[0]).toMatchObject({
      name: "Chicken and rice",
      slot: "dinner",
      kcalPerServing: 650,
      recipeSlug: "chicken-and-rice",
      logged: false,
    });
    expect(plan.planned[1]).toMatchObject({ name: "Salad from the garden", slot: null });
    expect(mocks.requests.some((r) => r.path === "/api/households/mealplans/today")).toBe(true);

    const entryId = plan.planned[0]!.id;
    const logged = await logPlannedMeal(user.id, entryId, {
      servings: 2,
      eatenAt: new Date().toISOString(),
      tz: user.timeZone,
    });
    expect(logged.ok).toBe(true);
    const mealId = (logged as { mealId: string }).mealId;
    const meal = (await getMeal(user.id, mealId))!;
    expect(meal).toMatchObject({
      source: "mealie",
      status: "ready",
      title: "Chicken and rice",
      slot: "dinner",
    });
    expect(meal.items[0]).toMatchObject({ count: 2, nutrientSource: "recipe", kind: "dish" });
    expect(meal.items[0]!.nutrients.energy).toBeCloseTo(1300, 0);
    expect(meal.totals.protein).toBeCloseTo(90, 0);

    // Again: the same meal, and the chip shows it as logged.
    expect(
      await logPlannedMeal(user.id, entryId, {
        servings: 1,
        eatenAt: new Date().toISOString(),
        tz: "UTC",
      }),
    ).toEqual({ ok: true, mealId });
    clearPlannedCache();
    expect((await getDayPlan(user.id, today, { today })).planned[0]!.logged).toBe(true);
    // Entries without a recipe cannot be logged; unknown ones are missing.
    expect(
      await logPlannedMeal(user.id, plan.planned[1]!.id, {
        servings: 1,
        eatenAt: new Date().toISOString(),
        tz: "UTC",
      }),
    ).toMatchObject({ ok: false, status: 422 });
    expect(
      await logPlannedMeal(user.id, "999", {
        servings: 1,
        eatenAt: new Date().toISOString(),
        tz: "UTC",
      }),
    ).toMatchObject({ ok: false, status: 404 });
    // Another person without Mealie cannot log the household's entry.
    const other = await createUser();
    expect(
      (
        await logPlannedMeal(other.id, entryId, {
          servings: 1,
          eatenAt: new Date().toISOString(),
          tz: "UTC",
        })
      ).ok,
    ).toBe(false);
    expect(writes("mealie")).toHaveLength(0);
  });

  it("reads the day by date when Mealie's today is another day", async () => {
    const user = await connected();
    const today = localToday(user.timeZone);
    mocks.mealie.today = "2020-01-01";
    mocks.mealie.plan("2020-01-01", "lunch", "salmon-salad");
    mocks.mealie.plan(today, "breakfast", "greek-yogurt-bowl");
    const plan = await getDayPlan(user.id, today, { today });
    expect(plan.planned.map((p) => p.name)).toEqual(["Greek yogurt bowl"]);
  });

  it("computes nutrition from the ingredients and saves it to Mealie only on request", async () => {
    const user = await connected();
    const info = await getRecipeInfo(user.id, "lentil-soup");
    expect(info.ok).toBe(true);
    const recipe = (info as { recipe: import("@/lib/contracts/integrations").RecipeInfoDto })
      .recipe;
    expect(recipe.nutritionSource).toBe("computed");
    expect(recipe.ingredients.total).toBe(5);
    expect(recipe.ingredients.matched).toBeGreaterThanOrEqual(4);
    expect(recipe.perServing.energy).toBeGreaterThan(150);
    expect(recipe.canSaveToMealie).toBe(true);
    expect(recipe.food).toMatchObject({ kind: "dish", source: "mealie", personal: true });
    const parts = await db
      .select()
      .from(dishComponents)
      .where(eq(dishComponents.dishId, recipe.food!.id));
    expect(parts.length).toBe(recipe.ingredients.matched);
    // Lentils: 800 g for 4 servings.
    expect(parts.some((p) => Math.abs(p.grams - 200) < 0.01)).toBe(true);
    expect(writes("mealie")).toHaveLength(0);

    const saved = await saveNutritionToMealie(user.id, "lentil-soup");
    expect(saved.ok).toBe(true);
    const patch = writes("mealie");
    expect(patch).toHaveLength(1);
    expect(patch[0]).toMatchObject({ method: "PATCH", path: "/api/recipes/lentil-soup" });
    const sent = (patch[0]!.body as { nutrition: Record<string, string> }).nutrition;
    expect(Number(sent.calories)).toBeCloseTo(recipe.perServing.energy!, -1);
    expect(sent.proteinContent).toMatch(/^\d+(\.\d)?$/);
    expect(mocks.mealie.recipes.get("lentil-soup")!.nutrition!.calories).toBe(sent.calories);
    const after = (saved as { recipe: import("@/lib/contracts/integrations").RecipeInfoDto })
      .recipe;
    expect(after).toMatchObject({ nutritionSource: "mealie", canSaveToMealie: false });

    // Mealie has nutrition now (and the other recipe always had): nothing more is written.
    expect(await saveNutritionToMealie(user.id, "lentil-soup")).toMatchObject({
      ok: false,
      status: 409,
    });
    expect(await saveNutritionToMealie(user.id, "chicken-and-rice")).toMatchObject({
      ok: false,
      status: 409,
    });
    expect(writes("mealie")).toHaveLength(1);
    // The recipe food is the person's own.
    const other = await createUser();
    const visible = await db
      .select()
      .from(foods)
      .where(and(eq(foods.source, "mealie"), eq(foods.ownerId, other.id)));
    expect(visible).toHaveLength(0);
  });

  it("finds recipes for the food search, and none without a connection", async () => {
    const user = await connected();
    expect(await searchMealieRecipes(user.id, "soup")).toEqual([
      expect.objectContaining({ slug: "lentil-soup", name: "Lentil soup" }),
    ]);
    session.user = { ...(user as unknown as SessionUser), id: user.id };
    const route = await import("@/app/api/foods/route");
    const response = await route.GET(new NextRequest("http://127.0.0.1:3205/api/foods?q=soup"));
    const body = (await response.json()) as { recipes: { slug: string }[] };
    expect(body.recipes.map((r) => r.slug)).toEqual(["lentil-soup"]);
    const other = await createUser();
    expect(await searchMealieRecipes(other.id, "soup")).toEqual([]);
  });

  it("passes the day's planned recipes into the photo analysis", async () => {
    const user = await connected();
    await saveProviderKey(user.id, "google", TEST_API_KEY);
    const day = "2026-10-31";
    mocks.mealie.plan(day, "dinner", "chicken-and-rice");
    const planned = await plannedRecipesForAnalysis(user.id, day);
    expect(planned).toEqual([
      expect.objectContaining({
        name: "Chicken and rice",
        slot: "dinner",
        nutritionPerServing: expect.objectContaining({ energy: 650 }),
      }),
    ]);
    expect(planned[0]!.foodId).toMatch(/^[0-9a-f-]{36}$/);

    installWorkerHooks();
    ai.queue("google", aiReplies.google.json(E2E_MEAL), matchingReply("google"));
    const photo = await sharp({
      create: { width: 64, height: 64, channels: 3, background: "#a07040" },
    })
      .jpeg()
      .toBuffer();
    await createPhotoMeal({
      userId: user.id,
      clientId: null,
      eatenAt: new Date(`${day}T18:30:00Z`),
      tz: "UTC",
      note: null,
      photos: [photo],
    });
    await drainJobs(jobHandlers);
    const vision = ai.requests.find((r) => r.provider === "google");
    expect(promptOf("google", vision!)).toContain("Chicken and rice");
  });

  it("suggests a plan within the targets and writes it only when confirmed", async () => {
    const user = await connected();
    const today = localToday("UTC");
    const shift = (n: number) => {
      const d = new Date(`${today}T00:00:00Z`);
      d.setUTCDate(d.getUTCDate() + n);
      return d.toISOString().slice(0, 10);
    };
    const days = [shift(1), shift(2)];
    const result = await suggestMealPlan(
      user.id,
      { days, slots: ["breakfast", "lunch", "dinner"] },
      today,
    );
    expect(result.ok).toBe(true);
    const plan = (result as { plan: import("@/lib/contracts/integrations").PlanSuggestionDto })
      .plan;
    expect(plan.days.map((d) => d.date)).toEqual(days);
    for (const day of plan.days) {
      expect(day.entries.map((e) => e.slot)).toEqual(["breakfast", "lunch", "dinner"]);
      expect(new Set(day.entries.map((e) => e.recipeId)).size).toBe(3);
      if (day.meetsTargets) {
        expect(day.kcal).toBeLessThanOrEqual(day.energyBudget);
        expect(day.protein).toBeGreaterThanOrEqual(day.proteinMin);
      }
    }
    expect(plan.days.some((d) => d.meetsTargets)).toBe(true);
    // Deterministic, and nothing written yet.
    const again = await suggestMealPlan(
      user.id,
      { days, slots: ["breakfast", "lunch", "dinner"] },
      today,
    );
    expect(again).toEqual(result);
    expect(writes("mealie")).toHaveLength(0);

    expect(
      await suggestMealPlan(user.id, { days: ["2001-01-01"], slots: ["dinner"] }, today),
    ).toMatchObject({ ok: false, status: 400 });
    expect(
      await confirmMealPlan(user.id, [{ date: days[0], slot: "brunch", recipeId: "x" }], today),
    ).toMatchObject({ ok: false, status: 400 });

    const entries = plan.days.flatMap((d) => d.entries);
    const confirmed = await confirmMealPlan(user.id, entries, today);
    expect(confirmed).toEqual({ ok: true, written: 6, failed: 0 });
    const posted = writes("mealie");
    expect(posted).toHaveLength(6);
    expect(posted[0]).toMatchObject({ method: "POST", path: "/api/households/mealplans" });
    expect(posted[0]!.body).toMatchObject({
      date: days[0],
      entryType: "breakfast",
      recipeId: entries[0]!.recipeId,
    });
    expect(mocks.mealie.plans.filter((p) => days.includes(p.date))).toHaveLength(6);
  });

  it("marks the connection when Mealie stops accepting the token, and Today keeps working", async () => {
    const user = await connected();
    mocks.mealie.tokens.clear();
    expect(await testMealie(user.id)).toMatchObject({ ok: false, status: 422 });
    expect((await getIntegrationStatuses(user.id))[0]).toMatchObject({ status: "error" });
    const today = localToday(user.timeZone);
    expect((await getDayPlan(user.id, today, { today })).planned).toEqual([]);
  });
});

describe("openGym", () => {
  it("refuses malformed, unknown and expired codes", async () => {
    const user = await createUser();
    expect(await pairOpenGym(user.id, "abc")).toMatchObject({ ok: false, status: 400 });
    expect(await pairOpenGym(user.id, "ABCDEFGH")).toMatchObject({ ok: false, status: 422 });
    const code = mocks.opengym.newCode();
    mocks.opengym.codes.set(code, Date.now() - 1);
    expect(await pairOpenGym(user.id, code)).toMatchObject({ ok: false, status: 422 });
    expect(await readCredential(user.id, "opengym")).toBeNull();
  });

  it("pairs, reads weigh-ins and workouts, feeds the targets and never writes", async () => {
    const user = await createUser({
      sex: "male",
      birthYear: 1990,
      heightCm: 180,
      weightKg: 95,
      activityLevel: "moderate",
      goal: "keep",
    });
    const before = (await getTargets(user.id)).targets.energy!.target!;
    const code = mocks.opengym.newCode();
    expect(
      await pairOpenGym(user.id, ` ${code.slice(0, 4).toLowerCase()}-${code.slice(4)} `),
    ).toEqual({ ok: true });
    const token = await readCredential(user.id, "opengym");
    expect(token).toBeTruthy();
    const row = (
      await db
        .select()
        .from(integrations)
        .where(and(eq(integrations.userId, user.id), eq(integrations.kind, "opengym")))
    )[0]!;
    expect(row.encryptedCredential).not.toContain(token!);

    const status = (await getIntegrationStatuses(user.id))[1]!;
    expect(status).toMatchObject({ kind: "opengym", connected: true, status: "ok" });
    expect(status.latestWeight).toMatchObject({ kg: 79.6 });
    // The targets use the latest weigh-in (79.6 kg) instead of the profile's 95 kg.
    const after = (await getTargets(user.id)).targets.energy!.target!;
    expect(after).toBeLessThan(before);
    expect((await getTargets(user.id)).targets.protein!.target).toBeCloseTo(1.6 * 79.6, 0);

    const today = new Date().toISOString().slice(0, 10);
    const plan = await getDayPlan(user.id, today, { today });
    expect(plan.workouts).toEqual([
      expect.objectContaining({
        id: "w-today",
        name: "Legs",
        durationMin: 60,
        startTime: "07:00",
        exercises: ["Squat", "Sled push"],
        // 3.5 MET (resistance training) x 79.6 kg x 1 h
        kcalEstimate: 279,
      }),
    ]);
    const weights = await getWeightHistory(user.id, "2000-01-01", today);
    expect(weights.map((w) => w.kg)).toEqual([81.2, 80.4, 79.6]);
    // The trends overlay: weigh-ins of the month.
    expect((await getTrends(user.id, "month", today)).weight.map((w) => w.kg)).toEqual([
      81.2, 80.4, 79.6,
    ]);

    const other = await createUser();
    expect((await getDayPlan(other.id, today, { today })).workouts).toEqual([]);
    expect(await getWeightHistory(other.id, "2000-01-01", today)).toEqual([]);

    const sent = mocks.requests.filter((r) => r.service === "opengym");
    expect(sent.every((r) => r.method === "GET" || r.path === "/api/pair/redeem")).toBe(true);
    expect(
      sent
        .filter((r) => r.path === "/api/data")
        .every((r) => r.authorization === `Bearer ${token}`),
    ).toBe(true);
  });

  it("turns workouts into activities, once, and follows removals in openGym", async () => {
    const user = await createUser({ weightKg: 90 });
    expect(await pairOpenGym(user.id, mocks.opengym.newCode())).toEqual({ ok: true });
    const mine = () => listActivities(user.id);
    expect((await mine()).map((a) => [a.title, a.category, a.source, a.durationMin])).toEqual([
      ["Legs", "strength", "opengym", 60],
      ["Upper body", "strength", "opengym", 45],
    ]);
    // The workout's own body weight: 3.5 MET x 79.6 kg x 1 h.
    expect((await mine())[0]).toMatchObject({ energyKcal: 279, intensity: "moderate" });

    await syncOpenGym(user.id);
    expect(await mine()).toHaveLength(2);

    const state = mocks.opengym.state as { workouts: { id: string }[] };
    mocks.opengym.state = { ...state, workouts: state.workouts.filter((w) => w.id !== "w-old") };
    await syncOpenGym(user.id);
    expect((await mine()).map((a) => a.title)).toEqual(["Legs"]);
    expect(await listActivities((await createUser()).id)).toEqual([]);
  });

  it("keeps weigh-ins as Body's weight values and follows removals in openGym", async () => {
    const user = await createUser();
    expect(await pairOpenGym(user.id, mocks.opengym.newCode())).toEqual({ ok: true });
    const values = () =>
      db
        .select()
        .from(bodyMeasurements)
        .where(eq(bodyMeasurements.userId, user.id))
        .orderBy(bodyMeasurements.localDate);
    expect((await values()).map((v) => [v.code, v.value, v.source])).toEqual([
      ["weight", 81.2, "opengym"],
      ["weight", 80.4, "opengym"],
      ["weight", 79.6, "opengym"],
    ]);
    const state = mocks.opengym.state as { bodyweight: { w: number }[] };
    mocks.opengym.state = { ...state, bodyweight: state.bodyweight.filter((b) => b.w !== 80.4) };
    await syncOpenGym(user.id);
    expect((await values()).map((v) => v.value)).toEqual([81.2, 79.6]);
  });

  it("keeps the fresh token /api/me hands out, converts pounds, and notices a sign-out", async () => {
    const user = await createUser();
    expect(await pairOpenGym(user.id, mocks.opengym.newCode())).toEqual({ ok: true });
    mocks.opengym.renewWith = "renewed-token-0123456789";
    mocks.opengym.state = {
      unit: "lb",
      bodyweight: [{ d: "2026-10-30", w: 176, t: 1 }],
      workouts: [],
    };
    const synced = await syncOpenGym(user.id);
    expect(synced.ok).toBe(true);
    expect(await readCredential(user.id, "opengym")).toBe("renewed-token-0123456789");
    expect((await getIntegrationStatuses(user.id))[1]!.latestWeight).toEqual({
      date: "2026-10-30",
      kg: 79.8,
    });

    mocks.opengym.tokens.clear();
    expect(await syncOpenGym(user.id)).toMatchObject({
      ok: false,
      status: 502,
      error: expect.stringMatching(/Pair again/),
    });
    expect((await getIntegrationStatuses(user.id))[1]).toMatchObject({ status: "error" });
  });

  it("answers the sync route: 409 before pairing, 502 when signed out, 503 when not set up", async () => {
    const user = await createUser();
    session.user = { ...(user as unknown as SessionUser), id: user.id };
    const route = await import("@/app/api/integrations/opengym/sync/route");
    const sync = async () => {
      const response = await route.POST(
        new NextRequest("http://127.0.0.1:3205/api/integrations/opengym/sync", {
          method: "POST",
          headers: { origin: "http://127.0.0.1:3205", "x-forwarded-host": "127.0.0.1:3205" },
        }),
      );
      return { status: response.status, body: (await response.json()) as Record<string, unknown> };
    };

    expect(await sync()).toEqual({
      status: 409,
      body: { error: "Pair openGym in Settings first." },
    });
    expect(await pairOpenGym(user.id, mocks.opengym.newCode())).toEqual({ ok: true });
    expect(await sync()).toMatchObject({ status: 200, body: { ok: true } });
    mocks.opengym.tokens.clear();
    expect(await sync()).toMatchObject({
      status: 502,
      body: { error: expect.stringMatching(/Pair again/) },
    });
    vi.stubEnv("OPENGYM_BASE_URL", "");
    expect(await sync()).toMatchObject({ status: 503 });
  });
});

describe("Web Push", () => {
  it("stores subscriptions only for push services and moves an endpoint to its new account", async () => {
    const ann = await createUser();
    const ben = await createUser();
    const sub = mocks.push.subscriber();
    expect(
      await saveSubscription(
        ann.id,
        { endpoint: "https://evil.example.org/x", keys: sub.keys },
        null,
      ),
    ).toMatchObject({ ok: false, status: 400 });
    expect(
      await saveSubscription(
        ann.id,
        { endpoint: sub.endpoint, keys: { p256dh: "AAAA", auth: sub.keys.auth } },
        null,
      ),
    ).toMatchObject({ ok: false, status: 400 });
    expect(await saveSubscription(ann.id, sub, "Test browser")).toEqual({ ok: true });
    expect(await saveSubscription(ben.id, sub, "Test browser")).toEqual({ ok: true });
    const rows = await db
      .select()
      .from(pushSubscriptions)
      .where(eq(pushSubscriptions.endpoint, sub.endpoint));
    expect(rows.map((r) => r.userId)).toEqual([ben.id]);
  });

  it("sends encrypted, VAPID-signed messages and removes expired subscriptions", async () => {
    const user = await createUser();
    const live = mocks.push.subscriber("live");
    const gone = mocks.push.subscriber("gone");
    mocks.push.gone.add("gone");
    await saveSubscription(user.id, live, null);
    await saveSubscription(user.id, gone, null);
    const result = await notifyUser(user.id, {
      title: "Your meal is analysed",
      body: "Lunch",
      url: "/meals/x",
      tag: "meal-x",
    });
    expect(result).toMatchObject({ sent: 1, removed: 1 });
    const received = mocks.push.received.find((r) => r.id === "live")!;
    expect(received.headers["content-encoding"]).toBe("aes128gcm");
    expect(Number(received.headers.ttl)).toBeGreaterThan(0);
    expect(decryptPush(received.body, live)).toMatchObject({
      title: "Your meal is analysed",
      url: "/meals/x",
    });
    expect(verifyVapid(received.headers.authorization!)).toMatchObject({
      aud: mocks.url,
      sub: "mailto:admin@example.org",
    });
    const left = await db
      .select()
      .from(pushSubscriptions)
      .where(eq(pushSubscriptions.userId, user.id));
    expect(left.map((r) => r.endpoint)).toEqual([live.endpoint]);
  });

  it("notifies after an analysis only when the person turned it on", async () => {
    const user = await createUser();
    await saveProviderKey(user.id, "google", TEST_API_KEY);
    const sub = mocks.push.subscriber();
    await saveSubscription(user.id, sub, null);
    installWorkerHooks();
    const photo = await sharp({
      create: { width: 64, height: 64, channels: 3, background: "#806040" },
    })
      .jpeg()
      .toBuffer();
    const upload = () =>
      createPhotoMeal({
        userId: user.id,
        clientId: null,
        eatenAt: new Date(),
        tz: "UTC",
        note: null,
        photos: [photo],
      });

    // Off: no job, nothing sent.
    ai.queue("google", aiReplies.google.json(E2E_MEAL), matchingReply("google"));
    await upload();
    await drainJobs(jobHandlers);
    expect(mocks.push.received).toHaveLength(0);

    await db
      .update(users)
      .set({ notifications: { analysisReady: true, questions: false } })
      .where(eq(users.id, user.id));
    ai.queue("google", aiReplies.google.json(E2E_MEAL), matchingReply("google"));
    const { meal } = await upload();
    await drainJobs(jobHandlers);
    expect(mocks.push.received).toHaveLength(1);
    const message = decryptPush(mocks.push.received[0]!.body, sub);
    expect(message).toMatchObject({ title: "Your meal is analysed", url: `/meals/${meal.id}` });
    expect(String(message.body)).toMatch(/kcal/);
    const done = await db.select().from(jobs).where(eq(jobs.kind, PUSH_JOB));
    expect(done.every((j) => j.status === "done")).toBe(true);

    // A question about the meal, once that kind is on too.
    await db
      .update(users)
      .set({ notifications: { analysisReady: true, questions: true } })
      .where(eq(users.id, user.id));
    await db
      .update(meals)
      .set({
        status: "needs_input",
        questions: [{ id: "q1", text: "Was the chicken fried?", answers: ["Yes", "No"] }],
      })
      .where(eq(meals.id, meal.id));
    await onAnalysisFinished({
      userId: user.id,
      mealId: meal.id,
      status: "needs_input",
      questions: 1,
      errorKind: null,
    });
    await drainJobs(jobHandlers);
    expect(mocks.push.received).toHaveLength(2);
    expect(decryptPush(mocks.push.received[1]!.body, sub)).toMatchObject({
      title: "A question about your meal",
      body: expect.stringContaining("Was the chicken fried?"),
    });
    await db
      .update(users)
      .set({ notifications: { analysisReady: true, questions: false } })
      .where(eq(users.id, user.id));

    // A question notification is off: no job for it.
    await onAnalysisFinished({
      userId: user.id,
      mealId: meal.id,
      status: "needs_input",
      questions: 1,
      errorKind: null,
    });
    expect(
      await db
        .select()
        .from(jobs)
        .where(and(eq(jobs.kind, PUSH_JOB), eq(jobs.status, "queued"))),
    ).toHaveLength(0);
  });

  it("answers the routes: key, subscribe, unsubscribe", async () => {
    const user = await createUser();
    session.user = {
      id: user.id,
      username: user.username,
      displayName: user.displayName,
      role: user.role,
      timeZone: user.timeZone,
      units: user.units,
    } as SessionUser;
    const headers = {
      origin: "http://127.0.0.1:3205",
      "x-forwarded-host": "127.0.0.1:3205",
      "content-type": "application/json",
    };
    const key = await import("@/app/api/push/key/route");
    const subs = await import("@/app/api/push/subscriptions/route");
    const keyBody = (await (
      await key.GET(new NextRequest("http://127.0.0.1:3205/api/push/key"))
    ).json()) as { publicKey: string };
    expect(keyBody.publicKey).toBe(vapid.publicKey);
    const sub = mocks.push.subscriber();
    const created = await subs.POST(
      new NextRequest("http://127.0.0.1:3205/api/push/subscriptions", {
        method: "POST",
        headers,
        body: JSON.stringify(sub),
      }),
    );
    expect(created.status).toBe(201);
    const removed = await subs.DELETE(
      new NextRequest("http://127.0.0.1:3205/api/push/subscriptions", {
        method: "DELETE",
        headers,
        body: JSON.stringify({ endpoint: sub.endpoint }),
      }),
    );
    expect(removed.status).toBe(200);
    expect(
      await db.select().from(pushSubscriptions).where(eq(pushSubscriptions.userId, user.id)),
    ).toHaveLength(0);
    vi.stubEnv("VAPID_PRIVATE_KEY", "");
    expect((await key.GET(new NextRequest("http://127.0.0.1:3205/api/push/key"))).status).toBe(404);
  });
});

describe("meals and items stay the person's own", () => {
  it("logs planned meals into the right account", async () => {
    const user = await connected();
    const today = localToday(user.timeZone);
    mocks.mealie.today = today;
    const entry = mocks.mealie.plan(today, "lunch", "salmon-salad");
    const logged = await logPlannedMeal(user.id, String(entry.id), {
      servings: 1,
      eatenAt: new Date().toISOString(),
      tz: "UTC",
    });
    expect(logged.ok).toBe(true);
    const rows = await db
      .select({ userId: mealItems.userId })
      .from(mealItems)
      .innerJoin(meals, eq(meals.id, mealItems.mealId))
      .where(eq(meals.id, (logged as { mealId: string }).mealId));
    expect(rows.every((r) => r.userId === user.id)).toBe(true);
  });
});
