import { describe, expect, it } from "vitest";

import {
  cleanWaterMl,
  isWaterOnly,
  parseWaterPatch,
  waterEntriesOf,
  waterEntriesOfDay,
  waterEntryName,
  waterEntryPlace,
  waterTotalMl,
  type WaterItem,
  type WaterMeal,
} from "./water";

let ids = 0;
const item = (values: Partial<WaterItem> & { name: string }): WaterItem => ({
  id: `item-${ids++}`,
  position: 0,
  kind: "drink",
  emoji: null,
  ml: null,
  grams: 0,
  count: 1,
  nutrients: {},
  foodName: null,
  ...values,
});

const meal = (values: Partial<WaterMeal> & { items: WaterItem[] }): WaterMeal => ({
  id: `meal-${ids++}`,
  eatenAt: "2026-11-14T09:10:00.000Z",
  tz: "UTC",
  localDate: "2026-11-14",
  title: null,
  slot: "drink",
  source: "manual",
  photoCount: 0,
  ...values,
});

const glass = (at = "2026-11-14T09:10:00.000Z", ml = 250) =>
  meal({
    eatenAt: at,
    title: "Water",
    items: [item({ name: "Water", ml, grams: ml, nutrients: { energy: 0, water: ml } })],
  });

describe("water added on its own", () => {
  it("is a meal by hand of plain water only, without a photo", () => {
    expect(isWaterOnly(glass())).toBe(true);
    // A favorite logged again is a copy of the meal.
    expect(isWaterOnly({ ...glass(), source: "duplicate" })).toBe(true);
    expect(isWaterOnly({ ...glass(), source: "photo" })).toBe(false);
    expect(isWaterOnly({ ...glass(), photoCount: 1 })).toBe(false);
    const water = glass().items[0]!;
    expect(isWaterOnly(meal({ items: [water, item({ name: "Apple", kind: "dish" })] }))).toBe(
      false,
    );
    // Not plain water: energy (coconut water), or a drink with another name.
    expect(
      isWaterOnly(
        meal({ items: [item({ name: "Coconut water", ml: 330, nutrients: { energy: 63 } })] }),
      ),
    ).toBe(false);
    expect(isWaterOnly(meal({ items: [item({ name: "Coffee", ml: 200 })] }))).toBe(false);
    expect(isWaterOnly(meal({ items: [item({ name: "Sparkling water", ml: 330 })] }))).toBe(true);
    // A matched food named water counts too.
    expect(
      isWaterOnly(meal({ items: [item({ name: "Still", foodName: "Water, bottled", ml: 500 })] })),
    ).toBe(true);
  });
});

describe("the day's entries", () => {
  it("lists water on its own and the drinks of meals, oldest first, without alcohol", () => {
    const lunch = meal({
      eatenAt: "2026-11-14T13:35:00.000Z",
      title: null,
      slot: "lunch",
      source: "photo",
      photoCount: 1,
      items: [
        item({ name: "Rice", kind: "dish", grams: 200, position: 0 }),
        item({ name: "Beer", ml: 330, nutrients: { alcohol: 13 }, position: 2 }),
        item({ name: "Coffee", emoji: "☕", ml: 180, position: 1 }),
      ],
    });
    const entries = waterEntriesOfDay([lunch, glass("2026-11-14T16:20:00.000Z"), glass()]);
    expect(entries.map((e) => [e.localTime, e.name, e.waterMl, e.standalone])).toEqual([
      ["09:10", "Water", 250, true],
      ["13:35", "Coffee", 180, false],
      ["16:20", "Water", 250, true],
    ]);
    expect(entries[0]).toMatchObject({ emoji: "💧", mealTitle: null, localDate: "2026-11-14" });
    expect(entries[1]).toMatchObject({ emoji: "☕", mealTitle: "Lunch", mealId: lunch.id });
    expect(waterTotalMl(entries)).toBe(680);
  });

  it("counts a drink's count and reads the time in the meal's zone", () => {
    const [entry] = waterEntriesOf(
      meal({
        eatenAt: "2026-11-14T23:30:00.000Z",
        tz: "Asia/Tehran",
        localDate: "2026-11-15",
        items: [item({ name: "Water", ml: 200, count: 2 })],
      }),
    );
    expect(entry).toMatchObject({ waterMl: 400, localTime: "03:00", localDate: "2026-11-15" });
  });

  it("names water by its amount and drinks by their meal", () => {
    const own = { standalone: true, name: "Water" };
    expect(waterEntryName({ ...own, waterMl: 250 })).toBe("Glass");
    expect(waterEntryName({ ...own, waterMl: 500 })).toBe("Bottle");
    expect(waterEntryName({ ...own, waterMl: 330 })).toBe("Water");
    expect(waterEntryName({ standalone: true, name: "Sparkling water", waterMl: 250 })).toBe(
      "Sparkling water",
    );
    expect(waterEntryName({ standalone: false, name: "Water", waterMl: 250 })).toBe("Water");
    expect(waterEntryPlace({ name: "Coffee", mealTitle: "Lunch" })).toBe("in Lunch");
    expect(waterEntryPlace({ name: "Coffee", mealTitle: "coffee" })).toBeNull();
    expect(waterEntryPlace({ name: "Water", mealTitle: null })).toBeNull();
  });
});

describe("a change from the water sheet", () => {
  const now = Date.now();
  const iso = (msAgo: number) => new Date(now - msAgo).toISOString();

  it("takes whole millilitres from 10 ml to 3 L and a time in the past year", () => {
    expect(cleanWaterMl(249.6)).toBe(250);
    expect(cleanWaterMl(9)).toBeNull();
    expect(cleanWaterMl(3001)).toBeNull();
    expect(cleanWaterMl("250")).toBeNull();
    expect(parseWaterPatch({ ml: 500 }, now)).toEqual({ ml: 500 });
    expect(parseWaterPatch({ eatenAt: iso(3_600_000), tz: "Europe/Berlin" }, now)).toEqual({
      eatenAt: iso(3_600_000),
      tz: "Europe/Berlin",
    });
    expect(parseWaterPatch({ ml: 5 }, now)).toEqual({
      error: "Give an amount from 10 to 3,000 ml.",
    });
    expect(parseWaterPatch({ ml: 500, eatenAt: iso(-3_600_000) }, now)).toEqual({
      error: "Pick a time in the past year.",
    });
    expect(parseWaterPatch({ eatenAt: iso(-5 * 60_000) }, now)).toHaveProperty("eatenAt");
    expect(parseWaterPatch({ eatenAt: iso(400 * 86_400_000) }, now)).toHaveProperty("error");
    expect(parseWaterPatch({ tz: "UTC", note: "x" }, now)).toEqual({
      error: "Send a new amount or a new time.",
    });
  });
});
