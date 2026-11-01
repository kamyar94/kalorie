// Pure logic behind the screens: time input conversion, amounts, the item sheet's optimistic
// update, trends arithmetic, request parsing, upload outcomes, barcodes, CSV export and settings.
import { describe, expect, it } from "vitest";

import { csvField, mealsToCsv } from "@/lib/account/data";
import { parseCuisines, parseMealWindows, parseProfile } from "@/lib/account/settings";
import { isProductCode } from "@/lib/client/barcode";
import { backoffMs, outcomeForStatus } from "@/lib/client/uploader";
import type { FoodResult } from "@/lib/contracts/food-search";
import type { MealDto, MealItemDto } from "@/lib/contracts/meals";
import { barcodeVariants, normalizeBarcode } from "@/lib/food/barcode-local";
import { parseItemInput, parseItemPatch, parseMealPatch, parseWhen } from "@/lib/meals/parse";
import { computeTrends, rangeDates } from "@/lib/trends/compute";
import {
  dayTitle,
  formatItemAmount,
  formatWeight,
  fromLocalInputValue,
  percentOf,
  toLocalInputValue,
} from "@/lib/ui/format";
import { gramsRange, previewItem, totalsOf } from "@/lib/ui/item-preview";

const item = (overrides: Partial<MealItemDto> = {}): MealItemDto => ({
  id: "11111111-1111-4111-8111-111111111111",
  mealId: "22222222-2222-4222-8222-222222222222",
  position: 0,
  name: "Rice",
  localName: "چلو",
  kind: "dish",
  preparation: null,
  foodId: null,
  foodName: null,
  grams: 200,
  ml: null,
  portionText: null,
  count: 1,
  modelGrams: 200,
  gramsLow: 150,
  gramsHigh: 260,
  confidence: 0.8,
  edited: false,
  nutrients: { energy: 260, protein: 5, carbs: 56 },
  nutrientSource: "ai_estimate",
  components: [],
  ...overrides,
});

const food = (overrides: Partial<FoodResult> = {}): FoodResult => ({
  id: "33333333-3333-4333-8333-333333333333",
  source: "fdc_sr_legacy",
  kind: "food",
  nameEn: "Rice, white, cooked",
  nameFa: null,
  brand: null,
  category: null,
  barcode: null,
  per100g: { energy: 130, protein: 2.7, carbs: 28 },
  densityGPerMl: null,
  servingGrams: null,
  portions: [],
  sourceNote: null,
  personal: false,
  score: 1,
  ...overrides,
});

describe("time inputs", () => {
  it("round-trips wall-clock times in other time zones, across daylight saving", () => {
    for (const [iso, zone] of [
      ["2026-10-31T09:15:00.000Z", "Asia/Tehran"],
      ["2026-03-08T07:30:00.000Z", "America/New_York"], // the morning of the spring change
      ["2026-07-01T23:59:00.000Z", "Pacific/Auckland"],
      ["2026-01-15T12:00:00.000Z", "UTC"],
    ] as const) {
      const local = toLocalInputValue(iso, zone);
      expect(fromLocalInputValue(local, zone)).toBe(iso);
    }
    expect(toLocalInputValue("2026-10-31T09:15:00Z", "Asia/Tehran")).toBe("2026-10-31T12:45");
    expect(fromLocalInputValue("not a time", "UTC")).toBeNull();
  });

  it("names days relative to today", () => {
    expect(dayTitle("2026-10-31", "2026-10-31")).toBe("Today");
    expect(dayTitle("2026-10-30", "2026-10-31")).toBe("Yesterday");
    expect(dayTitle("2026-10-27", "2026-10-31")).toBe("Tuesday, Oct 27");
  });
});

describe("amounts", () => {
  it("formats weights, volumes, portions and counts", () => {
    expect(formatWeight(180)).toBe("180 g");
    expect(formatWeight(283.5, "imperial")).toBe("10 oz");
    expect(formatItemAmount({ grams: 180, ml: null, count: 2, portionText: "1 skewer" })).toBe(
      "2 × 1 skewer (180 g)",
    );
    expect(formatItemAmount({ grams: 250, ml: 250, count: 1, portionText: null })).toBe("250 ml");
    expect(percentOf(50, 200)).toBe("25%");
    expect(percentOf(50, null)).toBe("");
  });
});

