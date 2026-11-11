// The body weight Kal uses for an activity's energy estimate: the last weigh-in on or before the
// day, else the profile's weight. Values are never logged.
import { and, eq } from "drizzle-orm";

import { db as defaultDb, type DbOrTx } from "@/db";
import { integrations, users } from "@/db/schema";
import { weightForDay } from "@/lib/integrations/opengym/parse";
import type { WeightPointDto } from "@/lib/contracts/integrations";

/** Kilograms on a local day, or null when Kal knows no weight at all. */
export const bodyWeightOn = async (
  userId: string,
  localDate: string,
  dbx: DbOrTx = defaultDb,
): Promise<number | null> => {
  const [profile, gym] = await Promise.all([
    dbx.select({ kg: users.weightKg }).from(users).where(eq(users.id, userId)).limit(1),
    dbx
      .select({ settings: integrations.settings })
      .from(integrations)
      .where(and(eq(integrations.userId, userId), eq(integrations.kind, "opengym")))
      .limit(1),
  ]);
  const weights = (gym[0]?.settings as { weights?: WeightPointDto[] } | undefined)?.weights;
  const before = Array.isArray(weights) ? weights.filter((w) => w.date <= localDate) : [];
  return before.length ? weightForDay(localDate, before, null) : (profile[0]?.kg ?? null);
};
