// Target formulas (docs/DESIGN.md section 6). Pure functions, unit tested.
import type { NutrientCode } from "@/lib/contracts/nutrients";
import {
  ACTIVITY_FACTORS,
  type NutrientTarget,
  type Profile,
  type TargetKind,
} from "@/lib/contracts/targets";

import { DAILY_VALUES, driFor } from "./dri";

/** kcal in one kilogram of body weight change (common approximation). */
export const KCAL_PER_KG = 7700;
export const DEFAULT_RATE_KG_PER_WEEK = { lose: 0.5, gain: 0.25 } as const;
export const MIN_ENERGY_KCAL = 1200;

export const ageFrom = (birthYear: number, now = new Date()) => now.getUTCFullYear() - birthYear;

/** Resting energy by Mifflin-St Jeor, kcal per day. */
export const mifflinStJeor = (input: {
  sex: "female" | "male";
  weightKg: number;
  heightCm: number;
  age: number;
}) =>
  10 * input.weightKg + 6.25 * input.heightCm - 5 * input.age + (input.sex === "male" ? 5 : -161);

export type ProfileTargets = {
  restingKcal: number;
  maintenanceKcal: number;
  energy: number;
  protein: number;
  fat: number;
  carbs: number;
  fiber: number;
};

/** Energy and macros from a complete profile, or null when something is missing. */
export const targetsFromProfile = (profile: Profile, now = new Date()): ProfileTargets | null => {
  const { sex, birthYear, heightCm, weightKg, activityLevel } = profile;
  if (!sex || !birthYear || !heightCm || !weightKg || !activityLevel) return null;
  const age = ageFrom(birthYear, now);
  if (age < 14 || age > 110 || weightKg < 25 || weightKg > 400 || heightCm < 100 || heightCm > 250)
    return null;
  const restingKcal = mifflinStJeor({ sex, weightKg, heightCm, age });
  const maintenanceKcal = restingKcal * ACTIVITY_FACTORS[activityLevel];
  const goal = profile.goal ?? "keep";
  const rate =
    goal === "keep"
      ? 0
      : Math.min(1, Math.max(0, profile.goalRateKgPerWeek ?? DEFAULT_RATE_KG_PER_WEEK[goal]));
  const delta = (rate * KCAL_PER_KG) / 7;
  const energy = Math.max(
    MIN_ENERGY_KCAL,
    goal === "lose"
      ? maintenanceKcal - delta
      : goal === "gain"
        ? maintenanceKcal + delta
        : maintenanceKcal,
  );
  const protein = 1.6 * weightKg;
  const fat = (0.3 * energy) / 9;
  const carbs = Math.max(0, (energy - protein * 4 - fat * 9) / 4);
  return {
    restingKcal: Math.round(restingKcal),
    maintenanceKcal: Math.round(maintenanceKcal),
    energy: Math.round(energy),
    protein: Math.round(protein),
    fat: Math.round(fat),
    carbs: Math.round(carbs),
    fiber: Math.round((14 * energy) / 1000),
  };
};

const t = (
  code: NutrientCode,
  target: number | null,
  kind: TargetKind,
  basis: NutrientTarget["basis"],
  upper: number | null = null,
): NutrientTarget => ({ code, target, upper, kind, custom: false, basis });

/** Targets used before the profile is filled in (US Daily Values for a 2,000 kcal diet). */
export const DEFAULT_TARGETS: NutrientTarget[] = [
  t("energy", 2000, "goal", "default"),
  t("protein", 50, "min", "default"),
  t("fat", 78, "goal", "default"),
  t("carbs", 275, "goal", "default"),
  t("fiber", 28, "min", "default"),
  t("sugars_added", 50, "max", "default"),
  t("fat_sat", 20, "max", "default"),
  t("sodium", 2300, "max", "default"),
];

/** The energy and macro rows for a profile, falling back to the defaults. */
export const baseTargets = (profile: Profile, now = new Date()) => {
  const computed = targetsFromProfile(profile, now);
  if (!computed) return { fromProfile: false, targets: DEFAULT_TARGETS };
  const fromProfile: NutrientTarget[] = [
    t("energy", computed.energy, "goal", "profile"),
    t("protein", computed.protein, "min", "profile"),
    t("fat", computed.fat, "goal", "profile"),
    t("carbs", computed.carbs, "goal", "profile"),
    t("fiber", computed.fiber, "min", "profile"),
    // Dietary Guidelines for Americans 2020-2025: under 10 % of energy each.
    t("sugars_added", Math.round((0.1 * computed.energy) / 4), "max", "profile"),
    t("fat_sat", Math.round((0.1 * computed.energy) / 9), "max", "profile"),
  ];
  const rest = DEFAULT_TARGETS.filter((d) => !fromProfile.some((p) => p.code === d.code));
  return { fromProfile: true, targets: [...fromProfile, ...rest] };
};

/**
 * Vitamin and mineral rows: the US Dietary Reference Intakes for the person's sex and age
 * (lib/targets/dri.ts) when both are known, else the US Daily Values. The RDA, or the AI where
 * there is no RDA, is the target. An upper limit is shown only where it applies to food as well
 * as supplements (kind "range"); sodium is "at most" the 2,300 mg Chronic Disease Risk
 * Reduction intake. Fiber from the DRI (AI by age) only when energy could not be computed.
 * Total water is not a daily target here (logs rarely hold all drinks).
 */
export const microTargets = (profile: Profile, now = new Date()): NutrientTarget[] => {
  const age = profile.birthYear ? ageFrom(profile.birthYear, now) : null;
  const dri = profile.sex && age !== null ? driFor(profile.sex, age) : null;
  if (!dri)
    return Object.entries(DAILY_VALUES).map(([code, value]) =>
      t(code as NutrientCode, value, "min", "default"),
    );
  const rows: NutrientTarget[] = [];
  for (const value of dri) {
    if (value.code === "water") continue;
    if (value.code === "sodium") {
      rows.push(t("sodium", value.ul ?? 2300, "max", "dri"));
      continue;
    }
    const upper = value.ulScope === "total" ? value.ul : null;
    rows.push(t(value.code, value.rda ?? value.ai, upper !== null ? "range" : "min", "dri", upper));
  }
  return rows;
};

/** Every default row for a profile: energy and macros, then vitamins and minerals. */
export const dailyTargets = (profile: Profile, now = new Date()) => {
  const base = baseTargets(profile, now);
  const targets = [...base.targets];
  for (const row of microTargets(profile, now)) {
    const at = targets.findIndex((existing) => existing.code === row.code);
    if (at < 0) targets.push(row);
    // A DRI row replaces a fixed default (sodium, fiber without a profile), never a computed one.
    else if (targets[at]!.basis === "default" && row.basis === "dri") targets[at] = row;
  }
  return { fromProfile: base.fromProfile, targets };
};
