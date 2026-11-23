// "What should I eat?" against Postgres through its routes: GET /api/suggestions for now in a
// zone that is not UTC (Tehran, 3:30 ahead, no daylight saving: a meal 24 hours earlier is at the
// same time of day), what is left today, the pattern of the last weeks, distinct past meals and
// favorites, "Log this" (a copy at now through the existing routes) and its Undo, the zone from
// the request, the device cookie or the profile, too little history, someone else's meals, and
// "Something new" through the person's own AI (the provider mock). Values are made up; times are
// counted from the moment the test runs.
import { eq, sql } from "drizzle-orm";
import { NextRequest } from "next/server";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { db } from "@/db";
import { meals } from "@/db/schema";
import { saveProviderKey } from "@/lib/ai/service";
import type { SessionUser } from "@/lib/auth/accounts";
import { saveHealthProfile } from "@/lib/body/health";
import type { MealDto } from "@/lib/contracts/meals";
import type { NutrientMap } from "@/lib/contracts/nutrients";
import type { MealIdeaDto, SuggestionsDto } from "@/lib/contracts/suggest";
import { localParts } from "@/lib/meals/time";
import {
  aiReplies,
  startAiMock,
  TEST_API_KEY,
  useAiMock,
  type AiMock,
} from "@/tests/helpers/ai-mock";
import { createItem, createMeal, createUser } from "@/tests/helpers/factories";

const session = vi.hoisted(() => ({ user: null as SessionUser | null }));
vi.mock("@/lib/auth/session", () => ({
  getCurrentUser: async () => session.user,
}));
// The cookie's name only (the module itself is server-only).
vi.mock("@/lib/ui/viewer-time", () => ({ TZ_COOKIE: "cal_tz" }));

const suggestRoute = await import("@/app/api/suggestions/route");
const ideaRoute = await import("@/app/api/suggestions/idea/route");
const duplicateRoute = await import("@/app/api/meals/[id]/duplicate/route");
const favoriteRoute = await import("@/app/api/favorites/[mealId]/log/route");
const mealRoute = await import("@/app/api/meals/[id]/route");

const ORIGIN = "http://127.0.0.1:3201";
const HEADERS = { origin: ORIGIN, "x-forwarded-host": "127.0.0.1:3201" };
const TZ = "Asia/Tehran";
const DAY = 86_400_000;

let ai: AiMock;
let restore: () => void;

beforeAll(async () => {
  ai = await startAiMock();
  restore = useAiMock(ai);
});

afterAll(async () => {
  restore();
  await ai.close();
});

beforeEach(async () => {
  session.user = null;
  ai.reset();
  await db.execute(sql`delete from rate_limits`);
});

const signIn = async (overrides: Parameters<typeof createUser>[0] = {}) => {
  const row = await createUser(overrides);
  session.user = {
    id: row.id,
    username: row.username,
    displayName: row.displayName,
    role: row.role,
    timeZone: row.timeZone,
    units: row.units,
  };
  return row;
};

const get = async (query: string, cookie?: string) => {
  const response = await suggestRoute.GET(
    new NextRequest(`${ORIGIN}/api/suggestions${query}`, {
      headers: { ...HEADERS, ...(cookie ? { cookie } : {}) },
    }),
  );
  return { status: response.status, body: (await response.json()) as SuggestionsDto };
};

const post = (body: unknown) =>
  new NextRequest(`${ORIGIN}/x`, {
    method: "POST",
    headers: { ...HEADERS, "content-type": "application/json" },
    body: JSON.stringify(body),
  });

/** A full set of nutrients, so the balance score can judge the meal. */
const full = (energy: number, protein: number, fiber: number, sodium: number): NutrientMap => ({
  energy,
  protein,
  fiber,
  sodium,
  vit_a: 200,
  vit_c: 20,
  vit_e: 3,
  calcium: 200,
  iron: 3,
  potassium: 800,
  magnesium: 90,
  fat_sat: 4,
  sugars_added: 3,
});

