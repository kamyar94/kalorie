// Open Food Facts barcode lookup (docs/DESIGN.md section 5). Packaged products come from the Open
// Food Facts API v2 and are kept as shared foods (source "off", source_id = barcode) with their
// values per 100 g and the attribution the Open Database License asks for. A cached product is
// reused for OFF_CACHE_DAYS (default 30) and served stale when the API cannot be reached.
//
// Server configuration only (never typed by users, so no request forgery):
//   OFF_BASE_URL   default https://world.openfoodfacts.org
//   OFF_CONTACT    an address or URL for the User-Agent, as Open Food Facts asks of API users
//   OFF_CACHE_DAYS default 30
// Requests go through the egress proxy (lib/net/egress.ts). Open Food Facts asks API users to
// stay under 100 product reads a minute; Cal allows 15 a minute per person and 80 overall.
import { and, eq, isNull, sql } from "drizzle-orm";

import { db as defaultDb, type DbOrTx } from "@/db";
import { foodPortions, foods } from "@/db/schema";
import type { BarcodeLookup } from "@/lib/contracts/foods";
import type { NutrientCode, NutrientMap } from "@/lib/contracts/nutrients";
import { egressFetch } from "@/lib/net/egress";
import { takeRateLimit } from "@/lib/rate-limit";

import { isValidGtin, normalizeBarcode } from "./barcode";
import { foodSearchText } from "./normalize";
import { toFoodResults } from "./search";

export const OFF_ATTRIBUTION =
  "Open Food Facts (openfoodfacts.org), data under the Open Database License (ODbL)";

const APP_VERSION = "0.1";

export type OffConfig = {
  baseUrl: string;
  userAgent: string;
  cacheDays: number;
};

export const offConfig = (env: Record<string, string | undefined> = process.env): OffConfig => {
  const contact = (env.OFF_CONTACT ?? "").trim();
  const days = Number(env.OFF_CACHE_DAYS);
  return {
    baseUrl: (env.OFF_BASE_URL || "https://world.openfoodfacts.org").replace(/\/+$/, ""),
    userAgent: `Cal/${APP_VERSION} (self-hosted food log${contact ? `; ${contact}` : ""})`,
    cacheDays: Number.isFinite(days) && days > 0 ? days : 30,
  };
};

// ---- Product to food ----

/** The parts of an API v2 product Cal reads. */
export type OffProduct = {
  code?: string;
  product_name?: string;
  product_name_en?: string;
  product_name_fa?: string;
  generic_name?: string;
  generic_name_en?: string;
  brands?: string;
  quantity?: string;
  product_quantity?: number | string;
  product_quantity_unit?: string;
  serving_size?: string;
  serving_quantity?: number | string;
  serving_quantity_unit?: string;
  categories_tags?: string[];
  nutrition_data_per?: string;
  nutriments?: Record<string, number | string | undefined>;
};

export const OFF_FIELDS = [
  "code",
  "product_name",
  "product_name_en",
  "product_name_fa",
  "generic_name",
  "generic_name_en",
  "brands",
  "quantity",
  "product_quantity",
  "product_quantity_unit",
  "serving_size",
  "serving_quantity",
  "serving_quantity_unit",
  "categories_tags",
  "nutrition_data_per",
  "nutriments",
].join(",");

// Open Food Facts keeps <name>_100g in grams for masses (energy in kcal or kJ, alcohol in % vol).
// factor turns it into the catalogue unit of the code.
const NUTRIMENTS: [string, NutrientCode, number][] = [
  ["proteins", "protein", 1],
  ["fat", "fat", 1],
  ["saturated-fat", "fat_sat", 1],
  ["monounsaturated-fat", "fat_mono", 1],
  ["polyunsaturated-fat", "fat_poly", 1],
  ["trans-fat", "fat_trans", 1],
  ["cholesterol", "cholesterol", 1000],
  ["carbohydrates", "carbs", 1],
  ["fiber", "fiber", 1],
  ["sugars", "sugars", 1],
  ["added-sugars", "sugars_added", 1],
  ["sodium", "sodium", 1000],
  ["potassium", "potassium", 1000],
  ["calcium", "calcium", 1000],
  ["iron", "iron", 1000],
  ["magnesium", "magnesium", 1000],
  ["phosphorus", "phosphorus", 1000],
  ["zinc", "zinc", 1000],
  ["copper", "copper", 1000],
  ["selenium", "selenium", 1e6],
  ["vitamin-a", "vit_a", 1e6],
  ["vitamin-c", "vit_c", 1000],
  ["vitamin-d", "vit_d", 1e6],
  ["vitamin-e", "vit_e", 1000],
  ["vitamin-k", "vit_k", 1e6],
  ["vitamin-b1", "thiamin", 1000],
  ["vitamin-b2", "riboflavin", 1000],
  ["vitamin-pp", "niacin", 1000],
  ["vitamin-b6", "vit_b6", 1000],
  ["vitamin-b12", "vit_b12", 1e6],
  ["folates", "folate", 1e6],
  ["vitamin-b9", "folate", 1e6],
  ["choline", "choline", 1000],
  ["caffeine", "caffeine", 1000],
];

