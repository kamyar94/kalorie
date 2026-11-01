// Targets (CONTRACT: lib/contracts/targets.ts). Energy and macros come from the profile, vitamins
// and minerals from the US Dietary Reference Intakes by sex and age band (lib/targets/dri.ts,
// the static table that dri_targets copies) or the US Daily Values while sex or birth year is
// missing. Edited targets (user_targets.custom) win and stay fixed until reset. The body weight is
// the latest openGym weigh-in while openGym is paired (docs/DESIGN.md section 6), else the
// profile's.
import { and, eq } from "drizzle-orm";

import { db as defaultDb, type DbOrTx } from "@/db";
import { integrations, users, userTargets } from "@/db/schema";
import { isNutrientCode, type NutrientCode } from "@/lib/contracts/nutrients";
import type { DailyTargets, NutrientTarget, Profile } from "@/lib/contracts/targets";

import { latestWeightOf } from "@/lib/integrations/store";

import { dailyTargets } from "./formulas";

/** The latest weigh-in from openGym while it is paired, or null. */
export const openGymWeight = async (userId: string, dbx: DbOrTx = defaultDb) => {
  const row = (
    await dbx
      .select()
      .from(integrations)
      .where(and(eq(integrations.userId, userId), eq(integrations.kind, "opengym")))
      .limit(1)
  )[0];
  return row?.encryptedCredential ? latestWeightOf(row) : null;
};

export const getProfile = async (
  userId: string,
  dbx: DbOrTx = defaultDb,
): Promise<Profile | null> => {
  const row = (await dbx.select().from(users).where(eq(users.id, userId)).limit(1))[0];
  if (!row) return null;
  return {
    sex: row.sex,
    birthYear: row.birthYear,
    heightCm: row.heightCm,
    weightKg: row.weightKg,
    activityLevel: row.activityLevel,
    goal: row.goal,
    goalRateKgPerWeek: row.goalRateKgPerWeek,
  };
};

export const getTargets = async (
  userId: string,
  dbx: DbOrTx = defaultDb,
): Promise<DailyTargets> => {
  const [stored, synced] = await Promise.all([getProfile(userId, dbx), openGymWeight(userId, dbx)]);
  const profile = stored && synced ? { ...stored, weightKg: synced.kg } : stored;
  const base = dailyTargets(
    profile ?? {
      sex: null,
      birthYear: null,
      heightCm: null,
      weightKg: null,
      activityLevel: null,
      goal: null,
      goalRateKgPerWeek: null,
    },
  );
  const targets: Partial<Record<NutrientCode, NutrientTarget>> = {};
  for (const target of base.targets) targets[target.code] = target;
  const custom = await dbx
    .select()
    .from(userTargets)
    .where(and(eq(userTargets.userId, userId), eq(userTargets.custom, true)));
  for (const row of custom) {
    if (!isNutrientCode(row.nutrientCode)) continue;
    targets[row.nutrientCode] = {
      code: row.nutrientCode,
      target: row.target,
      upper: row.upper,
      kind: row.kind,
      custom: true,
      basis: "custom",
    };
  }
  return { fromProfile: base.fromProfile, targets };
};

export const setCustomTarget = async (
  userId: string,
  code: NutrientCode,
  value: { target: number | null; upper?: number | null; kind?: NutrientTarget["kind"] },
  dbx: DbOrTx = defaultDb,
) => {
  if (!isNutrientCode(code)) throw new Error("Unknown nutrient.");
  const current = (await getTargets(userId, dbx)).targets[code];
  const kind = value.kind ?? current?.kind ?? "min";
  await dbx
    .insert(userTargets)
    .values({
      userId,
      nutrientCode: code,
      target: value.target,
      upper: value.upper ?? null,
      kind,
      custom: true,
    })
    .onConflictDoUpdate({
      target: [userTargets.userId, userTargets.nutrientCode],
      set: {
        target: value.target,
        upper: value.upper ?? null,
        kind,
        custom: true,
        updatedAt: new Date(),
      },
    });
};

export const resetTarget = async (userId: string, code: NutrientCode, dbx: DbOrTx = defaultDb) => {
  await dbx
    .delete(userTargets)
    .where(and(eq(userTargets.userId, userId), eq(userTargets.nutrientCode, code)));
};
