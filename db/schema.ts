// The whole Cal database (docs/DESIGN.md section 10). Every table that holds a person's data
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

import { MEAL_SLOTS, MEAL_STATUSES } from "../lib/contracts/meals";
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

export const MEAL_SOURCES = ["photo", "manual", "mealie", "duplicate"] as const;

export type MealQuestionRow = {
  id: string;
  text: string;
  answers: string[];
  answer?: string | null;
};

export type MealErrorRow = { kind: string; message: string };

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

// Every food Cal knows: imported (FDC, Open Food Facts), seeded dishes, Mealie recipes and the
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

// What Cal learned from corrections: a normalised item name and the food it turned out to be,
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
