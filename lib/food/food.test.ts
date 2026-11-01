import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { isValidGtin, normalizeBarcode } from "./barcode";
import { computeDish } from "./dish-core";
import { cleanNutrients, FoodInputError } from "./errors";
import { nextTypicalGrams } from "./memory";
import { foodSearchText, normalizeFoodText } from "./normalize";
import { offConfig, offFoodRow, offNutrients, type OffProduct } from "./off";
import { queryWords, stemWord } from "./search";

describe("dish nutrients", () => {
  const rice = { energy: 130, protein: 2.7, water: 68 };
  const butter = { energy: 717, fat: 81, water: 16 };

  it("sums components and gives values per 100 g of the dish", () => {
    const dish = computeDish([
      { grams: 200, per100g: rice },
      { grams: 10, per100g: butter },
    ]);
    expect(dish.componentGrams).toBe(210);
    expect(dish.servingGrams).toBe(210);
    expect(dish.perServing.energy).toBeCloseTo(260 + 71.7);
    expect(dish.perServing.fat).toBeCloseTo(8.1);
    expect(dish.per100g.energy).toBeCloseTo((331.7 / 210) * 100, 3);
  });

  it("books cooking loss to water: per serving stays, per 100 g rises", () => {
    const raw = computeDish([{ grams: 200, per100g: rice }]);
    const cooked = computeDish([{ grams: 200, per100g: rice }], 150);
    expect(cooked.perServing.energy).toBe(raw.perServing.energy);
    expect(cooked.perServing.water).toBeCloseTo(136 - 50);
    expect(cooked.per100g.energy).toBeCloseTo((260 / 150) * 100, 3);
    // Never below zero water.
    expect(computeDish([{ grams: 100, per100g: butter }], 10).perServing.water).toBe(0);
  });

  it("treats unknown values as unknown and skips empty components", () => {
    const dish = computeDish([
      { grams: 100, per100g: { energy: 100 } },
      { grams: 100, per100g: { energy: 50, fiber: 2 } },
      { grams: 0, per100g: { energy: 999 } },
    ]);
    expect(dish.perServing).toEqual({ energy: 150, fiber: 2 });
    expect(computeDish([]).per100g).toEqual({});
  });
});

describe("query words", () => {
  it("normalises, drops stop words and finds singular prefixes", () => {
    expect(queryWords("Rice, with Chicken!")).toEqual({
      text: "rice with chicken",
      words: [
        { word: "rice", stem: "rice" },
        { word: "chicken", stem: "chicken" },
      ],
    });
    expect(queryWords("the").words).toEqual([{ word: "the", stem: "the" }]);
    expect(queryWords("   ").words).toEqual([]);
    expect(stemWord("eggs")).toBe("egg");
    expect(stemWord("tomatoes")).toBe("tomato");
    expect(stemWord("berries")).toBe("berr");
    expect(stemWord("peaches")).toBe("peach");
    expect(stemWord("hummus")).toBe("hummus");
    expect(stemWord("glass")).toBe("glass");
    expect(stemWord("قورمه")).toBe("قورمه");
  });

  it("unifies Persian letter forms and keeps joined and spaced compounds", () => {
    expect(normalizeFoodText("قورمه‌سبزي")).toBe("قورمه سبزی");
    expect(foodSearchText({ nameEn: "Tahdig", nameFa: "ته‌دیگ" })).toBe("tahdig ته دیگ تهدیگ");
    expect(queryWords("كباب كوبيده").text).toBe("کباب کوبیده");
  });
});

describe("barcodes", () => {
  it("accepts GTIN lengths and checks the check digit", () => {
    expect(normalizeBarcode("3017620422003")).toBe("3017620422003");
    expect(normalizeBarcode(" 3017-6204 22003 ")).toBe("3017620422003");
    expect(normalizeBarcode("12345")).toBeNull();
    expect(isValidGtin("3017620422003")).toBe(true);
    expect(isValidGtin("3017620422004")).toBe(false);
    expect(isValidGtin("96385074")).toBe(true); // EAN-8
    expect(isValidGtin("036000291452")).toBe(true); // UPC-A
  });
});

