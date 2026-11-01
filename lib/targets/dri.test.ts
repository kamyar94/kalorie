import { describe, expect, it } from "vitest";

import { isNutrientCode } from "@/lib/contracts/nutrients";
import type { Profile } from "@/lib/contracts/targets";

import { DAILY_VALUES, DRI_AGE_BANDS, DRI_NUTRIENTS, driBand, driFor, driRows } from "./dri";
import { baseTargets, dailyTargets, microTargets } from "./formulas";

const now = new Date("2026-06-01T00:00:00Z");
const woman: Profile = {
  sex: "female",
  birthYear: 1991, // 35
  heightCm: 165,
  weightKg: 60,
  activityLevel: "light",
  goal: "keep",
  goalRateKgPerWeek: null,
};

describe("DRI table", () => {
  it("covers every band for both sexes with catalogue codes", () => {
    for (const nutrient of DRI_NUTRIENTS) {
      expect(isNutrientCode(nutrient.code)).toBe(true);
      expect(nutrient.male).toHaveLength(DRI_AGE_BANDS.length);
      expect(nutrient.female).toHaveLength(DRI_AGE_BANDS.length);
      if (nutrient.ul) expect(nutrient.ulScope).not.toBeNull();
    }
    expect(driRows()).toHaveLength(DRI_NUTRIENTS.length * 2 * DRI_AGE_BANDS.length);
  });

  it("finds the age band", () => {
    expect(driBand(13)).toBe(-1);
    expect(driBand(14)).toBe(0);
    expect(driBand(18)).toBe(0);
    expect(driBand(19)).toBe(1);
    expect(driBand(50)).toBe(2);
    expect(driBand(51)).toBe(3);
    expect(driBand(71)).toBe(4);
    expect(driBand(130)).toBe(4);
  });

  it("holds the published values (spot checks)", () => {
    const get = (sex: "female" | "male", age: number, code: string) =>
      driFor(sex, age)!.find((v) => v.code === code)!;
    expect(get("female", 35, "iron")).toMatchObject({ rda: 18, ul: 45, ulScope: "total" });
    expect(get("female", 55, "iron").rda).toBe(8);
    expect(get("male", 35, "iron").rda).toBe(8);
    expect(get("female", 16, "iron").rda).toBe(15);
    expect(get("female", 55, "calcium")).toMatchObject({ rda: 1200, ul: 2000 });
    expect(get("male", 55, "calcium").rda).toBe(1000);
    expect(get("male", 75, "vit_d").rda).toBe(20);
    expect(get("male", 35, "vit_k")).toMatchObject({ rda: null, ai: 120 });
    expect(get("female", 35, "potassium").ai).toBe(2600);
    expect(get("male", 35, "magnesium")).toMatchObject({
      rda: 420,
      ul: 350,
      ulScope: "supplements",
    });
    expect(get("male", 35, "copper")).toMatchObject({ rda: 0.9, ul: 10 });
    expect(get("male", 75, "phosphorus").ul).toBe(3000);
    expect(get("female", 35, "choline")).toMatchObject({ ai: 425, ul: 3500 });
    expect(get("male", 60, "vit_b6").rda).toBe(1.7);
    expect(driFor("male", 12)).toBeNull();
  });
});

describe("vitamin and mineral targets", () => {
  it("uses the DRI for sex and age, with upper limits only where they apply to food", () => {
    const rows = microTargets(woman, now);
    const by = Object.fromEntries(rows.map((r) => [r.code, r]));
    expect(by.iron).toMatchObject({ target: 18, upper: 45, kind: "range", basis: "dri" });
    expect(by.magnesium).toMatchObject({ target: 320, upper: null, kind: "min" });
    expect(by.vit_a).toMatchObject({ target: 700, upper: null, kind: "min" });
    expect(by.folate).toMatchObject({ target: 400, upper: null });
    expect(by.sodium).toMatchObject({ target: 2300, kind: "max", basis: "dri" });
    expect(by.water).toBeUndefined();
  });

  it("uses the Daily Values until sex and birth year are known", () => {
    const rows = microTargets({ ...woman, sex: null }, now);
    expect(rows.every((r) => r.basis === "default" && r.kind === "min")).toBe(true);
    expect(rows.find((r) => r.code === "iron")?.target).toBe(DAILY_VALUES.iron);
  });

  it("keeps computed energy, macros and fiber, and replaces fixed defaults with the DRI", () => {
    const full = dailyTargets(woman, now);
    const by = Object.fromEntries(full.targets.map((r) => [r.code, r]));
    expect(full.fromProfile).toBe(true);
    expect(by.fiber?.basis).toBe("profile");
    expect(by.sodium?.basis).toBe("dri");
    expect(by.fat_sat).toMatchObject({ kind: "max", basis: "profile" });
    expect(by.sugars_added?.target).toBe(Math.round((0.1 * by.energy!.target!) / 4));
    expect(new Set(full.targets.map((t) => t.code)).size).toBe(full.targets.length);

    // Sex and age known but no weight: energy stays default, fiber comes from the DRI.
    const partial = dailyTargets({ ...woman, weightKg: null }, now);
    const p = Object.fromEntries(partial.targets.map((r) => [r.code, r]));
    expect(partial.fromProfile).toBe(false);
    expect(p.energy?.basis).toBe("default");
    expect(p.fiber).toMatchObject({ target: 25, basis: "dri" });
    expect(
      baseTargets({ ...woman, weightKg: null }, now).targets.find((t) => t.code === "fiber"),
    ).toMatchObject({ target: 28, basis: "default" });
  });
});