/** A meal at `at` in Tehran with its items. */
const eat = async (
  userId: string,
  at: Date,
  title: string,
  totals: NutrientMap,
  items: { name: string; kind?: "dish" | "drink" }[],
  values: Parameters<typeof createMeal>[1] = {},
) => {
  const meal = await createMeal(userId, {
    eatenAt: at,
    tz: TZ,
    localDate: localParts(at, TZ).date,
    slot: "lunch",
    title,
    totals,
    ...values,
  });
  // The first item carries the meal's nutrients, so a copy ("Log this") adds up the same.
  for (const [position, item] of items.entries())
    await createItem(userId, meal.id, {
      name: item.name,
      kind: item.kind ?? "dish",
      position,
      nutrients: position === 0 ? totals : {},
    });
  return meal;
};

describe("what should I eat", () => {
  it("works out what is left, the pattern and the best three, in the person's zone", async () => {
    const now = Date.now();
    const user = await signIn({ timeZone: "America/Los_Angeles" });
    const local = localParts(new Date(now), TZ);
    // Each past meal ten minutes before this time of day, 1 to 5 days ago.
    const daysAgo = (n: number) => new Date(now - n * DAY - 10 * 60_000);
    const salad = [{ name: "Chicken" }, { name: "Chickpeas" }, { name: "Lettuce" }];
    for (const n of [1, 2, 3])
      await eat(user.id, daysAgo(n), "Chicken salad", full(580, 34, 9, 500), salad);
    await eat(user.id, daysAgo(4), "Pasta", full(650, 15, 4, 700), [
      { name: "Pasta" },
      { name: "Tomato sauce" },
    ]);
    const beans = await eat(user.id, daysAgo(5), "Bean bowl", full(600, 25, 14, 450), [
      { name: "Beans" },
      { name: "Rice" },
      { name: "Salsa" },
    ]);
    // A favorite from long before the 90 days, and a drink on its own (never a suggestion).
    const soup = await eat(
      user.id,
      daysAgo(120),
      "Lentil soup",
      full(520, 28, 13, 400),
      [{ name: "Lentils" }, { name: "Yogurt" }],
      { favoriteAt: new Date(now - 100 * DAY) },
    );
    await eat(
      user.id,
      daysAgo(1),
      "Latte",
      { energy: 150, protein: 8 },
      [{ name: "Latte", kind: "drink" }],
      { slot: "drink" },
    );
    // Today: one meal already eaten, earlier today in Tehran.
    const earlier = new Date(now - Math.min(120, local.minutes) * 60_000);
    await eat(user.id, earlier, "Toast", full(400, 20, 3, 600), [{ name: "Toast" }]);
    // Someone else's meal is never suggested.
    const other = await createUser();
    await eat(other.id, daysAgo(2), "Their stew", full(590, 40, 12, 300), [{ name: "Stew" }]);

    const { status, body } = await get(`?tz=${encodeURIComponent(TZ)}`);
    expect(status).toBe(200);
    expect(body.tz).toBe(TZ);
    expect(body.date).toBe(localParts(new Date(), TZ).date);
    expect([local.time, localParts(new Date(), TZ).time]).toContain(body.time);
    // No profile: 2,000 kcal, 50 g protein, 28 g fiber, sodium at most 2,300 mg.
    expect(body.left).toMatchObject({
      energyTarget: 2000,
      eaten: 400,
      energyLeft: 1600,
      protein: 30,
      fiber: 25,
      pending: 0,
    });
    expect(body.left.limits.find((l) => l.code === "sodium")).toEqual({
      code: "sodium",
      limit: 2300,
      room: 1700,
    });
    // Five days with meals around now (the latte's day too): lunch, 580 kcal as the median.
    expect(body.pattern).toMatchObject({
      days: 5,
      enough: true,
      usualSlot: "lunch",
      usualKcal: 580,
      often: 1,
    });
    expect(body.history).toBe("enough");
    expect(body.intro).toMatch(
      /^It is \d{2}:\d{2}\. You usually have lunch now, about 580 kcal, and /,
    );
    expect(body.size).toBe(580);
    expect(body.note).toBeNull();
    expect(body.idea).toBeNull();
    expect(body.aiAvailable).toBe(false);

    // The lentil soup (a favorite, the most nutritious) first, then the bean bowl and the pasta;
    // the chicken salad, had yesterday, is spaced out; never the drink, today's toast or someone
    // else's stew.
    expect(body.suggestions.map((s) => [s.title, s.badge])).toEqual([
      ["Lentil soup", "Best fit"],
      ["Bean bowl", null],
      ["Pasta", null],
    ]);
    expect(body.suggestions[0]).toMatchObject({ mealId: soup.id, favorite: true, times: 0 });
    expect(body.suggestions[0]!.reason).toBe(
      "Covers 28 g of the 30 g protein you still need; fits your usual 580 kcal lunch.",
    );
    expect(body.suggestions[1]).toMatchObject({ mealId: beans.id, favorite: false, times: 1 });
    expect(body.suggestions.every((s) => typeof s.score === "number")).toBe(true);
    expect(body.suggestions[1]!.foods.map((f) => f.name)).toEqual(["Beans", "Rice", "Salsa"]);

    // Log this: a copy of the bean bowl at now, in the device's zone; it counts at once.
    const copy = await duplicateRoute.POST(post({ eatenAt: new Date().toISOString(), tz: TZ }), {
      params: Promise.resolve({ id: beans.id }),
    });
    expect(copy.status).toBe(201);
    const logged = (await copy.json()) as MealDto;
    expect(logged).toMatchObject({ source: "duplicate", tz: TZ, title: "Bean bowl" });
    expect(logged.localDate).toBe(localParts(new Date(), TZ).date);
    const after = await get(`?tz=${encodeURIComponent(TZ)}`);
    expect(after.body.left.eaten).toBe(1000);
    expect(after.body.left.energyLeft).toBe(1000);
    // Just had: the bean bowl drops behind the pasta.
    const order = after.body.suggestions.map((s) => s.title);
    expect(order[0]).toBe("Lentil soup");
    expect(order.indexOf("Bean bowl")).not.toBe(1);
    // Undo removes the copy and the numbers go back.
    const undo = await mealRoute.DELETE(
      new NextRequest(`${ORIGIN}/api/meals/${logged.id}`, { method: "DELETE", headers: HEADERS }),
      { params: Promise.resolve({ id: logged.id }) },
    );
    expect(undo.status).toBeLessThan(300);
    expect((await get(`?tz=${encodeURIComponent(TZ)}`)).body.left.eaten).toBe(400);

    // A favorite is logged as a favorite again (so "Log a favorite again" sees it was used).
    const again = await favoriteRoute.POST(post({ eatenAt: new Date().toISOString(), tz: TZ }), {
      params: Promise.resolve({ mealId: soup.id }),
    });
    expect(again.status).toBe(201);
    const [row] = await db.select().from(meals).where(eq(meals.id, soup.id));
    expect(row!.favoriteUsedAt).not.toBeNull();
  });

  it("takes the zone from the request, else the device cookie, else the profile", async () => {
    await signIn({ timeZone: "America/Los_Angeles" });
    expect((await get("?tz=Asia%2FTehran")).body.tz).toBe(TZ);
    expect((await get("", "cal_tz=Asia%2FTokyo")).body.tz).toBe("Asia/Tokyo");
    expect((await get("?tz=Mars%2FBase")).body.tz).toBe("America/Los_Angeles");
    const tokyo = await get("?tz=Asia%2FTokyo");
    expect(tokyo.body.date).toBe(localParts(new Date(), "Asia/Tokyo").date);
    session.user = null;
    expect((await get("?tz=Asia%2FTehran")).status).toBe(401);
  });

  it("says when there is too little history and offers a balanced idea from the targets", async () => {
    const user = await signIn();
    const { body } = await get(`?tz=${encodeURIComponent(TZ)}`);
    expect(body.history).toBe("little");
    expect(body.pattern.days).toBe(0);
    expect(body.intro).toMatch(
      /^It is \d{2}:\d{2}\. Kal needs a few more days of meals to learn when and how much you usually eat\.$/,
    );
    expect(body.suggestions).toEqual([]);
    expect(body.idea?.text).toMatch(
      /^About [\d,]+ kcal with at least \d+ g protein and \d+ g fiber, under [\d,]+ mg sodium\. For example, a plate that is half vegetables/,
    );
    // A favorite is suggested even without a pattern; then no balanced idea.
    await eat(
      user.id,
      new Date(Date.now() - 3 * DAY),
      "Omelette",
      full(450, 25, 3, 500),
      [{ name: "Eggs" }, { name: "Spinach" }],
      { favoriteAt: new Date() },
    );
    const some = await get(`?tz=${encodeURIComponent(TZ)}`);
    expect(some.body.history).toBe("little");
    expect(some.body.suggestions.map((s) => s.title)).toEqual(["Omelette"]);
    expect(some.body.idea).toBeNull();
  });

  it("says when today's energy is reached and suggests nothing", async () => {
    const user = await signIn();
    const local = localParts(new Date(), TZ);
    await eat(user.id, new Date(Date.now() - 3 * DAY), "Curry", full(700, 30, 8, 600), [
      { name: "Curry" },
    ]);
    await eat(
      user.id,
      new Date(Date.now() - Math.min(60, local.minutes) * 60_000),
      "Feast",
      full(2100, 90, 20, 2000),
      [{ name: "Feast" }],
    );
    const { body } = await get(`?tz=${encodeURIComponent(TZ)}`);
    expect(body.left.energyLeft).toBe(-100);
    expect(body.size).toBe(0);
    expect(body.suggestions).toEqual([]);
    expect(body.note).toBe("You have eaten today's 2,000 kcal; anything more goes over it.");
    expect(body.idea).toBeNull();
    const idea = await ideaRoute.POST(post({ tz: TZ }));
    expect(idea.status).toBe(422);
  });

  it("asks the person's own AI for something new, with the numbers and allowed allergies", async () => {
    const user = await signIn();
    const none = await ideaRoute.POST(post({ tz: TZ }));
    expect(none.status).toBe(409);
    expect(((await none.json()) as { error: string }).error).toMatch(/API key/);

    await saveProviderKey(user.id, "google", TEST_API_KEY);
    expect((await get(`?tz=${encodeURIComponent(TZ)}`)).body.aiAvailable).toBe(true);
    await saveHealthProfile(user.id, {
      conditions: undefined,
      allergies: "peanuts",
      notes: undefined,
      useInAnalysis: false,
    });
    const reply = {
      idea_name: "Salmon rice bowl",
      foods: "120 g baked salmon, 1 cup brown rice, cucumber and edamame",
      energy_kcal: 590.4,
      protein_g: 36,
      carbs_g: 62,
      fat_g: 18,
      fiber_g: 7,
      sodium_mg: 480,
    };
    ai.queue("google", aiReplies.google.json(reply));
    const response = await ideaRoute.POST(post({ tz: TZ }));
    expect(response.status).toBe(200);
    expect(((await response.json()) as { idea: MealIdeaDto }).idea).toEqual({
      name: "Salmon rice bowl",
      description: "120 g baked salmon, 1 cup brown rice, cucumber and edamame",
      energy: 590,
      protein: 36,
      carbs: 62,
      fat: 18,
      fiber: 7,
      sodium: 480,
    });
    const sent = JSON.stringify(ai.requests[0]!.body);
    expect(sent).toMatch(/Energy: about \d+ kcal \(at most 2000 kcal are left today\)/);
    expect(sent).toContain("Protein: at least");
    expect(sent).toContain("idea_name");
    expect(sent).not.toContain("peanuts");

    // Allergies go along once the health profile allows its use in analysis.
    await saveHealthProfile(user.id, {
      conditions: undefined,
      allergies: undefined,
      notes: undefined,
      useInAnalysis: true,
    });
    ai.queue("google", aiReplies.google.json(reply));
    expect((await ideaRoute.POST(post({ tz: TZ }))).status).toBe(200);
    expect(JSON.stringify(ai.requests[1]!.body)).toContain("Allergies to avoid: peanuts.");

    // A reply that does not fit the schema, and the provider refusing the key.
    ai.queue("google", aiReplies.google.json({ idea_name: "", foods: "x" }));
    expect((await ideaRoute.POST(post({ tz: TZ }))).status).toBe(502);
    ai.queue("google", aiReplies.google.badKey);
    expect((await ideaRoute.POST(post({ tz: TZ }))).status).toBe(409);
  });
});