describe("the item sheet's optimistic update", () => {
  it("rescales from the food's values per 100 g", () => {
    const next = previewItem(item({ foodId: food().id }), { grams: 300 }, food());
    expect(next.nutrients.energy).toBeCloseTo(390);
    expect(next.nutrientSource).toBe("food");
    expect(next.edited).toBe(true);
  });

  it("scales in proportion without a food, components too", () => {
    const next = previewItem(
      item({ components: [{ name: "oil", grams: 10, foodId: null, nutrients: { energy: 90 } }] }),
      { count: 2 },
      null,
    );
    expect(next.nutrients.energy).toBe(520);
    expect(next.components[0]!.grams).toBe(20);
    expect(next.components[0]!.nutrients.energy).toBe(180);
  });

  it("switches to a new food and keeps the amount", () => {
    const next = previewItem(item(), { foodId: food().id }, food());
    expect(next.foodName).toBe("Rice, white, cooked");
    expect(next.nutrients.energy).toBeCloseTo(260);
    expect(next.nutrients.carbs).toBeCloseTo(56);
  });

  it("sums items and gives a slider range that holds the value", () => {
    expect(totalsOf([item(), item({ nutrients: { energy: 40 } })]).energy).toBe(300);
    const range = gramsRange({ grams: 200, gramsLow: 150, gramsHigh: 260 });
    expect(range.min).toBeLessThanOrEqual(150);
    expect(range.max).toBeGreaterThanOrEqual(260);
    const wide = gramsRange({ grams: 900, gramsLow: 100, gramsHigh: 300 });
    expect(wide.max).toBeGreaterThanOrEqual(900);
    expect(gramsRange({ grams: 0, gramsLow: null, gramsHigh: null }).min).toBeGreaterThan(0);
  });
});

describe("trends", () => {
  const meal = (
    date: string,
    time: string,
    slot: "breakfast" | "lunch" | "dinner" | "snack",
    energy: number,
    protein = 20,
  ) => ({
    localDate: date,
    eatenAt: `${date}T${time}:00Z`,
    tz: "UTC",
    slot,
    totals: { energy, protein },
  });

  it("averages logged days only and finds slots, hours and top foods", () => {
    const data = computeTrends({
      range: "week",
      end: "2026-10-31",
      meals: [
        meal("2026-10-29", "08:00", "breakfast", 400),
        meal("2026-10-29", "13:00", "lunch", 800),
        meal("2026-10-31", "19:30", "dinner", 1200),
        meal("2026-10-01", "12:00", "lunch", 9999), // outside the week
      ],
      items: [
        { name: "Rice", foodId: "f1", foodName: "Rice", energy: 300 },
        { name: "rice", foodId: "f1", foodName: "Rice", energy: 200 },
        { name: "Tea", foodId: null, foodName: null, energy: 5 },
      ],
      targets: {
        energy: {
          code: "energy",
          target: 2000,
          upper: null,
          kind: "goal",
          custom: false,
          basis: "default",
        },
        protein: {
          code: "protein",
          target: 100,
          upper: null,
          kind: "min",
          custom: false,
          basis: "default",
        },
      },
    });
    expect(data.dates).toHaveLength(7);
    expect(data.start).toBe("2026-10-25");
    expect(data.loggedDays).toBe(2);
    expect(data.average.energy).toBe(1200);
    expect(data.days.find((d) => d.date === "2026-10-30")!.meals).toBe(0);
    expect(data.bySlot.find((s) => s.slot === "dinner")!.share).toBeCloseTo(0.5);
    expect(data.byHour[19]).toBe(600);
    expect(data.topFoods[0]).toMatchObject({ name: "Rice", times: 2, energy: 500 });
    // Two logged days are not enough to call a pattern.
    expect(data.nutrients.every((n) => n.verdict === "ok")).toBe(true);
  });

  it("flags nutrients that are usually low or high", () => {
    const days = rangeDates("week", "2026-10-31");
    const data = computeTrends({
      range: "week",
      end: "2026-10-31",
      meals: days.slice(0, 5).map((d) => ({
        ...meal(d, "12:00", "lunch", 2600, 30),
        totals: { energy: 2600, protein: 30, sodium: 4000 },
      })),
      items: [],
      targets: {
        energy: {
          code: "energy",
          target: 2000,
          upper: null,
          kind: "goal",
          custom: false,
          basis: "default",
        },
        protein: {
          code: "protein",
          target: 100,
          upper: null,
          kind: "min",
          custom: false,
          basis: "default",
        },
        sodium: {
          code: "sodium",
          target: 2300,
          upper: null,
          kind: "max",
          custom: false,
          basis: "default",
        },
      },
    });
    const verdict = Object.fromEntries(data.nutrients.map((n) => [n.code, n.verdict]));
    expect(verdict).toEqual({ energy: "high", protein: "low", sodium: "high" });
  });
});

