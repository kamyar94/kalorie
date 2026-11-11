// GET /api/foods/barcode/:code -> FoodResult. Kal's own table first (the person's foods and shared
// ones, UPC-A and EAN-13 spellings alike), then Open Food Facts (lib/food/off.ts, cached).
// 400 not a barcode, 404 unknown product, 429 too many lookups, 503 Open Food Facts unreachable.
import type { NextRequest } from "next/server";

import { findFoodByBarcode, normalizeBarcode } from "@/lib/food/barcode-local";
import { lookupBarcode } from "@/lib/food/off";
import { apiUser, errorJson, json } from "@/lib/http/route";

export const dynamic = "force-dynamic";

const found = (food: unknown) => json(food, { headers: { "cache-control": "no-store" } });

export const GET = async (req: NextRequest, { params }: { params: Promise<{ code: string }> }) => {
  const { user, error } = await apiUser(req);
  if (error) return error;
  const code = normalizeBarcode((await params).code);
  if (!code) return errorJson(400, "A barcode has 8 to 14 digits.");
  const local = await findFoodByBarcode(user.id, code);
  if (local) return found(local);
  const lookup = await lookupBarcode(user.id, code);
  switch (lookup.status) {
    case "found":
      return found(lookup.food);
    case "invalid":
      return errorJson(400, "This barcode does not check out. Type the digits again.");
    case "rate_limited":
      return errorJson(429, "Too many barcode lookups. Try again in a minute.");
    case "unavailable":
      return errorJson(503, "Open Food Facts cannot be reached right now. Try again later.");
    default:
      return errorJson(404, "This product is not in Kal or Open Food Facts yet.");
  }
};
