// The whole Kal database (docs/DESIGN.md section 10). Every table that holds a person's data
// carries user_id, and every query in lib/ filters on it. Times are timestamptz (UTC on the wire);
// the time zone a meal was eaten in is kept next to it as an IANA name.
//
// Change this file, then run `pnpm db:generate` to write the next migration into ./drizzle.
// scripts/start.mjs applies migrations when the container starts.
import { relations, sql } from "drizzle-orm";
import {
  bigserial,
  boolean,
  check,
  customType,
  date,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  real,
  serial,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

import { ACTIVITY_CATEGORIES, ACTIVITY_SOURCES, INTENSITIES } from "../lib/contracts/activities";
import type { NotFoodKind } from "../lib/contracts/analysis";
import { BODY_POSES } from "../lib/contracts/body-photos";
import { HEART_RATE_KINDS, type SleepStage } from "../lib/contracts/health-connect";
import { MEAL_SLOTS, MEAL_SOURCES, MEAL_STATUSES } from "../lib/contracts/meals";
import {
  MEDICINE_FORMS,
  type MedicineIngredient,
  type MedicineReading,
} from "../lib/contracts/medicines";
import type { NutrientMap } from "../lib/contracts/nutrients";
import { DEFAULT_MEAL_WINDOWS, type MealWindows } from "../lib/meals/time";

// ---- Column helpers ----

const tz = (name: string) => timestamp(name, { withTimezone: true, mode: "date" });
const createdAt = () => tz("created_at").notNull().defaultNow();
const updatedAt = () =>
  tz("updated_at")
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date());
const userRef = () =>
  uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" });

const tsvector = customType<{ data: string }>({
  dataType: () => "tsvector",
});

// ---- Accounts (adapted from the Lingo project) ----

export const USER_ROLES = ["admin", "member"] as const;
export type UserRole = (typeof USER_ROLES)[number];

export type NotificationPrefs = { analysisReady: boolean; questions: boolean };

// People join only with a single-use invite code. The profile fields feed the targets
// (section 6); every one of them is optional until the person fills it in.
export const users = pgTable(
  "users",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    username: text("username").notNull(),
    displayName: text("display_name").notNull(),
    passwordHash: text("password_hash").notNull(),
    role: text("role", { enum: USER_ROLES }).notNull().default("member"),
    disabled: boolean("disabled").notNull().default(false),
    failedLogins: integer("failed_logins").notNull().default(0),
    lockedUntil: tz("locked_until"),
    // Profile
    sex: text("sex", { enum: ["female", "male"] }),
    birthYear: integer("birth_year"),
    heightCm: real("height_cm"),
    weightKg: real("weight_kg"),
    activityLevel: text("activity_level", {
      enum: ["sedentary", "light", "moderate", "active", "very_active"],
    }),
    goal: text("goal", { enum: ["lose", "keep", "gain"] }),
    goalRateKgPerWeek: real("goal_rate_kg_per_week"),
    // Preferences
    timeZone: text("time_zone").notNull().default("UTC"),
    units: text("units", { enum: ["metric", "imperial"] })
      .notNull()
      .default("metric"),
    mealWindows: jsonb("meal_windows").$type<MealWindows>().notNull().default(DEFAULT_MEAL_WINDOWS),
    cuisines: text("cuisines")
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    notifications: jsonb("notifications")
      .$type<NotificationPrefs>()
      .notNull()
      .default({ analysisReady: false, questions: false }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("users_username_idx").on(t.username),
    check("users_username_lower", sql`${t.username} = lower(${t.username})`),
  ],
);

// One row per signed-in browser. The id is the SHA-256 of the cookie value, so a copy of the
// database alone cannot be used to sign in.
export const sessions = pgTable(
  "sessions",
  {
    id: text("id").primaryKey(),
    userId: userRef(),
    createdAt: createdAt(),
    expiresAt: tz("expires_at").notNull(),
  },
  (t) => [index("sessions_user_idx").on(t.userId), index("sessions_expires_idx").on(t.expiresAt)],
);

// Single-use sign-up codes; only the SHA-256 of the code is stored.
export const invites = pgTable(
  "invites",
  {
    id: serial("id").primaryKey(),
    codeHash: text("code_hash").notNull(),
    note: text("note").notNull().default(""),
    role: text("role", { enum: USER_ROLES }).notNull().default("member"),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: createdAt(),
    expiresAt: tz("expires_at").notNull(),
    usedAt: tz("used_at"),
    usedBy: uuid("used_by").references(() => users.id, { onDelete: "set null" }),
  },
  (t) => [uniqueIndex("invites_code_idx").on(t.codeHash)],
);

