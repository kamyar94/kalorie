// CONTRACT: daily targets (docs/DESIGN.md section 6). lib/targets/service.ts implements it: energy
// and macros from the profile (Mifflin-St Jeor, activity factor, goal), vitamins and minerals from
// the US Dietary Reference Intakes (lib/targets/dri.ts), fixed defaults without a profile.
//
//   getTargets(userId)                     -> DailyTargets
//   setCustomTarget(userId, code, target)  -> void   (stays fixed until reset)
//   resetTarget(userId, code)              -> void
import type { NutrientCode } from "./nutrients";

export type Sex = "female" | "male";
export type ActivityLevel = "sedentary" | "light" | "moderate" | "active" | "very_active";
export type Goal = "lose" | "keep" | "gain";

export const ACTIVITY_FACTORS: Record<ActivityLevel, number> = {
  sedentary: 1.2,
  light: 1.375,
  moderate: 1.55,
  active: 1.725,
  very_active: 1.9,
};

export type Profile = {
  sex: Sex | null;
  birthYear: number | null;
  heightCm: number | null;
  weightKg: number | null;
  activityLevel: ActivityLevel | null;
  goal: Goal | null;
  /** Kilograms per week to lose or gain (positive). */
  goalRateKgPerWeek: number | null;
};

/**
 * goal: aim for about this much (energy). min: at least (protein, fiber, vitamins). max: at most
 * (sodium, saturated fat, added sugar). range: between target and upper.
 */
export type TargetKind = "goal" | "min" | "max" | "range";

export type NutrientTarget = {
  code: NutrientCode;
  target: number | null;
  /** Tolerable upper intake, when there is one. */
  upper: number | null;
  kind: TargetKind;
  /** Edited by hand; stays fixed until reset. */
  custom: boolean;
  /** "profile" (computed), "dri", "default" (no profile yet) or "custom". */
  basis: "profile" | "dri" | "default" | "custom";
};

export type DailyTargets = {
  /** True when the profile was complete enough for computed energy and macros. */
  fromProfile: boolean;
  targets: Partial<Record<NutrientCode, NutrientTarget>>;
};