describe("Open Food Facts mapping", () => {
  const recorded = JSON.parse(
    readFileSync(
      path.resolve(import.meta.dirname, "../../tests/fixtures/off/product-3017620422003.json"),
      "utf8",
    ),
  ) as { status: number; product: OffProduct };

  it("maps a recorded product to values per 100 g with attribution", () => {
    const row = offFoodRow("3017620422003", recorded.product);
    expect(row.nameEn).toBe("Nutella");
    expect(row.brand).toBe("Nutella");
    expect(row.category).toBe("confectionary based spreads");
    expect(row.nutrients).toMatchObject({
      energy: 539,
      fat: 30.9,
      protein: 6.3,
      sodium: 42.8,
      sugars_added: 52.13,
    });
    expect(row.densityGPerMl).toBeNull();
    expect(row.portions).toEqual([{ label: "1 package (400 g e)", grams: 400 }]);
    expect(row.sourceNote).toMatch(/Open Database License/);
  });

  it("converts units, salt and kJ, and takes drinks per 100 ml", () => {
    expect(
      offNutrients({
        energy_100g: 418.4,
        salt_100g: 1,
        "vitamin-c_100g": 0.006,
        "vitamin-d_100g": 0.0000025,
        cholesterol_100g: 0.05,
        alcohol_100g: 5,
        fat_100g: 140,
        proteins_100g: -1,
      }),
    ).toEqual({ energy: 100, sodium: 400, vit_c: 6, vit_d: 2.5, cholesterol: 50, alcohol: 3.945 });
    const drink = offFoodRow("5449000000996", {
      product_name: "Cola",
      quantity: "330 ml",
      serving_quantity: "330",
      serving_size: "1 can",
      nutriments: { "energy-kcal_100g": 42, sugars_100g: 10.6 },
    });
    expect(drink.densityGPerMl).toBe(1);
    expect(drink.servingGrams).toBe(330);
    expect(drink.portions).toEqual([{ label: "1 serving (1 can)", grams: 330 }]);
    expect(drink.sourceNote).toMatch(/per 100 ml/);
    expect(offFoodRow("4006381333931", {}).nameEn).toBe("Product 4006381333931");
  });

  it("builds its User-Agent and base URL from server settings only", () => {
    expect(offConfig({})).toEqual({
      baseUrl: "https://world.openfoodfacts.org",
      userAgent: "Cal/0.1 (self-hosted food log)",
      cacheDays: 30,
    });
    expect(
      offConfig({
        OFF_BASE_URL: "http://127.0.0.1:9/",
        OFF_CONTACT: "admin@example.org",
        OFF_CACHE_DAYS: "7",
      }),
    ).toEqual({
      baseUrl: "http://127.0.0.1:9",
      userAgent: "Cal/0.1 (self-hosted food log; admin@example.org)",
      cacheDays: 7,
    });
  });
});

describe("memory and input checks", () => {
  it("follows the typical weight over the last few uses", () => {
    expect(nextTypicalGrams(null, 0, 250)).toBe(250);
    expect(nextTypicalGrams(250, 1, 350)).toBe(300);
    expect(nextTypicalGrams(300, 10, 400)).toBe(320); // weight 4 of the past, 1 of the new
    expect(nextTypicalGrams(300, 3, null)).toBe(300);
  });

  it("accepts catalogue codes and fdc ids, refuses odd values", () => {
    expect(
      cleanNutrients({ energy: 120.123456, "fdc:1062": 500, fat: null }, "per100g", true),
    ).toEqual({
      energy: 120.1235,
      "fdc:1062": 500,
    });
    expect(() => cleanNutrients({ energy: 1200 }, "per100g", true)).toThrow(FoodInputError);
    expect(() => cleanNutrients({ protein: 101 }, "per100g", true)).toThrow(/100 g/);
    expect(() => cleanNutrients({ potion: 1 }, "per100g", true)).toThrow(/Unknown nutrient/);
    expect(() => cleanNutrients({ fat: -1 }, "per100g", true)).toThrow(/0 or more/);
    expect(cleanNutrients({ energy: 1500 }, "perServing", false)).toEqual({ energy: 1500 });
  });
});