// Single-use codes an admin makes so one account can choose a new password.
export const resetCodes = pgTable(
  "reset_codes",
  {
    id: serial("id").primaryKey(),
    codeHash: text("code_hash").notNull(),
    userId: userRef(),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: createdAt(),
    expiresAt: tz("expires_at").notNull(),
    usedAt: tz("used_at"),
  },
  (t) => [uniqueIndex("reset_codes_code_idx").on(t.codeHash)],
);

// Fixed-window counters shared by the app and the worker (sign-in failures per address, uploads
// and AI requests per account). The key names the bucket and its window, see lib/rate-limit.ts.
export const rateLimits = pgTable(
  "rate_limits",
  {
    key: text("key").primaryKey(),
    count: integer("count").notNull().default(0),
    resetAt: tz("reset_at").notNull(),
  },
  (t) => [index("rate_limits_reset_idx").on(t.resetAt)],
);

// ---- AI (adapted from the Lingo project) ----

// Per account and provider: the encrypted API key (AES-256-GCM, lib/crypto.ts) and its last
// four characters for display.
export const aiKeys = pgTable(
  "ai_keys",
  {
    id: serial("id").primaryKey(),
    userId: userRef(),
    provider: text("provider").notNull(),
    encryptedKey: text("encrypted_key").notNull(),
    keyLastFour: text("key_last_four").notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("ai_keys_user_provider_idx").on(t.userId, t.provider)],
);

// Per account and task ("analysis", "matching"): the provider, the model (null = the provider's
// default for the task) and the reasoning effort (null = the default).
export const aiSettings = pgTable(
  "ai_settings",
  {
    userId: userRef(),
    task: text("task").notNull(),
    provider: text("provider").notNull(),
    model: text("model"),
    reasoning: text("reasoning"),
    updatedAt: updatedAt(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.task] })],
);

// Tokens used per request, so every account can see its own usage and admins see totals.
export const aiUsage = pgTable(
  "ai_usage",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    userId: userRef(),
    provider: text("provider").notNull(),
    model: text("model").notNull(),
    task: text("task").notNull(),
    mealId: uuid("meal_id"),
    inputTokens: integer("input_tokens").notNull().default(0),
    outputTokens: integer("output_tokens").notNull().default(0),
    ok: boolean("ok").notNull().default(true),
    createdAt: createdAt(),
  },
  (t) => [index("ai_usage_user_idx").on(t.userId, t.createdAt)],
);

// ---- Meals ----

export type MealQuestionRow = {
  id: string;
  text: string;
  answers: string[];
  answer?: string | null;
};

/** notFoodKind: for kind "not-food", what the analysis said it is (lib/analysis/not-food.ts). */
export type MealErrorRow = { kind: string; message: string; notFoodKind?: NotFoodKind };

/** A correction typed by the person ("it was chicken, not beef"), sent with the next analysis. */
export type MealCorrectionRow = { text: string; at: string };

// local_date is the calendar day in the meal's own time zone, so "Today" is one index lookup.
// client_id is the id the device gave the meal in its upload queue; a repeated upload of the same
// meal returns the first one instead of a copy.
export const meals = pgTable(
  "meals",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: userRef(),
    clientId: text("client_id"),
    eatenAt: tz("eaten_at").notNull(),
    tz: text("tz").notNull(),
    localDate: date("local_date", { mode: "string" }).notNull(),
    slot: text("slot", { enum: MEAL_SLOTS }).notNull(),
    // Chosen by hand (PATCH with a slot): lib/meals/classify.ts no longer changes it.
    slotLocked: boolean("slot_locked").notNull().default(false),
    title: text("title"),
    note: text("note"),
    status: text("status", { enum: MEAL_STATUSES }).notNull().default("analysing"),
    source: text("source", { enum: MEAL_SOURCES }).notNull().default("photo"),
    analysis: jsonb("analysis"),
    analysisCount: integer("analysis_count").notNull().default(0),
    questions: jsonb("questions").$type<MealQuestionRow[]>().notNull().default([]),
    corrections: jsonb("corrections").$type<MealCorrectionRow[]>().notNull().default([]),
    error: jsonb("error").$type<MealErrorRow | null>(),
    totals: jsonb("totals").$type<NutrientMap>().notNull().default({}),
    analysedAt: tz("analysed_at"),
    // A favorite since this time (null: not a favorite); logged again from the favorites at
    // favorite_used_at. "Log a favorite again" lists the most recently used first.
    favoriteAt: tz("favorite_at"),
    favoriteUsedAt: tz("favorite_used_at"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    deletedAt: tz("deleted_at"),
  },
  (t) => [
    index("meals_user_day_idx")
      .on(t.userId, t.localDate, t.eatenAt)
      .where(sql`${t.deletedAt} is null`),
    index("meals_user_eaten_idx").on(t.userId, t.eatenAt),
    uniqueIndex("meals_user_client_idx").on(t.userId, t.clientId),
    index("meals_user_favorite_idx")
      .on(t.userId, t.favoriteAt)
      .where(sql`${t.favoriteAt} is not null and ${t.deletedAt} is null`),
  ],
);

