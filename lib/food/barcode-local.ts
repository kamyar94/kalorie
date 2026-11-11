// Barcode lookup in Kal's own food table (foods.barcode): products cached from Open Food Facts
// and the person's own packaged foods. The barcode route (app/api/foods/barcode/[code]) looks
// here first and asks Open Food Facts (lib/food/off.ts) only for codes that are not here yet.
import { and, eq, inArray, isNull, or, sql } from "drizzle-orm";

import { db as defaultDb, type DbOrTx } from "@/db";
import { foods } from "@/db/schema";
import type { FoodResult } from "@/lib/contracts/food-search";

import { getFood } from "./search";

/** Digits only, 8 to 14 of them (EAN-8, UPC-E, UPC-A, EAN-13, GTIN-14), else null. */
export const normalizeBarcode = (value: string) => {
  const digits = value.replace(/[\s-]/g, "");
  return /^\d{8,14}$/.test(digits) ? digits : null;
};

/**
 * The same product can be written as UPC-A (12 digits), EAN-13 (a leading 0) or GTIN-14 (two
 * leading zeros); all forms are tried.
 */
export const barcodeVariants = (code: string) => {
  const digits = normalizeBarcode(code);
  if (!digits) return [];
  const stripped = digits.replace(/^0+/, "");
  const variants = new Set([digits]);
  for (const length of [8, 12, 13, 14])
    if (stripped.length <= length) variants.add(stripped.padStart(length, "0"));
  return [...variants];
};

/** The food with this barcode the person can see, their own first. */
export const findFoodByBarcode = async (
  userId: string,
  code: string,
  dbx: DbOrTx = defaultDb,
): Promise<FoodResult | null> => {
  const variants = barcodeVariants(code);
  if (!variants.length) return null;
  const row = (
    await dbx
      .select({ id: foods.id })
      .from(foods)
      .where(
        and(inArray(foods.barcode, variants), or(isNull(foods.ownerId), eq(foods.ownerId, userId))),
      )
      .orderBy(sql`(${foods.ownerId} is not null) desc`, foods.createdAt)
      .limit(1)
  )[0];
  return row ? getFood(row.id, userId, dbx) : null;
};