describe("request parsing", () => {
  it("keeps only valid fields", () => {
    expect(parseMealPatch({ slot: "dinner", title: "  Lunch  ", evil: 1 })).toEqual({
      slot: "dinner",
      title: "Lunch",
    });
    expect(parseMealPatch({ slot: "brunch", eatenAt: "soon" })).toEqual({});
    expect(parseItemPatch({ grams: 120, count: -1, foodId: "not-a-uuid", ml: null })).toEqual({
      grams: 120,
      ml: null,
    });
    expect(parseItemPatch({ nutrients: { energy: 10, "bad code!": 5, protein: -1 } })).toEqual({
      nutrients: { energy: 10 },
    });
    expect(parseItemInput({ name: "" })).toBeNull();
    expect(parseItemInput({ name: "Tea", grams: 250, kind: "drink" })).toEqual({
      name: "Tea",
      grams: 250,
      kind: "drink",
    });
  });

  it("accepts past times within a year only", () => {
    expect(parseWhen({ eatenAt: new Date().toISOString(), tz: "UTC" })).not.toBeNull();
    expect(parseWhen({ eatenAt: new Date(Date.now() + 3_600_000).toISOString() })).toBeNull();
    expect(parseWhen({ eatenAt: "2020-01-01T00:00:00Z" })).toBeNull();
  });
});

describe("uploads", () => {
  it("tells waiting, retrying and refused uploads apart", () => {
    expect(outcomeForStatus(0)).toBe("offline");
    expect(outcomeForStatus(401)).toBe("signed-out");
    expect(outcomeForStatus(429)).toBe("retry");
    expect(outcomeForStatus(503)).toBe("retry");
    expect(outcomeForStatus(413)).toBe("failed");
    expect(outcomeForStatus(415)).toBe("failed");
    expect(backoffMs(1)).toBe(15_000);
    expect(backoffMs(3)).toBe(60_000);
    expect(backoffMs(30)).toBe(600_000);
  });
});

describe("barcodes", () => {
  it("checks product codes and their written forms", () => {
    expect(isProductCode("4006381333931")).toBe(true); // EAN-13
    expect(isProductCode("4006381333932")).toBe(false);
    expect(isProductCode("036000291452")).toBe(true); // UPC-A
    expect(isProductCode("96385074")).toBe(true); // EAN-8
    expect(normalizeBarcode(" 4006-381 333931 ")).toBe("4006381333931");
    expect(normalizeBarcode("12ab")).toBeNull();
    expect(barcodeVariants("036000291452")).toEqual(
      expect.arrayContaining(["036000291452", "0036000291452", "00036000291452"]),
    );
  });
});

describe("settings input", () => {
  it("checks the profile, meal windows and cuisines", () => {
    expect(
      parseProfile({
        sex: "female",
        heightCm: "170",
        weightKg: 64.5,
        goal: "keep",
        goalRateKgPerWeek: 0.5,
      }),
    ).toMatchObject({
      sex: "female",
      heightCm: 170,
      weightKg: 64.5,
      goal: "keep",
      goalRateKgPerWeek: null,
      birthYear: null,
    });
    expect(() => parseProfile({ heightCm: 20 })).toThrow("Height");
    expect(
      parseMealWindows({
        breakfast: ["06:00", "10:00"],
        lunch: ["11:30", "14:30"],
        dinner: ["18:00", "22:00"],
      }),
    ).toEqual({
      breakfast: ["06:00", "10:00"],
      lunch: ["11:30", "14:30"],
      dinner: ["18:00", "22:00"],
    });
    expect(() =>
      parseMealWindows({
        breakfast: ["06:00", "12:00"],
        lunch: ["11:30", "14:30"],
        dinner: ["18:00", "22:00"],
      }),
    ).toThrow("overlap");
    expect(() => parseMealWindows({ breakfast: ["6am", "10:00"] })).toThrow();
    expect(parseCuisines([" Persian home cooking ", "persian home cooking", "", 4])).toEqual([
      "Persian home cooking",
    ]);
  });
});

describe("export", () => {
  it("writes safe CSV with one row per item", () => {
    expect(csvField('say "hi", ok')).toBe('"say ""hi"", ok"');
    expect(csvField("=HYPERLINK(1)")).toBe("'=HYPERLINK(1)");
    expect(csvField(-3.14159)).toBe("-3.14");
    const meal = {
      localDate: "2026-10-31",
      localTime: "12:30",
      tz: "UTC",
      slot: "lunch",
      title: "Lunch",
      status: "ready",
      totals: { energy: 260 },
      items: [item()],
    } as unknown as MealDto;
    const csv = mealsToCsv({ meals: [meal, { ...meal, items: [] }] });
    const lines = csv.trim().split("\r\n");
    expect(lines).toHaveLength(3);
    expect(lines[0]).toContain("energy_kcal");
    expect(lines[0]).toContain("vit_b12_ug");
    expect(lines[1]).toContain("Rice");
  });
});
