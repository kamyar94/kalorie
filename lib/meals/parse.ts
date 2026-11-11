// Turns untrusted JSON from the browser into the meal contract's input types. Unknown fields are
// dropped; wrong types make the field absent (the service then keeps the current value), so a
// request can never write something the contract does not allow. Plain functions.
import type { ItemInput, ItemKind, ItemPatch, MealPatch, MealSlot } from "@/lib/contracts/meals";
import { MEAL_SLOTS } from "@/lib/contracts/meals";
import type { NutrientMap } from "@/lib/contracts/nutrients";

const ITEM_KINDS: ItemKind[] = ["dish", "ingredient", "drink", "packaged"];

const str = (value: unknown, max: number) =>
  typeof value === "string" ? value.trim().slice(0, max) : undefined;

const num = (value: unknown, max: number) =>
  typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= max
    ? value
    : undefined;

const nutrientMap = (value: unknown): NutrientMap | undefined => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
  const out: NutrientMap = {};
  for (const [code, amount] of Object.entries(value as Record<string, unknown>).slice(0, 80))
    if (
      /^[a-z0-9_:]{1,40}$/.test(code) &&
      typeof amount === "number" &&
      Number.isFinite(amount) &&
      amount >= 0
    )
      out[code] = amount;
  return out;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const foodRef = (value: unknown) =>
  value === null ? null : typeof value === "string" && UUID.test(value) ? value : undefined;

export const parseMealPatch = (body: Record<string, unknown>): MealPatch => {
  const patch: MealPatch = {};
  if (typeof body.eatenAt === "string" && !Number.isNaN(new Date(body.eatenAt).getTime()))
    patch.eatenAt = body.eatenAt;
  if (typeof body.tz === "string") patch.tz = body.tz.slice(0, 64);
  if (MEAL_SLOTS.includes(body.slot as MealSlot)) patch.slot = body.slot as MealSlot;
  if (body.title === null || typeof body.title === "string")
    patch.title = body.title === null ? null : str(body.title, 120);
  if (body.note === null || typeof body.note === "string")
    patch.note = body.note === null ? null : str(body.note, 500);
  if (typeof body.favorite === "boolean") patch.favorite = body.favorite;
  return patch;
};

/** An item to add; null when it has no name and no food. */
export const parseItemInput = (body: Record<string, unknown>): ItemInput | null => {
  const name = str(body.name, 120) ?? "";
  const foodId = foodRef(body.foodId);
  if (!name && !foodId) return null;
  const input: ItemInput = { name };
  const localName = str(body.localName, 120);
  if (localName) input.localName = localName;
  if (ITEM_KINDS.includes(body.kind as ItemKind)) input.kind = body.kind as ItemKind;
  if (foodId) input.foodId = foodId;
  const grams = num(body.grams, 10_000);
  if (grams !== undefined && grams > 0) input.grams = grams;
  const ml = num(body.ml, 10_000);
  if (ml !== undefined && ml > 0) input.ml = ml;
  const count = num(body.count, 100);
  if (count !== undefined && count > 0) input.count = count;
  const portionText = str(body.portionText, 60);
  if (portionText) input.portionText = portionText;
  const nutrients = nutrientMap(body.nutrients);
  if (nutrients && !foodId) input.nutrients = nutrients;
  return input;
};

export const parseItemPatch = (body: Record<string, unknown>): ItemPatch => {
  const patch: ItemPatch = {};
  const name = str(body.name, 120);
  if (name) patch.name = name;
  const grams = num(body.grams, 10_000);
  if (grams !== undefined && grams > 0) patch.grams = grams;
  if (body.ml === null) patch.ml = null;
  else {
    const ml = num(body.ml, 10_000);
    if (ml !== undefined && ml > 0) patch.ml = ml;
  }
  const count = num(body.count, 100);
  if (count !== undefined && count > 0) patch.count = count;
  if (body.portionText === null) patch.portionText = null;
  else if (typeof body.portionText === "string") patch.portionText = str(body.portionText, 60);
  const foodId = foodRef(body.foodId);
  if (foodId !== undefined) patch.foodId = foodId;
  const nutrients = nutrientMap(body.nutrients);
  if (nutrients) patch.nutrients = nutrients;
  return patch;
};

/** A time and zone for "I ate this again" and new manual meals. */
export const parseWhen = (body: Record<string, unknown>) => {
  const eatenAt = typeof body.eatenAt === "string" ? body.eatenAt : "";
  const tz = typeof body.tz === "string" ? body.tz.slice(0, 64) : "";
  const at = new Date(eatenAt);
  if (!eatenAt || Number.isNaN(at.getTime())) return null;
  const now = Date.now();
  // Not in the future (a few minutes of clock skew allowed) and within the last year.
  if (at.getTime() > now + 10 * 60_000 || at.getTime() < now - 366 * 86_400_000) return null;
  return { eatenAt: at.toISOString(), tz };
};
