import { describe, expect, it } from "vitest";

import {
  amountGrams,
  energyFromMacros,
  estimateToNutrients,
  formatNutrient,
  gramsFromMl,
  isNutrientCode,
  mlFromGrams,
  multiplyNutrients,
  NUTRIENT_CATALOGUE,
  NUTRIENT_CODES,
  nutrientsForAmount,
  per100gOfMixture,
  roundNutrient,
  scaleNutrients,
  sumNutrients,
} from "./nutrients";

const rice = { energy: 130, protein: 2.7, carbs: 28, fat: 0.3, "fdc:1234": 5 };

describe("nutrient catalogue", () => {
  it("lists every code once, in display order, with distinct FDC ids", () => {
    expect(NUTRIENT_CATALOGUE.map((n) => n.code)).toEqual([...NUTRIENT_CODES]);
    const ids = NUTRIENT_CATALOGUE.flatMap((n) => n.fdcIds);
    expect(new Set(ids).size).toBe(ids.length);
    expect(NUTRIENT_CATALOGUE.every((n, i) => n.order === i && n.fdcIds.length > 0)).toBe(true);
    expect(isNutrientCode("protein")).toBe(true);
    expect(isNutrientCode("fdc:1234")).toBe(false);
  });
});

describe("nutrient math", () => {
  it("scales values per 100 g to a weight, keeping extra FDC values", () => {
    const scaled = scaleNutrients(rice, 150);
    expect(scaled.energy).toBe(195);
    expect(scaled.protein).toBeCloseTo(4.05);
    expect(scaled.carbs).toBe(42);
    expect(scaled["fdc:1234"]).toBe(7.5);
    expect(scaleNutrients(rice, 0).energy).toBe(0);
    expect(scaleNutrients(rice, Number.NaN).energy).toBe(0);
  });

  it("turns millilitres into grams with the density, water when unknown", () => {
    expect(gramsFromMl(250)).toBe(250);
    expect(gramsFromMl(250, 1.03)).toBeCloseTo(257.5);
    expect(gramsFromMl(250, 0)).toBe(250);
    expect(gramsFromMl(-1, 1)).toBe(0);
    expect(mlFromGrams(257.5, 1.03)).toBeCloseTo(250);
  });

  it("counts portions and volumes", () => {
    expect(amountGrams({ grams: 120, count: 2 })).toBe(240);
    expect(amountGrams({ grams: 120, ml: 200, count: 1 }, 1.5)).toBe(300);
    expect(amountGrams({ grams: 120, count: 0 })).toBe(120);
    expect(nutrientsForAmount({ energy: 42 }, { ml: 250 }, 1.04).energy).toBeCloseTo(109.2);
  });

  it("sums maps and ignores values that are not numbers", () => {
    expect(
      sumNutrients([{ energy: 100, protein: 5 }, { energy: 50 }, { energy: Number.NaN }]),
    ).toEqual({ energy: 150, protein: 5 });
    expect(multiplyNutrients({ energy: 100 }, -1)).toEqual({});
  });

  it("computes a mixture per 100 g from its parts", () => {
    const mix = per100gOfMixture([
      { grams: 100, per100g: { energy: 100 } },
      { grams: 300, per100g: { energy: 300 } },
    ]);
    expect(mix.energy).toBeCloseTo(250);
    expect(per100gOfMixture([])).toEqual({});
  });

  it("estimates energy from macros and maps model estimates", () => {
    expect(energyFromMacros({ protein: 10, carbs: 20, fat: 5, alcohol: 1 })).toBe(172);
    expect(estimateToNutrients({ kcal: 500, protein: 20, sugar: 4, sodium: 800, fat: -1 })).toEqual(
      { energy: 500, protein: 20, sugars: 4, sodium: 800 },
    );
  });

  it("rounds and formats with the catalogue's precision", () => {
    expect(roundNutrient("energy", 123.6)).toBe(124);
    expect(roundNutrient("protein", 4.06)).toBe(4.1);
    expect(roundNutrient("copper", 0.1234)).toBe(0.12);
    expect(formatNutrient("energy", 1234.4)).toBe("1,234 kcal");
    expect(formatNutrient("vit_b12", 2.44)).toBe("2.4 µg");
    expect(formatNutrient("energy", null)).toBe("–");
  });
});