// Paths are relative to PHOTO_ROOT (lib/photos/storage.ts). user_id is repeated here so the
// photo route checks the owner without a join.
export const mealPhotos = pgTable(
  "meal_photos",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    mealId: uuid("meal_id")
      .notNull()
      .references(() => meals.id, { onDelete: "cascade" }),
    userId: userRef(),
    position: integer("position").notNull(),
    originalPath: text("original_path").notNull(),
    analysisPath: text("analysis_path").notNull(),
    thumbPath: text("thumb_path").notNull(),
    width: integer("width").notNull(),
    height: integer("height").notNull(),
    bytes: integer("bytes").notNull(),
    sha256: text("sha256").notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("meal_photos_meal_position_idx").on(t.mealId, t.position),
    index("meal_photos_user_idx").on(t.userId),
  ],
);

export const ITEM_KINDS = ["dish", "ingredient", "drink", "packaged"] as const;
export const NUTRIENT_SOURCES = [
  "food",
  "components",
  "ai_estimate",
  "recipe",
  "usual",
  "manual",
] as const;

export type ItemComponentRow = {
  name: string;
  grams: number;
  foodId?: string | null;
  nutrients?: NutrientMap;
};

export type ItemEstimateRow = {
  kcal?: number;
  protein?: number;
  carbs?: number;
  fat?: number;
  fiber?: number;
  sugar?: number;
  sodium?: number;
};

// One food on a plate. nutrients holds the amounts for this item's grams (not per 100 g), so
// totals are plain sums. edited is set as soon as the person changes the item by hand; a
// re-analysis keeps edited items unless the person asks to replace them.
export const mealItems = pgTable(
  "meal_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    mealId: uuid("meal_id")
      .notNull()
      .references(() => meals.id, { onDelete: "cascade" }),
    userId: userRef(),
    position: integer("position").notNull().default(0),
    name: text("name").notNull(),
    localName: text("local_name"),
    kind: text("kind", { enum: ITEM_KINDS }).notNull().default("dish"),
    // One emoji for the food (the model's, else lib/food/emoji.ts); null on rows from before.
    emoji: text("emoji"),
    preparation: text("preparation"),
    foodId: uuid("food_id").references(() => foods.id, { onDelete: "set null" }),
    grams: real("grams").notNull().default(0),
    ml: real("ml"),
    portionText: text("portion_text"),
    count: real("count").notNull().default(1),
    modelGrams: real("model_grams"),
    gramsLow: real("grams_low"),
    gramsHigh: real("grams_high"),
    confidence: real("confidence"),
    estimate: jsonb("estimate").$type<ItemEstimateRow | null>(),
    searchTerms: text("search_terms")
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    photoIndexes: integer("photo_indexes")
      .array()
      .notNull()
      .default(sql`'{}'::integer[]`),
    edited: boolean("edited").notNull().default(false),
    nutrients: jsonb("nutrients").$type<NutrientMap>().notNull().default({}),
    nutrientSource: text("nutrient_source", { enum: NUTRIENT_SOURCES })
      .notNull()
      .default("ai_estimate"),
    components: jsonb("components").$type<ItemComponentRow[]>().notNull().default([]),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("meal_items_meal_idx").on(t.mealId, t.position),
    index("meal_items_user_idx").on(t.userId),
    index("meal_items_food_idx").on(t.foodId),
  ],
);

// ---- Food data (section 5) ----

export const FOOD_SOURCES = [
  "fdc_foundation",
  "fdc_sr_legacy",
  "fdc_fndds",
  "off",
  "dish",
  "user",
  "mealie",
  "ai",
] as const;
export const FOOD_KINDS = ["food", "dish", "recipe", "packaged"] as const;