const num = (value: unknown) => {
  const n = typeof value === "string" ? Number(value.replace(",", ".")) : value;
  return typeof n === "number" && Number.isFinite(n) ? n : null;
};

const tidy = (value: number) => Math.round(value * 10_000) / 10_000;

/** Values per 100 g (or 100 ml for drinks) from a product's nutriments. */
export const offNutrients = (nutriments: OffProduct["nutriments"] = {}): NutrientMap => {
  const map: NutrientMap = {};
  const per100 = (name: string) => num(nutriments[`${name}_100g`]);
  const kcal = per100("energy-kcal");
  const kj = per100("energy-kj") ?? per100("energy");
  const energy = kcal ?? (kj !== null ? kj / 4.184 : null);
  if (energy !== null && energy >= 0 && energy <= 1000) map.energy = tidy(energy);
  for (const [name, code, factor] of NUTRIMENTS) {
    if (map[code] !== undefined) continue;
    const value = per100(name);
    if (value === null || value < 0) continue;
    if (factor === 1 && value > 100) continue; // grams in 100 g
    map[code] = tidy(value * factor);
  }
  if (map.sodium === undefined) {
    const salt = per100("salt");
    if (salt !== null && salt >= 0 && salt <= 100) map.sodium = tidy(salt * 400); // g salt -> mg sodium
  }
  const alcohol = per100("alcohol"); // % by volume
  if (alcohol !== null && alcohol > 0 && alcohol <= 100) map.alcohol = tidy(alcohol * 0.789);
  return map;
};

const LIQUID_UNITS = /^(ml|cl|dl|l|fl ?oz)$/i;

const isLiquid = (product: OffProduct) =>
  product.nutrition_data_per === "100ml" ||
  LIQUID_UNITS.test(String(product.product_quantity_unit ?? "").trim()) ||
  LIQUID_UNITS.test(String(product.serving_quantity_unit ?? "").trim()) ||
  /\d\s*(ml|cl|l)\b/i.test(product.quantity ?? "");

const clean = (value: unknown, max = 200) =>
  typeof value === "string" ? value.replace(/\s+/g, " ").trim().slice(0, max) || null : null;

export type OffFoodRow = {
  nameEn: string;
  nameFa: string | null;
  brand: string | null;
  category: string | null;
  nutrients: NutrientMap;
  densityGPerMl: number | null;
  servingGrams: number | null;
  sourceNote: string;
  portions: { label: string; grams: number }[];
};

/** The food row for a product. */
export const offFoodRow = (code: string, product: OffProduct): OffFoodRow => {
  const brand = clean(product.brands?.split(",")[0], 80);
  const nameEn =
    clean(product.product_name_en) ??
    clean(product.product_name) ??
    clean(product.generic_name_en) ??
    clean(product.generic_name) ??
    `Product ${code}`;
  // The most specific canonical English category ("en:sweet-spreads"); user-typed tags vary.
  const tag = [...(product.categories_tags ?? [])].reverse().find((t) => /^en:[a-z0-9-]+$/.test(t));
  const liquid = isLiquid(product);
  const serving = num(product.serving_quantity);
  const pack = num(product.product_quantity);
  const portions: { label: string; grams: number }[] = [];
  if (serving && serving > 0 && serving < 5000)
    portions.push({
      label: `1 serving${product.serving_size ? ` (${clean(product.serving_size, 40)})` : ""}`,
      grams: serving,
    });
  if (pack && pack > 0 && pack < 20000 && pack !== serving)
    portions.push({
      label: `1 package${product.quantity ? ` (${clean(product.quantity, 40)})` : ""}`,
      grams: pack,
    });
  return {
    nameEn,
    nameFa: clean(product.product_name_fa),
    brand,
    category: tag ? tag.slice(3).replace(/-/g, " ") : null,
    nutrients: offNutrients(product.nutriments),
    // Drinks are labelled per 100 ml; their density is taken as water's.
    densityGPerMl: liquid ? 1 : null,
    servingGrams: serving && serving > 0 && serving < 5000 ? serving : null,
    sourceNote: `${OFF_ATTRIBUTION}. Product ${code}${liquid ? "; values per 100 ml" : ""}.`,
    portions,
  };
};

// ---- Lookup ----

// Barcodes Open Food Facts does not know, remembered for a day by this process.
const missing = new Map<string, number>();
const MISSING_MS = 24 * 3600_000;

