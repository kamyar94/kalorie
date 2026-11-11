// The body weight Kal uses for an activity's energy estimate: the last weigh-in on or before the
// day (typed, imported or from openGym), else the profile's weight. Values are never logged.
import { eq } from "drizzle-orm";

import { db as defaultDb, type DbOrTx } from "@/db";
import { users } from "@/db/schema";

import { lastWeightOn } from "./service";

/** Kilograms on a local day, or null when Kal knows no weight at all. */
export const bodyWeightOn = async (
  userId: string,
  localDate: string,
  dbx: DbOrTx = defaultDb,
): Promise<number | null> => {
  const measured = await lastWeightOn(userId, localDate, dbx);
  if (measured !== null) return measured;
  const profile = await dbx
    .select({ kg: users.weightKg })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  return profile[0]?.kg ?? null;
};