// Every food Kal knows: imported (FDC, Open Food Facts), seeded dishes, Mealie recipes and the
// person's own foods (owner_id set; visible only to that person). nutrients are per 100 g.
// search_text is the normalised English and Persian names and synonyms (lib/food), indexed for
// trigram and full-text search.
export const foods = pgTable(
  "foods",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    source: text("source", { enum: FOOD_SOURCES }).notNull(),
    sourceId: text("source_id"),
    ownerId: uuid("owner_id").references(() => users.id, { onDelete: "cascade" }),
    kind: text("kind", { enum: FOOD_KINDS }).notNull().default("food"),
    nameEn: text("name_en").notNull(),
    nameFa: text("name_fa"),
    synonyms: text("synonyms")
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    category: text("category"),
    brand: text("brand"),
    barcode: text("barcode"),
    nutrients: jsonb("nutrients").$type<NutrientMap>().notNull().default({}),
    densityGPerMl: real("density_g_per_ml"),
    servingGrams: real("serving_grams"),
    // Where the numbers come from, shown to the person ("recipe estimate", ODbL attribution...).
    sourceNote: text("source_note"),
    dataRelease: text("data_release"),
    searchText: text("search_text").notNull().default(""),
    searchVector: tsvector("search_vector").generatedAlwaysAs(
      sql`to_tsvector('simple', coalesce("search_text", ''))`,
    ),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("foods_source_idx")
      .on(t.source, t.sourceId)
      .where(sql`${t.sourceId} is not null and ${t.ownerId} is null`),
    uniqueIndex("foods_owner_source_idx")
      .on(t.ownerId, t.source, t.sourceId)
      .where(sql`${t.sourceId} is not null and ${t.ownerId} is not null`),
    index("foods_owner_idx").on(t.ownerId),
    index("foods_barcode_idx").on(t.barcode),
    index("foods_search_trgm_idx").using("gin", t.searchText.op("gin_trgm_ops")),
    index("foods_search_vector_idx").using("gin", t.searchVector),
  ],
);

// Household portions ("1 cup", "1 skewer") with their weight in grams.
export const foodPortions = pgTable(
  "food_portions",
  {
    id: serial("id").primaryKey(),
    foodId: uuid("food_id")
      .notNull()
      .references(() => foods.id, { onDelete: "cascade" }),
    label: text("label").notNull(),
    labelFa: text("label_fa"),
    amount: real("amount").notNull().default(1),
    unit: text("unit").notNull().default(""),
    grams: real("grams").notNull(),
    position: integer("position").notNull().default(0),
    sourceId: text("source_id"),
  },
  (t) => [index("food_portions_food_idx").on(t.foodId, t.position)],
);

// A dish is a food of kind "dish" made of components, grams per one serving.
export const dishComponents = pgTable(
  "dish_components",
  {
    id: serial("id").primaryKey(),
    dishId: uuid("dish_id")
      .notNull()
      .references(() => foods.id, { onDelete: "cascade" }),
    componentId: uuid("component_id")
      .notNull()
      .references(() => foods.id, { onDelete: "restrict" }),
    grams: real("grams").notNull(),
    position: integer("position").notNull().default(0),
    note: text("note"),
  },
  (t) => [
    index("dish_components_dish_idx").on(t.dishId, t.position),
    index("dish_components_component_idx").on(t.componentId),
  ],
);

// The nutrient catalogue (lib/contracts/nutrients.ts holds the same list for code).
export const nutrients = pgTable("nutrients", {
  code: text("code").primaryKey(),
  name: text("name").notNull(),
  unit: text("unit").notNull(),
  group: text("group").notNull(),
  displayOrder: integer("display_order").notNull(),
  fdcIds: integer("fdc_ids")
    .array()
    .notNull()
    .default(sql`'{}'::integer[]`),
  shown: boolean("shown").notNull().default(true),
});

// US Dietary Reference Intakes by sex and age band (static table, seeded by cal import-fdc).
export const driTargets = pgTable(
  "dri_targets",
  {
    id: serial("id").primaryKey(),
    sex: text("sex", { enum: ["female", "male"] }).notNull(),
    ageMin: integer("age_min").notNull(),
    ageMax: integer("age_max").notNull(),
    lifeStage: text("life_stage").notNull().default(""),
    nutrientCode: text("nutrient_code")
      .notNull()
      .references(() => nutrients.code, { onDelete: "cascade" }),
    rda: real("rda"),
    ai: real("ai"),
    ul: real("ul"),
    source: text("source").notNull(),
  },
  (t) => [
    uniqueIndex("dri_targets_band_idx").on(t.sex, t.ageMin, t.ageMax, t.lifeStage, t.nutrientCode),
  ],
);

