// Meals logged without a photo (the Add screen: search, barcode, recent foods, custom foods).
// The meal is "ready" at once; its items get their nutrients from the chosen foods.
import { eq } from "drizzle-orm";

import { db as defaultDb, type DbOrTx } from "@/db";
import { meals, users } from "@/db/schema";
import type { ItemInput, MealDto, MealSlot } from "@/lib/contracts/meals";
import { MEAL_SLOTS } from "@/lib/contracts/meals";

import { addItem, getMeal, isUuid } from "./service";
import { isValidTimeZone, localParts, slotFor, type MealWindows } from "./time";

export const MAX_MANUAL_ITEMS = 20;

export type NewManualMeal = {
  eatenAt: string;
  tz: string;
  slot?: MealSlot;
  title?: string | null;
  items: ItemInput[];
  /** "mealie" for a planned recipe logged from the Today screen. */
  source?: "manual" | "mealie";
  /** Unique per person (meals.client_id); a Mealie log uses "mealie-plan:<plan entry id>". */
  clientId?: string | null;
};

export class ManualMealError extends Error {}

/**
 * Creates a meal from one or more items. Every food must be visible to the person; otherwise
 * nothing is saved and ManualMealError is thrown.
 */
export const createManualMeal = async (
  userId: string,
  input: NewManualMeal,
  dbx: DbOrTx = defaultDb,
): Promise<MealDto> => {
  if (!isUuid(userId)) throw new ManualMealError("Unknown account.");
  const eatenAt = new Date(input.eatenAt);
  if (Number.isNaN(eatenAt.getTime()) || !isValidTimeZone(input.tz))
    throw new ManualMealError("The meal time is not valid.");
  if (!input.items.length || input.items.length > MAX_MANUAL_ITEMS)
    throw new ManualMealError(`Add one to ${MAX_MANUAL_ITEMS} foods.`);
  if (input.slot && !MEAL_SLOTS.includes(input.slot)) throw new ManualMealError("Unknown meal.");

  return dbx.transaction(async (tx) => {
    const windows = (
      await tx.select({ w: users.mealWindows }).from(users).where(eq(users.id, userId)).limit(1)
    )[0]?.w as MealWindows | undefined;
    const [meal] = await tx
      .insert(meals)
      .values({
        userId,
        eatenAt,
        tz: input.tz,
        localDate: localParts(eatenAt, input.tz).date,
        slot: input.slot ?? slotFor(eatenAt, input.tz, windows),
        title: input.title?.trim().slice(0, 120) || input.items[0]!.name.trim().slice(0, 120),
        status: "ready",
        source: input.source ?? "manual",
        clientId: input.clientId ?? null,
      })
      .returning({ id: meals.id });
    for (const item of input.items) {
      const added = await addItem(userId, meal!.id, item, tx);
      // Throwing rolls the whole meal back.
      if (!added) throw new ManualMealError("One of the foods could not be found.");
    }
    const created = await getMeal(userId, meal!.id, tx);
    if (!created) throw new ManualMealError("The meal could not be saved.");
    return created;
  });
};