const offRow = (code: string, dbx: DbOrTx) =>
  dbx
    .select()
    .from(foods)
    .where(and(eq(foods.source, "off"), eq(foods.sourceId, code), isNull(foods.ownerId)))
    .limit(1)
    .then((rows) => rows[0] ?? null);

export type LookupOptions = {
  config?: OffConfig;
  now?: Date;
  /** Skip the cache (the person asked for fresh data). */
  refresh?: boolean;
};

/**
 * Looks up a barcode: the person's own food with that barcode first, then the cached product,
 * then the Open Food Facts API. Never throws for network or API problems.
 */
export const lookupBarcode = async (
  userId: string,
  rawCode: string,
  options: LookupOptions = {},
  dbx: DbOrTx = defaultDb,
): Promise<BarcodeLookup> => {
  const code = normalizeBarcode(rawCode);
  if (!code || !isValidGtin(code)) return { status: "invalid", food: null };
  const config = options.config ?? offConfig();
  const now = options.now ?? new Date();

  const own = await dbx
    .select()
    .from(foods)
    .where(and(eq(foods.ownerId, userId), eq(foods.barcode, code)))
    .limit(1);
  if (own[0])
    return { status: "found", food: (await toFoodResults(own, userId, dbx))[0]!, fresh: true };

  const cached = await offRow(code, dbx);
  const ageMs = cached ? now.getTime() - cached.updatedAt.getTime() : Infinity;
  if (cached && !options.refresh && ageMs < config.cacheDays * 86_400_000)
    return { status: "found", food: (await toFoodResults([cached], userId, dbx))[0]!, fresh: true };
  const stale = async (): Promise<BarcodeLookup> =>
    cached
      ? { status: "found", food: (await toFoodResults([cached], userId, dbx))[0]!, fresh: false }
      : { status: "unavailable", food: null };

  if (!options.refresh && (missing.get(code) ?? 0) > now.getTime())
    return { status: "not_found", food: null };

  const limit = await takeRateLimit(
    `off:${userId}`,
    [{ name: "min", windowMs: 60_000, max: 15 }],
    dbx,
  );
  const global = limit.ok
    ? await takeRateLimit("off:all", [{ name: "min", windowMs: 60_000, max: 80 }], dbx)
    : limit;
  if (!global.ok) return cached ? stale() : { status: "rate_limited", food: null };

  let product: OffProduct | null = null;
  try {
    const response = await egressFetch(
      `${config.baseUrl}/api/v2/product/${code}?fields=${OFF_FIELDS}`,
      {
        headers: { "user-agent": config.userAgent, accept: "application/json" },
        signal: AbortSignal.timeout(10_000),
      },
    );
    if (response.status === 404) {
      await response.body?.cancel();
      missing.set(code, now.getTime() + MISSING_MS);
      return { status: "not_found", food: null };
    }
    if (!response.ok) {
      await response.body?.cancel();
      return stale();
    }
    const body = (await response.json()) as { status?: number; product?: OffProduct };
    if (body.status !== 1 || !body.product) {
      missing.set(code, now.getTime() + MISSING_MS);
      return { status: "not_found", food: null };
    }
    product = body.product;
  } catch {
    return stale();
  }

  const row = offFoodRow(code, product);
  const food = await dbx.transaction(async (tx) => {
    const values = {
      source: "off" as const,
      sourceId: code,
      kind: "packaged" as const,
      nameEn: row.nameEn,
      nameFa: row.nameFa,
      brand: row.brand,
      barcode: code,
      category: row.category,
      nutrients: row.nutrients,
      densityGPerMl: row.densityGPerMl,
      servingGrams: row.servingGrams,
      sourceNote: row.sourceNote,
      dataRelease: `off ${now.toISOString().slice(0, 10)}`,
      searchText: foodSearchText({ nameEn: row.nameEn, nameFa: row.nameFa, brand: row.brand }),
    };
    const [saved] = await tx
      .insert(foods)
      .values(values)
      .onConflictDoUpdate({
        target: [foods.source, foods.sourceId],
        targetWhere: sql`${foods.sourceId} is not null and ${foods.ownerId} is null`,
        set: { ...values, updatedAt: now },
      })
      .returning();
    await tx.delete(foodPortions).where(eq(foodPortions.foodId, saved!.id));
    if (row.portions.length)
      await tx.insert(foodPortions).values(
        row.portions.map((p, position) => ({
          foodId: saved!.id,
          label: p.label,
          amount: 1,
          unit: "portion",
          grams: p.grams,
          position,
        })),
      );
    return saved!;
  });
  missing.delete(code);
  return { status: "found", food: (await toFoodResults([food], userId, dbx))[0]!, fresh: true };
};

/** Forgets the not-found memory (tests). */
export const clearOffMissing = () => missing.clear();