// A person's targets. custom rows were edited by hand and stay fixed until reset; the others
// are recomputed from the profile.
export const userTargets = pgTable(
  "user_targets",
  {
    userId: userRef(),
    nutrientCode: text("nutrient_code").notNull(),
    target: real("target"),
    upper: real("upper"),
    kind: text("kind", { enum: ["goal", "min", "max", "range"] })
      .notNull()
      .default("min"),
    custom: boolean("custom").notNull().default(false),
    updatedAt: updatedAt(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.nutrientCode] })],
);

// What Kal learned from corrections: a normalised item name and the food it turned out to be,
// with typical grams. snapshot keeps the corrected item for "usual meals".
export const foodMemory = pgTable(
  "food_memory",
  {
    id: serial("id").primaryKey(),
    userId: userRef(),
    nameKey: text("name_key").notNull(),
    displayName: text("display_name").notNull(),
    foodId: uuid("food_id").references(() => foods.id, { onDelete: "cascade" }),
    typicalGrams: real("typical_grams"),
    count: integer("count").notNull().default(1),
    snapshot: jsonb("snapshot"),
    lastUsedAt: tz("last_used_at").notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("food_memory_user_name_idx").on(t.userId, t.nameKey),
    index("food_memory_user_used_idx").on(t.userId, t.lastUsedAt),
  ],
);

// ---- Medicines (lib/medicines) ----

// The person's own list, for one-tap logging. Archived medicines stay for the history.
export const medicines = pgTable(
  "medicines",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: userRef(),
    name: text("name").notNull(),
    strength: text("strength"),
    form: text("form", { enum: MEDICINE_FORMS }),
    usualAmount: real("usual_amount").notNull().default(1),
    unit: text("unit"),
    ingredients: jsonb("ingredients").$type<MedicineIngredient[]>().notNull().default([]),
    notes: text("notes"),
    archived: boolean("archived").notNull().default(false),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("medicines_user_idx").on(t.userId, t.archived)],
);

export const MEDICINE_SCAN_STATUSES = ["queued", "reading", "done", "failed"] as const;

// A photo of a box or blister and what the person's AI provider read on it (the job
// "read-medicine-label"). Paths are relative to PHOTO_ROOT, as for meal photos. Photos that never
// became part of a log are removed after a day (lib/medicines/scans.ts).
export const medicineScans = pgTable(
  "medicine_scans",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: userRef(),
    status: text("status", { enum: MEDICINE_SCAN_STATUSES }).notNull().default("queued"),
    originalPath: text("original_path").notNull(),
    analysisPath: text("analysis_path").notNull(),
    thumbPath: text("thumb_path").notNull(),
    width: integer("width").notNull(),
    height: integer("height").notNull(),
    bytes: integer("bytes").notNull(),
    sha256: text("sha256").notNull(),
    reading: jsonb("reading").$type<MedicineReading | null>(),
    error: jsonb("error").$type<MealErrorRow | null>(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("medicine_scans_user_idx").on(t.userId, t.createdAt)],
);

// What was taken and when. Name, strength and form are copied at the time, so the log stays true
// when the medicine in the list is edited or archived later.
export const medicineLogs = pgTable(
  "medicine_logs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: userRef(),
    medicineId: uuid("medicine_id").references(() => medicines.id, { onDelete: "set null" }),
    name: text("name").notNull(),
    strength: text("strength"),
    form: text("form", { enum: MEDICINE_FORMS }),
    amount: real("amount").notNull(),
    unit: text("unit"),
    takenAt: tz("taken_at").notNull(),
    tz: text("tz").notNull(),
    localDate: date("local_date", { mode: "string" }).notNull(),
    scanId: uuid("scan_id").references(() => medicineScans.id, { onDelete: "set null" }),
    createdAt: createdAt(),
  },
  (t) => [
    index("medicine_logs_user_day_idx").on(t.userId, t.localDate, t.takenAt),
    index("medicine_logs_medicine_idx").on(t.medicineId),
    index("medicine_logs_scan_idx").on(t.scanId),
  ],
);

