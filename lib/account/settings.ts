// The person's own profile and preferences (Settings). The profile feeds the targets
// (lib/targets); preferences change how meals are filed and shown. Every function changes only
// the signed-in person's row.
import { eq } from "drizzle-orm";

import { db as defaultDb, type DbOrTx } from "@/db";
import { users, type NotificationPrefs } from "@/db/schema";
import type { ActivityLevel, Goal, Profile, Sex } from "@/lib/contracts/targets";
import { ACTIVITY_FACTORS } from "@/lib/contracts/targets";
import { DEFAULT_MEAL_WINDOWS, isValidTimeZone, type MealWindows } from "@/lib/meals/time";

export class SettingsInputError extends Error {}

export type Units = "metric" | "imperial";

export type Preferences = {
  timeZone: string;
  units: Units;
  mealWindows: MealWindows;
  cuisines: string[];
  notifications: NotificationPrefs;
};

export const MAX_CUISINES = 8;

const number = (value: unknown, min: number, max: number, label: string) => {
  if (value === null || value === undefined || value === "") return null;
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n) || n < min || n > max)
    throw new SettingsInputError(`${label} should be between ${min} and ${max}.`);
  return n;
};

/** Checks a profile from the settings form; empty fields stay unknown (null). */
export const parseProfile = (input: Partial<Record<keyof Profile, unknown>>): Profile => {
  const sex = input.sex === "female" || input.sex === "male" ? (input.sex as Sex) : null;
  const activity =
    typeof input.activityLevel === "string" && input.activityLevel in ACTIVITY_FACTORS
      ? (input.activityLevel as ActivityLevel)
      : null;
  const goal = ["lose", "keep", "gain"].includes(input.goal as string)
    ? (input.goal as Goal)
    : null;
  const year = new Date().getUTCFullYear();
  const birthYear = number(input.birthYear, year - 110, year - 13, "Birth year");
  return {
    sex,
    birthYear: birthYear === null ? null : Math.round(birthYear),
    heightCm: number(input.heightCm, 100, 250, "Height (cm)"),
    weightKg: number(input.weightKg, 30, 300, "Weight (kg)"),
    activityLevel: activity,
    goal,
    goalRateKgPerWeek: goal === "keep" ? null : number(input.goalRateKgPerWeek, 0, 1, "Rate"),
  };
};

export const updateProfile = async (
  userId: string,
  input: Partial<Record<keyof Profile, unknown>>,
  dbx: DbOrTx = defaultDb,
) => {
  const profile = parseProfile(input);
  await dbx.update(users).set(profile).where(eq(users.id, userId));
  return profile;
};

export const getPreferences = async (
  userId: string,
  dbx: DbOrTx = defaultDb,
): Promise<Preferences | null> => {
  const row = (
    await dbx
      .select({
        timeZone: users.timeZone,
        units: users.units,
        mealWindows: users.mealWindows,
        cuisines: users.cuisines,
        notifications: users.notifications,
      })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1)
  )[0];
  if (!row) return null;
  return {
    ...row,
    mealWindows: { ...DEFAULT_MEAL_WINDOWS, ...(row.mealWindows ?? {}) },
    notifications: {
      analysisReady: row.notifications?.analysisReady === true,
      questions: row.notifications?.questions === true,
    },
  };
};

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
const minutes = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3));

/** Meal windows must be valid times, start before end, and not overlap. */
export const parseMealWindows = (input: unknown): MealWindows => {
  const value = (input ?? {}) as Partial<Record<keyof MealWindows, unknown>>;
  const out = {} as MealWindows;
  for (const slot of ["breakfast", "lunch", "dinner"] as const) {
    const pair = value[slot];
    if (
      !Array.isArray(pair) ||
      pair.length !== 2 ||
      !pair.every((t) => typeof t === "string" && HHMM.test(t))
    )
      throw new SettingsInputError("Use times like 07:30.");
    if (minutes(pair[0] as string) >= minutes(pair[1] as string))
      throw new SettingsInputError("Each meal window must start before it ends.");
    out[slot] = [pair[0] as string, pair[1] as string];
  }
  if (
    minutes(out.breakfast[1]) >= minutes(out.lunch[0]) ||
    minutes(out.lunch[1]) >= minutes(out.dinner[0])
  )
    throw new SettingsInputError("Breakfast, lunch and dinner windows must not overlap.");
  return out;
};

export const parseCuisines = (input: unknown) => {
  const list = Array.isArray(input) ? input : [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const entry of list) {
    if (typeof entry !== "string") continue;
    const text = entry.trim().replace(/\s+/g, " ").slice(0, 40);
    const key = text.toLowerCase();
    if (!text || seen.has(key)) continue;
    seen.add(key);
    out.push(text);
  }
  if (out.length > MAX_CUISINES)
    throw new SettingsInputError(`Pick at most ${MAX_CUISINES} cuisines.`);
  return out;
};

/** Saves any of the preferences given. */
export const updatePreferences = async (
  userId: string,
  input: Partial<Record<keyof Preferences, unknown>>,
  dbx: DbOrTx = defaultDb,
) => {
  const set: Partial<typeof users.$inferInsert> = {};
  if (input.timeZone !== undefined) {
    if (!isValidTimeZone(input.timeZone)) throw new SettingsInputError("Unknown time zone.");
    set.timeZone = input.timeZone;
  }
  if (input.units !== undefined) {
    if (input.units !== "metric" && input.units !== "imperial")
      throw new SettingsInputError("Unknown units.");
    set.units = input.units;
  }
  if (input.mealWindows !== undefined) set.mealWindows = parseMealWindows(input.mealWindows);
  if (input.cuisines !== undefined) set.cuisines = parseCuisines(input.cuisines);
  if (input.notifications !== undefined) {
    const n = (input.notifications ?? {}) as Record<string, unknown>;
    set.notifications = {
      analysisReady: n.analysisReady === true,
      questions: n.questions === true,
    };
  }
  if (Object.keys(set).length) await dbx.update(users).set(set).where(eq(users.id, userId));
  return getPreferences(userId, dbx);
};
