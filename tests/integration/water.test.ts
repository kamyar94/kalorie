// The Water card's entries and changes against Postgres: the day's water (water added on its own
// and the drinks inside meals, without alcohol) adds up to the meals' water, new water from the
// card ("+ Other amount" is a manual meal) shows at once in the entries and the total, the water
// route changes the amount (item ml, grams and water nutrient, the meal's totals) and the time (to
// another day too), and it stays with its owner, from Kal's own pages, for water on its own only.
import { and, eq } from "drizzle-orm";
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { db } from "@/db";
import { mealItems, mealPhotos, meals } from "@/db/schema";
import type { SessionUser } from "@/lib/auth/accounts";
import type { MealDto } from "@/lib/contracts/meals";
import type { WaterEntryDto } from "@/lib/contracts/water";
import { createManualMeal } from "@/lib/meals/manual";
import { listMealsForDay } from "@/lib/meals/service";
import { localParts, shiftLocalDate } from "@/lib/meals/time";
import { waterTotalMl } from "@/lib/meals/water";
import { listWaterEntries } from "@/lib/meals/water-service";
import { fromLocalInputValue } from "@/lib/ui/format";
import { createUser } from "@/tests/helpers/factories";

const session = vi.hoisted(() => ({ user: null as SessionUser | null }));
vi.mock("@/lib/auth/session", () => ({
  getCurrentUser: async () => session.user,
}));

const waterRoute = await import("@/app/api/water/[id]/route");
const manualRoute = await import("@/app/api/manual-meals/route");
const mealRoute = await import("@/app/api/meals/[id]/route");

const ORIGIN = "http://127.0.0.1:3201";
const HEADERS = { origin: ORIGIN, "x-forwarded-host": "127.0.0.1:3201" };
const TZ = "Europe/Berlin";

const asUser = async (): Promise<SessionUser> => {
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

const request = (url: string, method: string, body?: unknown, headers = HEADERS) =>
  new NextRequest(`${ORIGIN}${url}`, {
    method,
    headers: { ...headers, "content-type": "application/json" },
    body: body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body),
  });
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });

const today = () => localParts(new Date(), TZ).date;
/** The k-th of nine moments spread over today so far in Berlin: always today, in order. */
const todayAt = (k: number) => {
  const start = Date.parse(fromLocalInputValue(`${today()}T00:00`, TZ)!);
  return new Date(start + ((Date.now() - start) * k) / 10);
};

/** Water as the card's buttons log it, through the manual meal route. */
const addWater = async (ml: number, at = new Date()) => {
  const response = await manualRoute.POST(
    request("/api/manual-meals", "POST", {
      eatenAt: at.toISOString(),
      tz: TZ,
      title: "Water",
      items: [{ name: "Water", kind: "drink", ml, grams: ml, nutrients: { energy: 0, water: ml } }],
    }),
  );
  expect(response.status).toBe(201);
  return (await response.json()) as MealDto;
};

const patchWater = (mealId: string, body: unknown, headers = HEADERS) =>
  waterRoute.PATCH(request(`/api/water/${mealId}`, "PATCH", body, headers), ctx(mealId));

const mealsWater = async (userId: string, day: string) =>
  (await listMealsForDay(userId, day)).reduce((sum, m) => sum + m.waterMl, 0);

let ann: SessionUser;
beforeEach(async () => {
  ann = await asUser();
  session.user = ann;
});

describe("the day's water", () => {
  it("lists water on its own and the drinks inside meals, and adds up to the meals' water", async () => {
    const glass = await addWater(250, todayAt(1));
    const lunch = await createManualMeal(ann.id, {
      eatenAt: todayAt(2).toISOString(),
      tz: TZ,
      items: [
        { name: "Rice", grams: 200, nutrients: { energy: 260 } },
        { name: "Coffee", kind: "drink", ml: 180, nutrients: { energy: 4 } },
        { name: "Beer", kind: "drink", ml: 330, nutrients: { energy: 140, alcohol: 13 } },
      ],
    });
    // Water with a photo is a photographed drink, not water added on its own.
    const photographed = await addWater(500, todayAt(3));
    await db.insert(mealPhotos).values({
      mealId: photographed.id,
      userId: ann.id,
      position: 0,
      originalPath: "none/o.jpg",
      analysisPath: "none/a.jpg",
      thumbPath: "none/t.jpg",
      width: 10,
      height: 10,
      bytes: 10,
      sha256: "0".repeat(64),
    });
    // Deleted meals and other days do not count.
    const gone = await addWater(750, todayAt(4));
    expect(
      (await mealRoute.DELETE(request(`/api/meals/${gone.id}`, "DELETE"), ctx(gone.id))).status,
    ).toBe(200);
    await createManualMeal(ann.id, {
      eatenAt: fromLocalInputValue(`${shiftLocalDate(today(), -1)}T12:00`, TZ)!,
      tz: TZ,
      title: "Water",
      items: [{ name: "Water", kind: "drink", ml: 1000, grams: 1000 }],
    });

    const entries = await listWaterEntries(ann.id, today());
    expect(entries.map((e) => [e.mealId, e.name, e.waterMl, e.standalone, e.mealTitle])).toEqual([
      [glass.id, "Water", 250, true, null],
      // A meal logged by hand is named after its first food.
      [lunch.id, "Coffee", 180, false, "Rice"],
      [photographed.id, "Water", 500, false, "Water"],
    ]);
    expect(entries[0]).toMatchObject({
      itemId: glass.items[0]!.id,
      emoji: "💧",
      tz: TZ,
      localDate: today(),
      localTime: localParts(new Date(glass.eatenAt), TZ).time,
    });
    expect(waterTotalMl(entries)).toBe(930);
    expect(await mealsWater(ann.id, today())).toBe(930);
    // Someone else sees none of it.
    expect(await listWaterEntries((await asUser()).id, today())).toEqual([]);
  });

  it('puts new water in the entries and the total at once ("+ Other amount" is a manual meal)', async () => {
    await addWater(250, todayAt(1));
    const other = await addWater(330, todayAt(5));
    const entries = await listWaterEntries(ann.id, today());
    expect(entries.map((e) => e.waterMl)).toEqual([250, 330]);
    expect(entries[1]).toMatchObject({ mealId: other.id, standalone: true });
    expect(waterTotalMl(entries)).toBe(580);
    expect(await mealsWater(ann.id, today())).toBe(580);
  });
});