// ---- Activities (lib/activities) ----

// Workouts, typed activities, imported exercise sessions and a day's steps (type "steps", no
// duration). Records from elsewhere carry their source and the id they have there, so a second
// import, an openGym sync or (later) Health Connect update them instead of adding copies. Manual
// records have no external id (NULLs never clash in the unique index).
export const activities = pgTable(
  "activities",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: userRef(),
    category: text("category", { enum: ACTIVITY_CATEGORIES }).notNull(),
    type: text("type").notNull(),
    title: text("title").notNull(),
    startedAt: tz("started_at").notNull(),
    tz: text("tz").notNull(),
    localDate: date("local_date", { mode: "string" }).notNull(),
    durationMin: real("duration_min"),
    distanceM: real("distance_m"),
    steps: integer("steps"),
    energyKcal: real("energy_kcal"),
    intensity: text("intensity", { enum: INTENSITIES }),
    source: text("source", { enum: ACTIVITY_SOURCES }).notNull().default("manual"),
    // The app an import or Health Connect record came from ("samsung-health").
    sourceApp: text("source_app"),
    externalId: text("external_id"),
    notes: text("notes"),
    // Extra facts from the source (openGym's exercise names), never needed to show the record.
    details: jsonb("details").$type<Record<string, unknown>>().notNull().default({}),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("activities_user_day_idx").on(t.userId, t.localDate),
    uniqueIndex("activities_user_external_idx").on(t.userId, t.source, t.externalId),
  ],
);

// ---- Body (lib/body) ----

// One value of one measure at one time: weight and body composition from a scale, tape
// measurements, custom parts (code "custom:<name>" with its own label and unit). Values are
// metric. Like activities, records from elsewhere (openGym weigh-ins, Renpho and Samsung Health
// imports, later Health Connect) carry their source and the id they have there; a manual value
// has the day and the code as its id, so logging a measure again that day replaces it.
export const bodyMeasurements = pgTable(
  "body_measurements",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: userRef(),
    code: text("code").notNull(),
    label: text("label"),
    unit: text("unit").notNull(),
    value: real("value").notNull(),
    measuredAt: tz("measured_at").notNull(),
    tz: text("tz").notNull(),
    localDate: date("local_date", { mode: "string" }).notNull(),
    source: text("source", { enum: ACTIVITY_SOURCES }).notNull().default("manual"),
    sourceApp: text("source_app"),
    externalId: text("external_id"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("body_measurements_user_code_idx").on(t.userId, t.code, t.measuredAt),
    uniqueIndex("body_measurements_user_external_idx").on(t.userId, t.source, t.externalId),
  ],
);

// The private health profile: never sent anywhere unless use_in_analysis is on (then the
// allergies and conditions go with meal analyses to the person's own AI provider). Height, birth
// year and goal stay on users, shared with Settings.
export const healthProfiles = pgTable("health_profiles", {
  userId: uuid("user_id")
    .primaryKey()
    .references(() => users.id, { onDelete: "cascade" }),
  conditions: text("conditions").notNull().default(""),
  allergies: text("allergies").notNull().default(""),
  notes: text("notes").notNull().default(""),
  useInAnalysis: boolean("use_in_analysis").notNull().default(false),
  updatedAt: updatedAt(),
});

// Guided body photos: one session per day, at most one photo per pose. Paths are relative to
// PHOTO_ROOT (<userId>/body/...); the original is kept at full size (metadata removed) for a later
// 3D step. Owner-only, never sent to an AI.
export const bodyPhotoSessions = pgTable(
  "body_photo_sessions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: userRef(),
    localDate: date("local_date", { mode: "string" }).notNull(),
    tz: text("tz").notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("body_photo_sessions_user_day_idx").on(t.userId, t.localDate)],
);

export const bodyPhotos = pgTable(
  "body_photos",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    sessionId: uuid("session_id")
      .notNull()
      .references(() => bodyPhotoSessions.id, { onDelete: "cascade" }),
    userId: userRef(),
    pose: text("pose", { enum: BODY_POSES }).notNull(),
    originalPath: text("original_path").notNull(),
    viewPath: text("view_path").notNull(),
    thumbPath: text("thumb_path").notNull(),
    width: integer("width").notNull(),
    height: integer("height").notNull(),
    bytes: integer("bytes").notNull(),
    sha256: text("sha256").notNull(),
    takenAt: tz("taken_at").notNull(),
    facing: text("facing", { enum: ["user", "environment"] }),
    source: text("source", { enum: ["camera", "gallery"] })
      .notNull()
      .default("camera"),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("body_photos_session_pose_idx").on(t.sessionId, t.pose),
    index("body_photos_user_idx").on(t.userId),
  ],
);

