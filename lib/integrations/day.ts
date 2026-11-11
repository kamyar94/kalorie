// What the screens show from the integrations (CONTRACT: lib/contracts/integrations.ts): the
// day's planned Mealie recipes and openGym workouts, weigh-ins for trends, and logging a planned
// recipe. A service that is down or refuses the token never breaks a screen: its part is empty
// and Settings shows why.
import { eq } from "drizzle-orm";

import { db as defaultDb, type DbOrTx } from "@/db";
import { users } from "@/db/schema";
import { weightsByDay } from "@/lib/body/service";
import type {
  DayPlan,
  LogPlannedResult,
  PlannedMealDto,
  WeightPointDto,
  WorkoutDto,
} from "@/lib/contracts/integrations";

import { integrationConfig } from "./config";
import { getPlannedMeals, localToday, logPlannedMeal as logPlanned } from "./mealie/service";
import { getWorkouts, openGymData } from "./opengym/service";
import { credentialOf, getIntegrationRow } from "./store";

export { getIntegrationStatuses } from "./store";

/** Planned Mealie meals and openGym workouts of one local day. */
export const getDayPlan = async (
  userId: string,
  localDate: string,
  options: { today?: string } = {},
  dbx: DbOrTx = defaultDb,
): Promise<DayPlan> => {
  const mealieRow = integrationConfig().mealieBaseUrl
    ? await getIntegrationRow(userId, "mealie", dbx)
    : null;
  const mealieConnected = !!credentialOf(mealieRow);
  let today = options.today;
  if (!today) {
    const tz = (
      await dbx.select({ tz: users.timeZone }).from(users).where(eq(users.id, userId)).limit(1)
    )[0]?.tz;
    today = localToday(tz ?? "UTC");
  }
  const [planned, workouts] = await Promise.all([
    mealieConnected
      ? getPlannedMeals(userId, localDate, today, dbx).catch((): PlannedMealDto[] => [])
      : Promise.resolve<PlannedMealDto[]>([]),
    getWorkouts(userId, localDate, dbx).catch((): WorkoutDto[] => []),
  ]);
  return { planned, workouts, mealieConnected };
};

/**
 * Weigh-ins between two local days (both included), one a day, oldest first: typed on Body,
 * imported, and openGym's (each openGym sync stores them, lib/body/service.ts).
 */
export const getWeightHistory = async (
  userId: string,
  from: string,
  to: string,
  dbx: DbOrTx = defaultDb,
): Promise<WeightPointDto[]> => {
  // openGym data older than its sync age is read again first, as the screens always did.
  await openGymData(userId, {}, dbx).catch(() => null);
  return weightsByDay(userId, from, to, dbx);
};

/** Logs a planned recipe as a meal (servings of the recipe, nutrients from the recipe). */
export const logPlannedMeal = (
  userId: string,
  plannedId: string,
  input: { servings: number; eatenAt: string; tz: string },
  dbx: DbOrTx = defaultDb,
): Promise<LogPlannedResult> => logPlanned(userId, plannedId, input, dbx);
