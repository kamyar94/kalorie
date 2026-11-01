import { describe, expect, it } from "vitest";

import type { Profile } from "@/lib/contracts/targets";

import { baseTargets, DEFAULT_TARGETS, mifflinStJeor, targetsFromProfile } from "./formulas";

const now = new Date("2026-06-01T00:00:00Z");
const profile: Profile = {
  sex: "male",
  birthYear: 1991,
  heightCm: 180,
  weightKg: 80,
  activityLevel: "moderate",
  goal: "keep",
  goalRateKgPerWeek: null,
};

describe("targets", () => {
  it("computes resting energy with Mifflin-St Jeor", () => {
    expect(mifflinStJeor({ sex: "male", weightKg: 80, heightCm: 180, age: 35 })).toBe(1755);
    expect(mifflinStJeor({ sex: "female", weightKg: 60, heightCm: 165, age: 30 })).toBeCloseTo(
      1320.25,
    );
  });

  it("multiplies by activity and splits macros", () => {
    const t = targetsFromProfile(profile, now)!;
    expect(t.restingKcal).toBe(1755);
    expect(t.maintenanceKcal).toBe(2720); // 1755 x 1.55
    expect(t.energy).toBe(2720);
    expect(t.protein).toBe(128); // 1.6 g per kg
    expect(t.fat).toBe(91); // 30 % of energy
    expect(t.carbs).toBe(Math.round((2720.25 - 128 * 4 - 0.3 * 2720.25) / 4));
  });

  it("adjusts for the goal and never goes below the floor", () => {
    expect(
      targetsFromProfile({ ...profile, goal: "lose", goalRateKgPerWeek: 0.5 }, now)!.energy,
    ).toBe(2170);
    expect(targetsFromProfile({ ...profile, goal: "gain" }, now)!.energy).toBe(2995);
    const small = {
      ...profile,
      weightKg: 45,
      heightCm: 150,
      activityLevel: "sedentary" as const,
      goal: "lose" as const,
      goalRateKgPerWeek: 1,
    };
    expect(targetsFromProfile(small, now)!.energy).toBe(1200);
  });

  it("falls back to defaults without a complete profile", () => {
    expect(targetsFromProfile({ ...profile, weightKg: null }, now)).toBeNull();
    expect(baseTargets({ ...profile, sex: null }, now)).toEqual({
      fromProfile: false,
      targets: DEFAULT_TARGETS,
    });
    const fromProfile = baseTargets(profile, now);
    expect(fromProfile.fromProfile).toBe(true);
    expect(fromProfile.targets.find((t) => t.code === "sodium")?.kind).toBe("max");
  });
});
