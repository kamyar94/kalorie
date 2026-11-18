// Hints a screen shows until the person closes them; a closed hint stays closed for that person
// (users.dismissed_hints). Every function changes or reads only the signed-in person's row.
import { eq, sql } from "drizzle-orm";

import { db as defaultDb, type DbOrTx } from "@/db";
import { users } from "@/db/schema";
import { isUuid } from "@/lib/meals/service";

/** phone-steps-only: on Move, while only the phone's own step counter sends steps. */
export const HINTS = ["phone-steps-only"] as const;
export type HintCode = (typeof HINTS)[number];

export const isHintCode = (value: unknown): value is HintCode =>
  typeof value === "string" && (HINTS as readonly string[]).includes(value);

/** The hints the person has closed. */
export const dismissedHints = async (
  userId: string,
  dbx: DbOrTx = defaultDb,
): Promise<HintCode[]> => {
  if (!isUuid(userId)) return [];
  const [row] = await dbx
    .select({ hints: users.dismissedHints })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  return (row?.hints ?? []).filter(isHintCode);
};

/** Closes a hint for good (closing it again changes nothing). */
export const dismissHint = async (userId: string, hint: HintCode, dbx: DbOrTx = defaultDb) => {
  if (!isUuid(userId) || !isHintCode(hint)) return;
  await dbx
    .update(users)
    .set({
      dismissedHints: sql`case when ${hint} = any(${users.dismissedHints}) then ${users.dismissedHints} else array_append(${users.dismissedHints}, ${hint}::text) end`,
    })
    .where(eq(users.id, userId));
};