describe("changing water added on its own", () => {
  it("changes the amount: the item's ml, grams and water nutrient, and the meal's totals", async () => {
    const glass = await addWater(250, todayAt(3));
    const response = await patchWater(glass.id, { ml: 500 });
    expect(response.status).toBe(200);
    const entry = (await response.json()) as WaterEntryDto;
    expect(entry).toMatchObject({
      mealId: glass.id,
      itemId: glass.items[0]!.id,
      waterMl: 500,
      standalone: true,
      eatenAt: glass.eatenAt,
    });
    const [item] = await db.select().from(mealItems).where(eq(mealItems.mealId, glass.id));
    expect(item).toMatchObject({ ml: 500, grams: 500, count: 1, edited: true });
    expect(item!.nutrients).toEqual({ energy: 0, water: 500 });
    const [row] = await db.select().from(meals).where(eq(meals.id, glass.id));
    expect(row!.totals).toMatchObject({ energy: 0, water: 500 });
    expect(await mealsWater(ann.id, today())).toBe(500);
    expect(waterTotalMl(await listWaterEntries(ann.id, today()))).toBe(500);
  });

  it("moves it to the day of its new time, in the zone it is meant in", async () => {
    const glass = await addWater(250, todayAt(3));
    const yesterday = shiftLocalDate(today(), -1);
    const evening = fromLocalInputValue(`${yesterday}T21:00`, TZ)!;
    const entry = (await (
      await patchWater(glass.id, { eatenAt: evening, tz: TZ, ml: 300 })
    ).json()) as WaterEntryDto;
    expect(entry).toMatchObject({
      eatenAt: evening,
      localDate: yesterday,
      localTime: "21:00",
      waterMl: 300,
    });
    expect(await listWaterEntries(ann.id, today())).toEqual([]);
    expect((await listWaterEntries(ann.id, yesterday)).map((e) => e.mealId)).toEqual([glass.id]);
    const [row] = await db.select().from(meals).where(eq(meals.id, glass.id));
    expect(row).toMatchObject({ localDate: yesterday, tz: TZ, slot: "drink" });
    // A zone the server does not know: the person's own (UTC here).
    const utc = (await (
      await patchWater(glass.id, { eatenAt: evening, tz: "Mars/Olympus" })
    ).json()) as WaterEntryDto;
    expect(utc).toMatchObject({ tz: "UTC", localTime: localParts(new Date(evening), "UTC").time });
  });

  it("is the owner's only, from Kal's own pages, for water on its own, with an amount and a time that fit", async () => {
    const glass = await addWater(250, todayAt(2));
    const lunch = await createManualMeal(ann.id, {
      eatenAt: todayAt(3).toISOString(),
      tz: TZ,
      items: [
        { name: "Soup", grams: 300, nutrients: { energy: 150 } },
        { name: "Water", kind: "drink", ml: 250, grams: 250 },
      ],
    });
    const status = async (mealId: string, body: unknown, headers = HEADERS) =>
      (await patchWater(mealId, body, headers)).status;

    session.user = await asUser();
    expect(await status(glass.id, { ml: 500 })).toBe(404);
    session.user = null;
    expect(await status(glass.id, { ml: 500 })).toBe(401);
    session.user = ann;
    expect(
      await status(
        glass.id,
        { ml: 500 },
        { origin: "https://elsewhere.example.org", "x-forwarded-host": "127.0.0.1:3201" },
      ),
    ).toBe(403);
    expect(await status("not-a-meal", { ml: 500 })).toBe(404);
    // A meal with more than water changes on its meal page.
    const more = await patchWater(lunch.id, { ml: 500 });
    expect(more.status).toBe(409);
    expect(((await more.json()) as { error: string }).error).toBe(
      "Only water added on its own changes here. Open its meal to change it.",
    );
    expect(await status(glass.id, { ml: 5 })).toBe(400);
    expect(await status(glass.id, { ml: 5000 })).toBe(400);
    expect(
      await status(glass.id, { eatenAt: new Date(Date.now() + 3_600_000).toISOString() }),
    ).toBe(400);
    expect(await status(glass.id, { tz: TZ })).toBe(400);
    expect(await status(glass.id, "not json")).toBe(400);
    // Removed (the meal route's soft delete): as if it did not exist.
    await mealRoute.DELETE(request(`/api/meals/${glass.id}`, "DELETE"), ctx(glass.id));
    expect(await status(glass.id, { ml: 500 })).toBe(404);

    // Nothing changed on the way.
    const items = await db
      .select({ ml: mealItems.ml })
      .from(mealItems)
      .where(and(eq(mealItems.userId, ann.id)));
    expect(items.map((i) => i.ml).sort()).toEqual([250, 250, null]);
  });
});
