// Favorite meals: the star (PATCH /api/meals/:id {favorite}), the list (GET /api/favorites, most
// recently used first) and "Log a favorite again" (POST /api/favorites/:mealId/log): a copy of the
// meal as it is at that moment, owner only, kept in the export.
import { eq } from "drizzle-orm";
import { NextRequest } from "next/server";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { db } from "@/db";
import { meals } from "@/db/schema";
import { exportUserData } from "@/lib/account/data";
import type { SessionUser } from "@/lib/auth/accounts";
import type { FavoriteDto, MealDto } from "@/lib/contracts/meals";
import { listFavorites, logFavorite } from "@/lib/meals/favorites";
import { updateItem, updateMeal } from "@/lib/meals/service";
import { localParts } from "@/lib/meals/time";
import { createItem, createMeal, createUser } from "@/tests/helpers/factories";

const session = vi.hoisted(() => ({ user: null as SessionUser | null }));
vi.mock("@/lib/auth/session", () => ({
  getCurrentUser: async () => session.user,
}));

const mealRoute = await import("@/app/api/meals/[id]/route");
const listRoute = await import("@/app/api/favorites/route");
const logRoute = await import("@/app/api/favorites/[mealId]/log/route");

const ORIGIN = "http://127.0.0.1:3201";
const HEADERS = { origin: ORIGIN, "x-forwarded-host": "127.0.0.1:3201" };
let ann: SessionUser;
let ben: SessionUser;

const asUser = async () => {
  const row = await createUser();
  return {
    id: row.id,
    username: row.username,
    displayName: row.displayName,
    role: row.role,
    timeZone: row.timeZone,
    units: row.units,
  };
};