// Move's badges, stored the first time they are earned (lib/move/service.ts), so a badge stays
// when older data is removed later. code is a BadgeCode of lib/contracts/move.ts.
export const userBadges = pgTable(
  "user_badges",
  {
    userId: userRef(),
    code: text("code").notNull(),
    earnedOn: date("earned_on", { mode: "string" }).notNull(),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.code] })],
);

// ---- Heart rate and sleep from Health Connect (lib/health-connect) ----

// Kept for later charts; nothing shows them yet except the counts on "Kal for Android". No raw
// samples: one resting value per day (kind "resting", external id "resting:<day>") and the average
// and highest of each workout (kind "workout", the exercise session's Health Connect id).
export const heartRates = pgTable(
  "heart_rates",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: userRef(),
    kind: text("kind", { enum: HEART_RATE_KINDS }).notNull(),
    localDate: date("local_date", { mode: "string" }).notNull(),
    tz: text("tz").notNull(),
    startedAt: tz("started_at").notNull(),
    endedAt: tz("ended_at"),
    // Beats per minute: the day's resting rate, or the workout's average.
    bpm: real("bpm").notNull(),
    maxBpm: real("max_bpm"),
    source: text("source", { enum: ACTIVITY_SOURCES }).notNull().default("health_connect"),
    sourceApp: text("source_app"),
    externalId: text("external_id").notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("heart_rates_user_day_idx").on(t.userId, t.localDate),
    uniqueIndex("heart_rates_user_external_idx").on(t.userId, t.source, t.externalId),
  ],
);

// Sleep sessions with the minutes of each stage (SLEEP_STAGES of lib/contracts/health-connect.ts).
// local_date is the day the person woke up.
export const sleepSessions = pgTable(
  "sleep_sessions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: userRef(),
    startedAt: tz("started_at").notNull(),
    endedAt: tz("ended_at").notNull(),
    tz: text("tz").notNull(),
    localDate: date("local_date", { mode: "string" }).notNull(),
    durationMin: real("duration_min").notNull(),
    stages: jsonb("stages").$type<Partial<Record<SleepStage, number>>>().notNull().default({}),
    title: text("title"),
    source: text("source", { enum: ACTIVITY_SOURCES }).notNull().default("health_connect"),
    sourceApp: text("source_app"),
    externalId: text("external_id").notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("sleep_sessions_user_day_idx").on(t.userId, t.localDate),
    uniqueIndex("sleep_sessions_user_external_idx").on(t.userId, t.source, t.externalId),
  ],
);

// ---- Linked phones (lib/devices) ----

// Phones linked through the Kal Android app. The phone keeps a long-lived token; only its SHA-256
// is stored. Unlinking sets revoked_at (the phone's next call gets a 401); the row stays so the
// export can say when it was linked. `sends` lists what it has sent so far (SEND_KINDS of
// lib/contracts/devices.ts).
export const devices = pgTable(
  "devices",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: userRef(),
    name: text("name").notNull(),
    platform: text("platform").notNull().default("android"),
    appVersion: text("app_version"),
    tokenHash: text("token_hash").notNull(),
    sends: text("sends")
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    createdAt: createdAt(),
    lastSeenAt: tz("last_seen_at"),
    lastSyncAt: tz("last_sync_at"),
    revokedAt: tz("revoked_at"),
  },
  (t) => [uniqueIndex("devices_token_idx").on(t.tokenHash), index("devices_user_idx").on(t.userId)],
);

// One-time codes that link a phone: made by the signed-in page, traded once by the phone for a
// device token within a few minutes. Only the SHA-256 of the code is stored.
export const deviceLinkCodes = pgTable(
  "device_link_codes",
  {
    codeHash: text("code_hash").primaryKey(),
    userId: userRef(),
    createdAt: createdAt(),
    expiresAt: tz("expires_at").notNull(),
    usedAt: tz("used_at"),
  },
  (t) => [index("device_link_codes_user_idx").on(t.userId)],
);

// ---- Integrations and notifications ----

