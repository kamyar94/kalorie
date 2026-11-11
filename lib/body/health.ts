// The private health profile (CONTRACT: lib/contracts/body.ts HealthProfileDto): conditions,
// allergies and notes in health_profiles, height, birth year and goal on users (shared with
// Settings). Nothing here leaves the server unless the person turns on "use in analysis"; then
// only the allergies and conditions go with meal analyses to their own AI provider. Never logged.
import { eq } from "drizzle-orm";

import { db as defaultDb, type DbOrTx } from "@/db";
import { healthProfiles } from "@/db/schema";
import { parseProfile, updateProfile } from "@/lib/account/settings";
import type { HealthProfileDto } from "@/lib/contracts/body";
import { isUuid } from "@/lib/meals/service";
import { getProfile } from "@/lib/targets/service";

import type { parseHealthText } from "./parse";

export const getHealthProfile = async (
  userId: string,
  dbx: DbOrTx = defaultDb,
): Promise<HealthProfileDto | null> => {
  if (!isUuid(userId)) return null;
  const [profile, row] = await Promise.all([
    getProfile(userId, dbx),
    dbx.select().from(healthProfiles).where(eq(healthProfiles.userId, userId)).limit(1),
  ]);
  if (!profile) return null;
  return {
    conditions: row[0]?.conditions ?? "",
    allergies: row[0]?.allergies ?? "",
    notes: row[0]?.notes ?? "",
    useInAnalysis: row[0]?.useInAnalysis ?? false,
    heightCm: profile.heightCm,
    birthYear: profile.birthYear,
    goal: profile.goal,
    goalRateKgPerWeek: profile.goalRateKgPerWeek,
  };
};

export type HealthProfileInput = ReturnType<typeof parseHealthText> & {
  heightCm?: unknown;
  birthYear?: unknown;
  goal?: unknown;
  goalRateKgPerWeek?: unknown;
};

/**
 * Saves the health profile. Height, birth year and goal change the profile (and so the targets);
 * fields not given keep their value. Throws SettingsInputError for a value out of range.
 */
export const saveHealthProfile = async (
  userId: string,
  input: HealthProfileInput,
  dbx: DbOrTx = defaultDb,
): Promise<HealthProfileDto | null> => {
  const current = await getProfile(userId, dbx);
  if (!current) return null;
  const profileChange = ["heightCm", "birthYear", "goal", "goalRateKgPerWeek"].some(
    (key) => input[key as keyof HealthProfileInput] !== undefined,
  );
  if (profileChange) {
    const next = { ...current };
    if (input.heightCm !== undefined) next.heightCm = input.heightCm as number | null;
    if (input.birthYear !== undefined) next.birthYear = input.birthYear as number | null;
    if (input.goal !== undefined) next.goal = input.goal as typeof current.goal;
    if (input.goalRateKgPerWeek !== undefined)
      next.goalRateKgPerWeek = input.goalRateKgPerWeek as number | null;
    // The same checks as Settings (ranges, keep has no rate).
    await updateProfile(userId, parseProfile(next), dbx);
  }
  const text = {
    ...(input.conditions !== undefined ? { conditions: input.conditions } : {}),
    ...(input.allergies !== undefined ? { allergies: input.allergies } : {}),
    ...(input.notes !== undefined ? { notes: input.notes } : {}),
    ...(input.useInAnalysis !== undefined ? { useInAnalysis: input.useInAnalysis } : {}),
  };
  if (Object.keys(text).length)
    await dbx
      .insert(healthProfiles)
      .values({ userId, ...text })
      .onConflictDoUpdate({ target: healthProfiles.userId, set: text });
  return getHealthProfile(userId, dbx);
};

/** What a meal analysis may know: allergies and conditions, only when the person allowed it. */
export const healthForAnalysis = async (
  userId: string,
  dbx: DbOrTx = defaultDb,
): Promise<{ allergies: string; conditions: string } | null> => {
  if (!isUuid(userId)) return null;
  const row = (
    await dbx.select().from(healthProfiles).where(eq(healthProfiles.userId, userId)).limit(1)
  )[0];
  if (!row?.useInAnalysis || !(row.allergies.trim() || row.conditions.trim())) return null;
  return { allergies: row.allergies.trim(), conditions: row.conditions.trim() };
};