const jsonRequest = (url: string, method: string, body?: unknown) =>
  new NextRequest(`${ORIGIN}${url}`, {
    method,
    headers: { ...HEADERS, "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

const star = (mealId: string, favorite: boolean) =>
  mealRoute.PATCH(jsonRequest(`/api/meals/${mealId}`, "PATCH", { favorite }), {
    params: Promise.resolve({ id: mealId }),
  });

const list = async () =>
  (
    (await (await listRoute.GET(jsonRequest("/api/favorites?limit=6", "GET"))).json()) as {
      favorites: FavoriteDto[];
    }
  ).favorites;

const logAgain = (mealId: string, body: unknown) =>
  logRoute.POST(jsonRequest(`/api/favorites/${mealId}/log`, "POST", body), {
    params: Promise.resolve({ mealId }),
  });

/** A ready meal of one item eaten an hour ago. */
const coffeeMeal = async (userId: string, title = "Morning coffee") => {
  const at = new Date(Date.now() - 3_600_000);
  const meal = await createMeal(userId, {
    eatenAt: at,
    localDate: localParts(at, "UTC").date,
    title,
    slot: "breakfast",
    totals: { energy: 40 },
  });
  const item = await createItem(userId, meal.id, {
    name: "Coffee with milk",
    kind: "drink",
    emoji: "☕",
    grams: 250,
    ml: 250,
    nutrients: { energy: 40 },
  });
  return { meal, item };
};

beforeAll(async () => {
  ann = await asUser();
  ben = await asUser();
});

beforeEach(() => {
  session.user = ann;
});

describe("favorites", () => {
  it("stars and unstars a meal; the meal says whether it is a favorite", async () => {
    const { meal } = await coffeeMeal(ann.id);
    const starred = await star(meal.id, true);
    expect(starred.status).toBe(200);
    expect(((await starred.json()) as MealDto).favorite).toBe(true);
    const first = (await db.select().from(meals).where(eq(meals.id, meal.id)))[0]!.favoriteAt;
    expect(first).toBeInstanceOf(Date);
    // Starring again keeps the first time.
    await star(meal.id, true);
    expect((await db.select().from(meals).where(eq(meals.id, meal.id)))[0]!.favoriteAt).toEqual(
      first,
    );
    expect((await list()).map((f) => f.mealId)).toEqual([meal.id]);

    const unstarred = (await (await star(meal.id, false)).json()) as MealDto;
    expect(unstarred.favorite).toBe(false);
    expect(await list()).toEqual([]);

    session.user = ben;
    expect((await star(meal.id, true)).status).toBe(404);
  });

  it("lists the most recently used first, with the cover emoji and the kcal", async () => {
    const person = await createUser();
    const a = await coffeeMeal(person.id, "Morning coffee");
    const b = await coffeeMeal(person.id, "Yogurt with honey");
    const c = await coffeeMeal(person.id, "Jojeh kabab with rice");
    for (const [meal, minutesAgo] of [
      [a.meal, 30],
      [b.meal, 20],
      [c.meal, 10],
    ] as const)
      await db
        .update(meals)
        .set({ favoriteAt: new Date(Date.now() - minutesAgo * 60_000) })
        .where(eq(meals.id, meal.id));
    expect((await listFavorites(person.id)).map((f) => f.title)).toEqual([
      "Jojeh kabab with rice",
      "Yogurt with honey",
      "Morning coffee",
    ]);
    // Logging one again puts it first.
    await logFavorite(person.id, a.meal.id, { eatenAt: new Date().toISOString(), tz: "UTC" });
    const favorites = await listFavorites(person.id);
    expect(favorites.map((f) => f.title)).toEqual([
      "Morning coffee",
      "Jojeh kabab with rice",
      "Yogurt with honey",
    ]);
    expect(favorites[0]).toMatchObject({ emoji: "☕", kcal: 40, slot: "breakfast" });
    expect(favorites[0]!.lastUsedAt).not.toBeNull();
    expect(await listFavorites(person.id, 2)).toHaveLength(2);
    // A deleted meal is no favorite any more; someone else sees none of them.
    await db.update(meals).set({ deletedAt: new Date() }).where(eq(meals.id, b.meal.id));
    expect(await listFavorites(person.id)).toHaveLength(2);
    expect(await listFavorites(ben.id)).toEqual([]);
  });

  it("logs the meal again as it is now, at the time asked, ready at once", async () => {
    const { meal, item } = await coffeeMeal(ann.id, "Latte");
    await star(meal.id, true);
    // Edited after it was starred: the copy has the edit.
    await updateItem(ann.id, item.id, { grams: 500, ml: 500 });
    await updateMeal(ann.id, meal.id, { title: "Big latte" });
    const at = new Date(Date.now() - 2 * 86_400_000);
    const response = await logAgain(meal.id, { eatenAt: at.toISOString(), tz: "Europe/Berlin" });
    expect(response.status).toBe(201);
    const copy = (await response.json()) as MealDto;
    expect(copy).toMatchObject({
      title: "Big latte",
      status: "ready",
      source: "duplicate",
      favorite: false,
      tz: "Europe/Berlin",
      eatenAt: at.toISOString(),
      localDate: localParts(at, "Europe/Berlin").date,
    });
    expect(copy.items.map((i) => [i.name, i.ml])).toEqual([["Coffee with milk", 500]]);
    expect(copy.totals.energy).toBeCloseTo(80);
  });

  it("logs only the person's own favorites, at a time in the past year", async () => {
    const { meal } = await coffeeMeal(ann.id);
    const now = { eatenAt: new Date().toISOString(), tz: "UTC" };
    // Not a favorite yet.
    expect((await logAgain(meal.id, now)).status).toBe(404);
    await star(meal.id, true);
    expect((await logAgain(meal.id, { eatenAt: "soon", tz: "UTC" })).status).toBe(400);
    session.user = ben;
    expect((await logAgain(meal.id, now)).status).toBe(404);
    expect(await list()).toEqual([]);
    session.user = null;
    expect((await logAgain(meal.id, now)).status).toBe(401);
  });

  it("are in the export", async () => {
    const person = await createUser();
    const { meal } = await coffeeMeal(person.id);
    await updateMeal(person.id, meal.id, { favorite: true });
    const data = (await exportUserData(person.id))!;
    expect(data.meals.map((m) => [m.id, m.favorite])).toEqual([[meal.id, true]]);
  });
});