export const integrations = pgTable(
  "integrations",
  {
    id: serial("id").primaryKey(),
    userId: userRef(),
    kind: text("kind", { enum: ["mealie", "opengym"] }).notNull(),
    encryptedCredential: text("encrypted_credential"),
    settings: jsonb("settings").notNull().default({}),
    status: text("status", { enum: ["ok", "error", "disconnected"] })
      .notNull()
      .default("disconnected"),
    statusMessage: text("status_message"),
    lastSyncAt: tz("last_sync_at"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("integrations_user_kind_idx").on(t.userId, t.kind)],
);

export const pushSubscriptions = pgTable(
  "push_subscriptions",
  {
    id: serial("id").primaryKey(),
    userId: userRef(),
    endpoint: text("endpoint").notNull(),
    p256dh: text("p256dh").notNull(),
    auth: text("auth").notNull(),
    userAgent: text("user_agent"),
    failures: integer("failures").notNull().default(0),
    lastSuccessAt: tz("last_success_at"),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("push_subscriptions_endpoint_idx").on(t.endpoint),
    index("push_subscriptions_user_idx").on(t.userId),
  ],
);

// ---- Background jobs (lib/queue) ----

export const JOB_STATUSES = ["queued", "running", "done", "failed"] as const;

export const jobs = pgTable(
  "jobs",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    kind: text("kind").notNull(),
    payload: jsonb("payload").notNull().default({}),
    userId: uuid("user_id").references(() => users.id, { onDelete: "cascade" }),
    status: text("status", { enum: JOB_STATUSES }).notNull().default("queued"),
    attempts: integer("attempts").notNull().default(0),
    maxAttempts: integer("max_attempts").notNull().default(5),
    runAfter: tz("run_after").notNull().defaultNow(),
    dedupeKey: text("dedupe_key"),
    lockedAt: tz("locked_at"),
    lockedBy: text("locked_by"),
    lastError: text("last_error"),
    result: jsonb("result"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    finishedAt: tz("finished_at"),
  },
  (t) => [
    index("jobs_queue_idx")
      .on(t.runAfter, t.id)
      .where(sql`${t.status} = 'queued'`),
    index("jobs_running_idx")
      .on(t.lockedAt)
      .where(sql`${t.status} = 'running'`),
    uniqueIndex("jobs_dedupe_idx")
      .on(t.kind, t.dedupeKey)
      .where(sql`${t.dedupeKey} is not null and ${t.status} = 'queued'`),
    index("jobs_user_idx").on(t.userId),
  ],
);

// Who did what: sign-ins, invites, resets, key changes, data export and deletion.
export const auditLog = pgTable(
  "audit_log",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
    action: text("action").notNull(),
    targetType: text("target_type"),
    targetId: text("target_id"),
    details: jsonb("details").notNull().default({}),
    createdAt: createdAt(),
  },
  (t) => [
    index("audit_log_created_idx").on(t.createdAt),
    index("audit_log_user_idx").on(t.userId, t.createdAt),
  ],
);

// ---- Relations (for db.query) ----

export const usersRelations = relations(users, ({ many }) => ({
  sessions: many(sessions),
  meals: many(meals),
}));

export const sessionsRelations = relations(sessions, ({ one }) => ({
  user: one(users, { fields: [sessions.userId], references: [users.id] }),
}));

export const mealsRelations = relations(meals, ({ one, many }) => ({
  user: one(users, { fields: [meals.userId], references: [users.id] }),
  photos: many(mealPhotos),
  items: many(mealItems),
}));

export const mealPhotosRelations = relations(mealPhotos, ({ one }) => ({
  meal: one(meals, { fields: [mealPhotos.mealId], references: [meals.id] }),
}));

export const mealItemsRelations = relations(mealItems, ({ one }) => ({
  meal: one(meals, { fields: [mealItems.mealId], references: [meals.id] }),
  food: one(foods, { fields: [mealItems.foodId], references: [foods.id] }),
}));

export const foodsRelations = relations(foods, ({ many }) => ({
  portions: many(foodPortions),
  components: many(dishComponents, { relationName: "dish" }),
}));

export const foodPortionsRelations = relations(foodPortions, ({ one }) => ({
  food: one(foods, { fields: [foodPortions.foodId], references: [foods.id] }),
}));

export const dishComponentsRelations = relations(dishComponents, ({ one }) => ({
  dish: one(foods, {
    fields: [dishComponents.dishId],
    references: [foods.id],
    relationName: "dish",
  }),
  component: one(foods, { fields: [dishComponents.componentId], references: [foods.id] }),
}));
