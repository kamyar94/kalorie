import { describe, expect, it } from "vitest";

import {
  goalLitres,
  isAlcoholic,
  isWaterName,
  itemWaterMl,
  litres,
  totalWaterMl,
  waterGoalMl,
  type HydrationItem,
} from "./hydration";

const item = (overrides: Partial<HydrationItem> & { name: string }): HydrationItem => ({
  kind: "drink",
  ml: null,
  grams: 0,
  count: 1,
  nutrients: {},
  ...overrides,
});

describe("water from drinks", () => {
  it("counts drinks by volume: ml when set, else grams as ml, times the count", () => {
    expect(itemWaterMl(item({ name: "Coffee", ml: 250, grams: 252 }))).toBe(250);
    expect(itemWaterMl(item({ name: "Orange juice", grams: 200 }))).toBe(200);
    expect(itemWaterMl(item({ name: "Tea", ml: 200, count: 2 }))).toBe(400);
    expect(itemWaterMl(item({ name: "Milk", ml: null, grams: 0 }))).toBe(0);
  });

  it("counts water by name even when it is not marked as a drink", () => {
    expect(itemWaterMl(item({ name: "Water", kind: "ingredient", ml: 500 }))).toBe(500);
    expect(
      itemWaterMl(item({ name: "Glass", kind: "dish", foodName: "Water, tap", grams: 250 })),
    ).toBe(250);
    expect(isWaterName("Sparkling water")).toBe(true);
    expect(isWaterName("آب")).toBe(true);
    for (const name of ["Watermelon", "Water chestnuts", "Watercress", ""])
      expect(isWaterName(name), name).toBe(false);
  });

  it("leaves out food and alcohol", () => {
    expect(itemWaterMl(item({ name: "Rice", kind: "dish", grams: 200 }))).toBe(0);
    expect(itemWaterMl(item({ name: "Beer, lager", ml: 330 }))).toBe(0);
    expect(itemWaterMl(item({ name: "Red wine", ml: 150 }))).toBe(0);
    expect(itemWaterMl(item({ name: "Gin and tonic", ml: 250 }))).toBe(0);
    // By the alcohol content: 13 g in 330 ml is about 4 g per 100 g.
    const homeBrew = item({ name: "Home brew", ml: 330, nutrients: { alcohol: 13 } });
    expect(isAlcoholic(homeBrew)).toBe(true);
    expect(itemWaterMl(homeBrew)).toBe(0);
    // Alcohol-free beer and a trace of alcohol (kefir, 0.3 g per 100 g) still count.
    expect(itemWaterMl(item({ name: "Alcohol-free beer", ml: 330 }))).toBe(330);
    expect(itemWaterMl(item({ name: "Kefir", ml: 200, nutrients: { alcohol: 0.6 } }))).toBe(200);
  });

  it("adds up a day", () => {
    expect(
      totalWaterMl([
        item({ name: "Water", ml: 250 }),
        item({ name: "Coffee", ml: 250 }),
        item({ name: "Beer", ml: 500 }),
        item({ name: "Toast", kind: "dish", grams: 60 }),
        item({ name: "Tea", ml: 200, count: 2 }),
      ]),
    ).toBe(900);
    expect(totalWaterMl([])).toBe(0);
  });
});

describe("the water goal", () => {
  it("is the drinks share of EFSA's adequate intake: 1.6 L women, 2.0 L men, else 1.8 L", () => {
    expect(waterGoalMl("female")).toBe(1600);
    expect(waterGoalMl("male")).toBe(2000);
    expect(waterGoalMl(null)).toBe(1800);
  });

  it("reads as litres", () => {
    expect(litres(1250)).toBe("1.25");
    expect(litres(0)).toBe("0");
    expect(goalLitres(2000)).toBe("2.0");
    expect(goalLitres(1800)).toBe("1.8");
    expect(goalLitres(1750)).toBe("1.75");
  });
});
