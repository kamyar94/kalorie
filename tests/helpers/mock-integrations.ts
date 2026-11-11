// Stand-ins for the services the integrations talk to, for integration and end-to-end tests:
//   /mealie/...   Mealie's API (recorded shapes: mealie-recipes/mealie, branch mealie-next,
//                 schema/meal_plan/new_meal.py, schema/recipe/*.py, routes/households/
//                 controller_mealplan.py, routes/recipe/recipe_crud_routes.py; camelCase JSON)
//   /opengym/...  openGym's API (api/openapi.yaml 1.4.3: /api/pair/redeem, /api/me, /api/data)
//   /push/...     a Web Push service: records the encrypted messages, answers 201 or 410
//   /google/...   Gemini generateContent for the photo analysis in end-to-end runs
//   /off/...      Open Food Facts: knows no product
//   /__control/   JSON control for tests that run in another process (Playwright)
//
// Self-contained on purpose (only node: modules): Vitest imports it, and tests/e2e/serve.mjs
// loads it with Node's type stripping.
import crypto from "node:crypto";
import http from "node:http";
import type { AddressInfo } from "node:net";

// ---------------------------------------------------------------- shared

type Reply = { status: number; json?: unknown; body?: Buffer; headers?: Record<string, string> };

export type Recorded = {
  service: "mealie" | "opengym" | "push" | "google" | "off";
  method: string;
  path: string;
  authorization: string | null;
  body: unknown;
};

const ok = (json: unknown, status = 200): Reply => ({ status, json });
const notFound = (detail = "Not found"): Reply => ({ status: 404, json: { detail } });

// ---------------------------------------------------------------- Mealie

export const MEALIE_TOKEN = "mealie-test-token-0123456789";

export type MealieNutritionShape = Record<string, string | null>;

export type MealieRecipeShape = {
  id: string;
  slug: string;
  name: string;
  recipeServings: number;
  recipeYieldQuantity: number;
  recipeYield: string | null;
  nutrition: MealieNutritionShape | null;
  recipeIngredient: unknown[];
  updatedAt: string;
  dateUpdated: string;
};

export const EMPTY_NUTRITION: MealieNutritionShape = {
  calories: null,
  carbohydrateContent: null,
  cholesterolContent: null,
  fatContent: null,
  fiberContent: null,
  proteinContent: null,
  saturatedFatContent: null,
  sodiumContent: null,
  sugarContent: null,
  transFatContent: null,
  unsaturatedFatContent: null,
};

const GROUP_ID = "0b5a6a3e-1b1c-4d1e-9a8a-000000000001";
const HOUSEHOLD_ID = "0b5a6a3e-1b1c-4d1e-9a8a-000000000002";
const MEALIE_USER_ID = "0b5a6a3e-1b1c-4d1e-9a8a-000000000003";

const parsedIngredient = (quantity: number, unit: string | null, food: string, note = "") => ({
  quantity,
  unit: unit
    ? {
        id: crypto.randomUUID(),
        name: unit,
        pluralName: null,
        abbreviation: "",
        useAbbreviation: false,
      }
    : null,
  food: { id: crypto.randomUUID(), name: food, pluralName: null },
  note,
  display: `${quantity} ${unit ?? ""} ${food}`.replace(/\s+/g, " ").trim(),
  title: null,
  originalText: null,
  referenceId: crypto.randomUUID(),
});

const textIngredient = (text: string) => ({
  quantity: 0,
  unit: null,
  food: null,
  note: text,
  display: text,
  title: null,
  originalText: text,
  referenceId: crypto.randomUUID(),
});

let recipeCounter = 0;
export const mealieRecipe = (
  name: string,
  values: Partial<MealieRecipeShape> & { kcal?: number; protein?: number } = {},
): MealieRecipeShape => {
  recipeCounter += 1;
  const { kcal, protein, ...rest } = values;
  const nutrition =
    kcal !== undefined
      ? {
          ...EMPTY_NUTRITION,
          calories: String(kcal),
          proteinContent: String(protein ?? 0),
          carbohydrateContent: "40",
          fatContent: "15",
        }
      : { ...EMPTY_NUTRITION };
  const stamp = "2026-10-01T12:00:00Z";
  return {
    id: `7f1c0000-0000-4000-8000-${String(recipeCounter).padStart(12, "0")}`,
    slug: name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/(^-|-$)/g, ""),
    name,
    recipeServings: 4,
    recipeYieldQuantity: 0,
    recipeYield: "4 servings",
    nutrition,
    recipeIngredient: [],
    updatedAt: stamp,
    dateUpdated: stamp,
    ...rest,
  };
};

/** The recipes the mock starts with: some with nutrition, one without (lentil soup). */
export const defaultMealieRecipes = () => [
  mealieRecipe("Chicken and rice", {
    kcal: 650,
    protein: 45,
    nutrition: {
      ...EMPTY_NUTRITION,
      calories: "650 kcal",
      proteinContent: "45 g",
      carbohydrateContent: "70 g",
      fatContent: "18 g",
      sodiumContent: "800 mg",
      fiberContent: "3",
    },
    recipeIngredient: [
      parsedIngredient(600, "gram", "chicken breast roasted"),
      parsedIngredient(4, "cup", "white rice cooked"),
    ],
  }),
  mealieRecipe("Lentil soup", {
    recipeIngredient: [
      // A section title sits on the first ingredient of its section, as in Mealie.
      { ...parsedIngredient(800, "gram", "lentils cooked"), title: "Soup" },
      parsedIngredient(2, "tablespoon", "olive oil"),
      parsedIngredient(1, "teaspoon", "salt"),
      textIngredient("2 cloves garlic, crushed"),
      textIngredient("1 1/2 cups spinach, raw"),
    ],
  }),
  mealieRecipe("Greek yogurt bowl", { kcal: 350, protein: 25 }),
  mealieRecipe("Joojeh kabab plate", { kcal: 700, protein: 50 }),
  mealieRecipe("Salmon salad", { kcal: 520, protein: 38 }),
  mealieRecipe("Vegetable omelette", { kcal: 300, protein: 20 }),
  mealieRecipe("Pasta bolognese", { kcal: 800, protein: 35 }),
  mealieRecipe("Fruit and nuts", { kcal: 180, protein: 5 }),
];

export type MealiePlanShape = {
  id: number;
  date: string;
  endDate: string | null;
  entryType: string;
  title: string;
  text: string;
  recipeId: string | null;
  recipeScale: number;
  groupId: string;
  userId: string;
  householdId: string;
  recipe: Omit<MealieRecipeShape, "nutrition" | "recipeIngredient"> | null;
  updatedAt: string;
};

const summaryOf = (recipe: MealieRecipeShape) => {
  const { nutrition: _n, recipeIngredient: _i, ...summary } = recipe;
  return {
    ...summary,
    userId: MEALIE_USER_ID,
    householdId: HOUSEHOLD_ID,
    groupId: GROUP_ID,
    image: null,
    description: "",
    recipeCategory: [],
    tags: [],
    tools: [],
    rating: null,
    orgURL: null,
    dateAdded: "2026-10-01",
    createdAt: recipe.updatedAt,
  };
};

const page = <T>(items: T[], pageNo: number, perPage: number) => {
  const total = items.length;
  const size = perPage > 0 ? perPage : total || 1;
  const totalPages = Math.max(1, Math.ceil(total / size));
  return {
    page: pageNo,
    per_page: size,
    perPage: size,
    total,
    totalPages,
    total_pages: totalPages,
    items: items.slice((pageNo - 1) * size, pageNo * size),
    next: pageNo < totalPages ? `/page=${pageNo + 1}` : null,
    previous: pageNo > 1 ? `/page=${pageNo - 1}` : null,
  };
};

export type MealieMock = {
  tokens: Set<string>;
  recipes: Map<string, MealieRecipeShape>;
  plans: MealiePlanShape[];
  /** Mealie's own "today" (its server's date). */
  today: string;
  /** Adds a plan entry for a recipe (by slug) and returns it. */
  plan: (date: string, entryType: string, slug: string | null, title?: string) => MealiePlanShape;
  reset: () => void;
};

const createMealieMock = (): MealieMock => {
  let nextPlanId = 1;
  const mock: MealieMock = {
    tokens: new Set([MEALIE_TOKEN]),
    recipes: new Map(),
    plans: [],
    today: new Date().toISOString().slice(0, 10),
    plan: (date, entryType, slug, title = "") => {
      const recipe = slug ? (mock.recipes.get(slug) ?? null) : null;
      const entry: MealiePlanShape = {
        id: nextPlanId++,
        date,
        endDate: null,
        entryType,
        title,
        text: "",
        recipeId: recipe?.id ?? null,
        recipeScale: 1,
        groupId: GROUP_ID,
        userId: MEALIE_USER_ID,
        householdId: HOUSEHOLD_ID,
        recipe: recipe ? summaryOf(recipe) : null,
        updatedAt: new Date().toISOString(),
      };
      mock.plans.push(entry);
      return entry;
    },
    reset: () => {
      mock.tokens = new Set([MEALIE_TOKEN]);
      mock.recipes = new Map(defaultMealieRecipes().map((r) => [r.slug, r]));
      mock.plans = [];
      mock.today = new Date().toISOString().slice(0, 10);
      nextPlanId = 1;
    },
  };
  mock.reset();
  return mock;
};

const findRecipe = (mock: MealieMock, slugOrId: string) =>
  mock.recipes.get(slugOrId) ?? [...mock.recipes.values()].find((r) => r.id === slugOrId) ?? null;

const handleMealie = (
  mock: MealieMock,
  method: string,
  url: URL,
  auth: string | null,
  body: unknown,
): Reply => {
  const token = auth?.startsWith("Bearer ") ? auth.slice(7) : null;
  if (!token || !mock.tokens.has(token))
    return { status: 401, json: { detail: "Not authenticated" } };
  const path = url.pathname;
  const q = url.searchParams;
  if (method === "GET" && path === "/api/users/self")
    return ok({
      id: MEALIE_USER_ID,
      username: "household-cook",
      fullName: "Household Cook",
      email: "cook@example.org",
      admin: false,
      group: "Home",
      household: "Family",
      groupId: GROUP_ID,
      householdId: HOUSEHOLD_ID,
    });
  if (method === "GET" && path === "/api/households/mealplans/today")
    return ok(mock.plans.filter((p) => p.date === mock.today));
  if (method === "GET" && path === "/api/households/mealplans") {
    const start = q.get("start_date");
    const end = q.get("end_date");
    const items = mock.plans.filter((p) => (!start || p.date >= start) && (!end || p.date <= end));
    return ok(page(items, Number(q.get("page") ?? 1), Number(q.get("perPage") ?? 50)));
  }
  const planMatch = /^\/api\/households\/mealplans\/(\d+)$/.exec(path);
  if (method === "GET" && planMatch) {
    const entry = mock.plans.find((p) => p.id === Number(planMatch[1]));
    return entry ? ok(entry) : notFound("Meal plan entry not found");
  }
  if (method === "POST" && path === "/api/households/mealplans") {
    const input = (body ?? {}) as Record<string, unknown>;
    const types = ["breakfast", "lunch", "dinner", "side", "snack", "drink", "dessert"];
    if (typeof input.date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(input.date))
      return { status: 422, json: { detail: [{ loc: ["body", "date"], msg: "invalid date" }] } };
    if (input.entryType !== undefined && !types.includes(String(input.entryType)))
      return { status: 422, json: { detail: [{ loc: ["body", "entryType"], msg: "invalid" }] } };
    const recipe = typeof input.recipeId === "string" ? findRecipe(mock, input.recipeId) : null;
    if (!recipe && !(typeof input.title === "string" && input.title))
      return { status: 422, json: { detail: "Recipe ID or Title is required" } };
    const entry = mock.plan(
      input.date,
      String(input.entryType ?? "breakfast"),
      recipe?.slug ?? null,
      String(input.title ?? ""),
    );
    return ok(entry, 201);
  }
  if (method === "GET" && path === "/api/recipes") {
    const search = (q.get("search") ?? "").toLowerCase();
    const items = [...mock.recipes.values()]
      .filter((r) => !search || r.name.toLowerCase().includes(search))
      .sort((a, b) => a.name.localeCompare(b.name))
      .map(summaryOf);
    return ok(page(items, Number(q.get("page") ?? 1), Number(q.get("perPage") ?? 50)));
  }
  const recipeMatch = /^\/api\/recipes\/([^/]+)$/.exec(path);
  if (recipeMatch) {
    const recipe = findRecipe(mock, decodeURIComponent(recipeMatch[1]!));
    if (!recipe) return notFound("Recipe not found");
    if (method === "GET")
      return ok({
        ...summaryOf(recipe),
        nutrition: recipe.nutrition,
        recipeIngredient: recipe.recipeIngredient,
      });
    if (method === "PATCH") {
      const input = (body ?? {}) as { nutrition?: MealieNutritionShape };
      if (input.nutrition)
        recipe.nutrition = { ...EMPTY_NUTRITION, ...recipe.nutrition, ...input.nutrition };
      recipe.updatedAt = recipe.dateUpdated = new Date().toISOString();
      return ok({
        ...summaryOf(recipe),
        nutrition: recipe.nutrition,
        recipeIngredient: recipe.recipeIngredient,
      });
    }
  }
  return notFound();
};

// ---------------------------------------------------------------- openGym

export type OpenGymMock = {
  /** Valid pairing codes and their expiry (ms). */
  codes: Map<string, number>;
  tokens: Set<string>;
  /** The account state GET /api/data returns. */
  state: Record<string, unknown> | null;
  rev: number;
  /** The next /api/me answers with this fresh token (then it is cleared). */
  renewWith: string | null;
  /** Makes a pairing code valid for 5 minutes and returns it. */
  newCode: () => string;
  reset: () => void;
};

const PAIR_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

/** A day n days before today (UTC), YYYY-MM-DD. */
export const daysAgo = (n: number, from = new Date()) => {
  const d = new Date(from);
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
};

/** A representative openGym state (kg) with weigh-ins and two workouts, one of them today. */
export const defaultOpenGymState = (now = new Date()) => {
  const today = now.toISOString().slice(0, 10);
  const startToday = Date.parse(`${today}T07:00:00Z`);
  return {
    _ts: now.getTime(),
    _rev: 3,
    _wid: "a1b2c3d4e5f60718",
    unit: "kg",
    lang: "en",
    bodyweight: [
      { d: daysAgo(20, now), w: 81.2, t: now.getTime() - 20 * 86_400_000 },
      { d: daysAgo(10, now), w: 80.4, t: now.getTime() - 10 * 86_400_000 },
      { d: daysAgo(1, now), w: 79.6, t: now.getTime() - 86_400_000 },
    ],
    workouts: [
      {
        id: "w-old",
        d: daysAgo(2, now),
        start: startToday - 2 * 86_400_000,
        end: startToday - 2 * 86_400_000 + 45 * 60_000,
        routineId: "r1",
        name: "Upper body",
        bw: 80,
        vol: 5200,
        prs: [],
        entries: [{ id: "bench-press", topW: 70, sets: [{ w: 70, r: 8, done: true }] }],
        media: [],
      },
      {
        id: "w-today",
        d: today,
        start: startToday,
        end: startToday + 60 * 60_000,
        routineId: "r2",
        name: "Legs",
        bw: 79.6,
        vol: 8100,
        prs: ["squat"],
        entries: [
          { id: "squat", topW: 100, sets: [{ w: 100, r: 5, done: true }] },
          { id: "my-sled", topW: null, sets: [] },
        ],
        media: [],
      },
    ],
    routines: [],
    customEx: [{ id: "my-sled", name: "Sled push" }],
    deleted: { bodyweight: {} },
  };
};

const createOpenGymMock = (): OpenGymMock => {
  const mock: OpenGymMock = {
    codes: new Map(),
    tokens: new Set(),
    state: null,
    rev: 0,
    renewWith: null,
    newCode: () => {
      const code = Array.from(
        { length: 8 },
        () => PAIR_ALPHABET[crypto.randomInt(PAIR_ALPHABET.length)],
      ).join("");
      mock.codes.set(code, Date.now() + 5 * 60_000);
      return code;
    },
    reset: () => {
      mock.codes = new Map();
      mock.tokens = new Set();
      mock.state = defaultOpenGymState();
      mock.rev = 3;
      mock.renewWith = null;
    },
  };
  mock.reset();
  return mock;
};

const OPENGYM_USER = { id: "Zk3q9XyPbA2LmN0v", name: "Lifter", admin: false };

const handleOpenGym = (
  mock: OpenGymMock,
  method: string,
  url: URL,
  auth: string | null,
  body: unknown,
): Reply => {
  const path = url.pathname;
  if (method === "POST" && path === "/api/pair/redeem") {
    const code = String((body as { code?: unknown } | null)?.code ?? "").toUpperCase();
    const expires = mock.codes.get(code);
    mock.codes.delete(code);
    if (!expires || expires < Date.now())
      return { status: 400, json: { error: "invalid or expired code", code: "pair-invalid" } };
    const token = `${crypto.randomBytes(18).toString("base64url")}.${crypto.randomBytes(16).toString("hex")}`;
    mock.tokens.add(token);
    return ok({ token, user: OPENGYM_USER });
  }
  const token = auth?.startsWith("Bearer ") ? auth.slice(7) : null;
  if (!token || !mock.tokens.has(token)) return { status: 401, json: { error: "unauthorized" } };
  if (method === "GET" && path === "/api/me") {
    if (mock.renewWith) {
      const fresh = mock.renewWith;
      mock.renewWith = null;
      mock.tokens.add(fresh);
      return ok({ user: OPENGYM_USER, token: fresh });
    }
    return ok({ user: OPENGYM_USER });
  }
  if (method === "GET" && path === "/api/data")
    return ok({ state: mock.state, rev: mock.state ? mock.rev : 0 });
  if (method === "PUT" && path === "/api/data")
    return { status: 409, json: { error: "conflict", rev: mock.rev, state: mock.state } };
  return { status: 404, json: { error: "not found" } };
};

// ---------------------------------------------------------------- Web Push service

export type PushRecord = { id: string; headers: Record<string, string>; body: Buffer };

export type PushMock = {
  received: PushRecord[];
  /** Endpoint ids that answer 410 Gone (the browser dropped the subscription). */
  gone: Set<string>;
  /** A subscriber: an endpoint here and browser-side keys to decrypt what it receives. */
  subscriber: (id?: string) => PushSubscriber;
  reset: () => void;
};

export type PushSubscriber = {
  id: string;
  endpoint: string;
  keys: { p256dh: string; auth: string };
  /** The browser's private key (base64url), to decrypt. */
  privateKey: string;
};

/** Decrypts an aes128gcm Web Push body (RFC 8291) with the subscriber's keys. */
export const decryptPush = (
  body: Buffer,
  subscriber: Pick<PushSubscriber, "keys" | "privateKey">,
) => {
  const salt = body.subarray(0, 16);
  const idLength = body.readUInt8(20);
  const asPublic = body.subarray(21, 21 + idLength);
  const ciphertext = body.subarray(21 + idLength);
  const ecdh = crypto.createECDH("prime256v1");
  ecdh.setPrivateKey(Buffer.from(subscriber.privateKey, "base64url"));
  const uaPublic = Buffer.from(subscriber.keys.p256dh, "base64url");
  const shared = ecdh.computeSecret(asPublic);
  const info = Buffer.concat([Buffer.from("WebPush: info\0"), uaPublic, asPublic]);
  const ikm = Buffer.from(
    crypto.hkdfSync("sha256", shared, Buffer.from(subscriber.keys.auth, "base64url"), info, 32),
  );
  const cek = Buffer.from(
    crypto.hkdfSync("sha256", ikm, salt, Buffer.from("Content-Encoding: aes128gcm\0"), 16),
  );
  const nonce = Buffer.from(
    crypto.hkdfSync("sha256", ikm, salt, Buffer.from("Content-Encoding: nonce\0"), 12),
  );
  const decipher = crypto.createDecipheriv("aes-128-gcm", cek, nonce);
  decipher.setAuthTag(ciphertext.subarray(ciphertext.length - 16));
  const padded = Buffer.concat([
    decipher.update(ciphertext.subarray(0, ciphertext.length - 16)),
    decipher.final(),
  ]);
  let end = padded.length - 1;
  while (end >= 0 && padded[end] === 0) end -= 1;
  if (padded[end] !== 2) throw new Error("Bad padding delimiter.");
  return JSON.parse(padded.subarray(0, end).toString("utf8")) as Record<string, unknown>;
};

/** Checks the VAPID header's JWT signature against its own k= key and returns its claims. */
export const verifyVapid = (authorization: string) => {
  const match = /^vapid t=([^,]+),\s*k=(.+)$/.exec(authorization);
  if (!match) return null;
  const [header, claims, signature] = match[1]!.split(".");
  const pub = Buffer.from(match[2]!, "base64url");
  const key = crypto.createPublicKey({
    key: {
      kty: "EC",
      crv: "P-256",
      x: pub.subarray(1, 33).toString("base64url"),
      y: pub.subarray(33, 65).toString("base64url"),
    },
    format: "jwk",
  });
  const valid = crypto.verify(
    "sha256",
    Buffer.from(`${header}.${claims}`),
    { key, dsaEncoding: "ieee-p1363" },
    Buffer.from(signature!, "base64url"),
  );
  return valid
    ? (JSON.parse(Buffer.from(claims!, "base64url").toString()) as Record<string, unknown>)
    : null;
};

// ---------------------------------------------------------------- Google (analysis, e2e only)

export type GoogleMock = {
  /** Analysis replies (the model's JSON) used in order; the default meal when empty. */
  analyses: unknown[];
  reset: () => void;
};

/** What the mock reads on any medicine label (lib/medicines/label.ts MEDICINE_LABEL_SCHEMA). */
export const E2E_MEDICINE = {
  is_medicine: true,
  name: "Ibuprofen",
  strength: "200 mg",
  form: "tablet",
  active_ingredients: [{ name: "Ibuprofen", strength: "200 mg" }],
};

/** A plate whose items match the FoodData Central fixture foods and the seeded doogh. */
export const E2E_MEAL = {
  is_food: true,
  title: "Chicken with rice",
  cuisine: "Persian",
  overall_confidence: 0.8,
  questions: [],
  items: [
    {
      name: "Rice, white, cooked",
      local_name: "",
      kind: "dish",
      preparation: "steamed",
      grams: 200,
      ml: 0,
      grams_low: 160,
      grams_high: 250,
      portion_text: "1 cup",
      confidence: 0.8,
      photo_indexes: [0],
      search_terms: ["white rice cooked"],
      matches_usual: "",
      matches_planned: "",
      same_as_item: "",
      components: [],
      label: [],
      estimate: { kcal: 260, protein: 5, carbs: 56, fat: 1, fiber: 1, sugar: 0, sodium: 2 },
    },
    {
      name: "Chicken breast, roasted",
      local_name: "",
      kind: "ingredient",
      preparation: "roasted",
      grams: 150,
      ml: 0,
      grams_low: 120,
      grams_high: 190,
      portion_text: "1 breast",
      confidence: 0.8,
      photo_indexes: [0],
      search_terms: ["chicken breast roasted"],
      matches_usual: "",
      matches_planned: "",
      same_as_item: "",
      components: [],
      label: [],
      estimate: { kcal: 250, protein: 46, carbs: 0, fat: 5, fiber: 0, sugar: 0, sodium: 110 },
    },
  ],
};

const googleReply = (value: unknown): Reply =>
  ok({
    candidates: [
      {
        content: { parts: [{ text: JSON.stringify(value) }], role: "model" },
        finishReason: "STOP",
        index: 0,
      },
    ],
    usageMetadata: { promptTokenCount: 900, candidatesTokenCount: 300, totalTokenCount: 1200 },
    modelVersion: "mock",
    responseId: "mock",
  });

/** Picks, per numbered food in a matching prompt, the candidate named like it (or none). */
export const pickMatches = (prompt: string) => {
  const entries: { number: number; name: string; candidates: { ref: string; name: string }[] }[] =
    [];
  for (const line of prompt.split("\n")) {
    const entry = /^(\d+)\. (.+?)(?: \(.*\))? - /.exec(line);
    if (entry) {
      entries.push({ number: Number(entry[1]), name: entry[2]!, candidates: [] });
      continue;
    }
    const candidate = /^\s+(c\d+): (.+?)(?: \(|$| \[)/.exec(line);
    if (candidate && entries.length)
      entries.at(-1)!.candidates.push({ ref: candidate[1]!, name: candidate[2]! });
  }
  return {
    matches: entries.map((e) => {
      const first = e.name.split(/[ ,]/)[0]!.toLowerCase();
      const found =
        e.candidates.find((c) => c.name.toLowerCase() === e.name.toLowerCase()) ??
        e.candidates.find((c) => c.name.toLowerCase().startsWith(first));
      return { entry: e.number, candidate: found?.ref ?? "none" };
    }),
  };
};

const handleGoogle = (mock: GoogleMock, body: unknown): Reply => {
  const contents =
    (body as { contents?: { parts?: { text?: string; inlineData?: unknown }[] }[] })?.contents ??
    [];
  const parts = contents.at(-1)?.parts ?? [];
  // The analysis asks for the meal schema (is_food); a text meal sends no image.
  const schema = JSON.stringify(
    (body as { generationConfig?: { responseJsonSchema?: unknown } })?.generationConfig
      ?.responseJsonSchema ?? {},
  );
  // A medicine label asks for the label schema (is_medicine) with its photo.
  if (schema.includes('"is_medicine"')) return googleReply(E2E_MEDICINE);
  if (parts.some((p) => p.inlineData) || schema.includes('"is_food"'))
    return googleReply(mock.analyses.shift() ?? E2E_MEAL);
  const prompt = parts.find((p) => typeof p.text === "string")?.text ?? "";
  return googleReply(pickMatches(prompt));
};

// ---------------------------------------------------------------- server

export type IntegrationMocks = {
  url: string;
  mealie: MealieMock;
  opengym: OpenGymMock;
  push: PushMock;
  google: GoogleMock;
  requests: Recorded[];
  /** Environment for the app and worker: base URLs and push origin pointing here. */
  env: Record<string, string>;
  reset: () => void;
  close: () => Promise<void>;
};

const readBody = (req: http.IncomingMessage) =>
  new Promise<Buffer>((resolve) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => resolve(Buffer.concat(chunks)));
  });

export const startIntegrationMocks = async (): Promise<IntegrationMocks> => {
  const mealie = createMealieMock();
  const opengym = createOpenGymMock();
  const requests: Recorded[] = [];
  const google: GoogleMock = { analyses: [], reset: () => void (google.analyses = []) };
  let base = "";
  const subscribers = new Map<string, PushSubscriber>();
  const push: PushMock = {
    received: [],
    gone: new Set(),
    subscriber: (id = crypto.randomUUID()) => {
      const ecdh = crypto.createECDH("prime256v1");
      ecdh.generateKeys();
      const subscriber = {
        id,
        endpoint: `${base}/push/${id}`,
        keys: {
          p256dh: ecdh.getPublicKey().toString("base64url"),
          auth: crypto.randomBytes(16).toString("base64url"),
        },
        privateKey: ecdh.getPrivateKey().toString("base64url"),
      };
      subscribers.set(id, subscriber);
      return subscriber;
    },
    reset: () => {
      push.received = [];
      push.gone = new Set();
    },
  };

  const control = (method: string, path: string, body: Record<string, unknown>): Reply => {
    if (path === "/reset") {
      mealie.reset();
      opengym.reset();
      push.reset();
      google.reset();
      requests.length = 0;
      return ok({ ok: true });
    }
    if (path === "/mealie/plan" && method === "POST") {
      const entry = mealie.plan(
        String(body.date ?? mealie.today),
        String(body.entryType ?? "dinner"),
        String(body.slug ?? ""),
      );
      return ok(entry);
    }
    if (path === "/mealie/today" && method === "POST") {
      mealie.today = String(body.date);
      return ok({ today: mealie.today });
    }
    if (path === "/mealie/recipes" && method === "GET")
      return ok(
        [...mealie.recipes.values()].map((r) => ({
          slug: r.slug,
          name: r.name,
          nutrition: r.nutrition,
        })),
      );
    if (path === "/mealie/plans" && method === "GET") return ok(mealie.plans);
    if (path === "/opengym/code" && method === "POST") return ok({ code: opengym.newCode() });
    if (path === "/opengym/today" && method === "POST") {
      // The default state, with "today" being this local day (the browser's).
      opengym.state = defaultOpenGymState(new Date(`${String(body.date)}T12:00:00Z`));
      return ok({ ok: true });
    }
    if (path === "/google/analysis" && method === "POST") {
      google.analyses.push(body.analysis);
      return ok({ queued: google.analyses.length });
    }
    if (path === "/push/received" && method === "GET")
      return ok(
        push.received.map((r) => ({
          id: r.id,
          headers: r.headers,
          body: r.body.toString("base64"),
        })),
      );
    if (path === "/requests" && method === "GET") return ok(requests);
    return notFound();
  };

  const server = http.createServer(async (req, res) => {
    const raw = await readBody(req);
    const url = new URL(req.url ?? "/", "http://mock");
    const method = req.method ?? "GET";
    const [, prefix, ...restParts] = url.pathname.split("/");
    const inner = new URL(`/${restParts.join("/")}${url.search}`, "http://mock");
    const auth = typeof req.headers.authorization === "string" ? req.headers.authorization : null;
    let body: unknown = undefined;
    if (prefix !== "push" && raw.length) {
      try {
        body = JSON.parse(raw.toString("utf8"));
      } catch {
        body = raw.toString("utf8");
      }
    }
    let reply: Reply;
    if (prefix === "__control")
      reply = control(method, inner.pathname, (body ?? {}) as Record<string, unknown>);
    else {
      if (
        prefix === "mealie" ||
        prefix === "opengym" ||
        prefix === "push" ||
        prefix === "google" ||
        prefix === "off"
      )
        requests.push({
          service: prefix,
          method,
          path: inner.pathname,
          authorization: auth,
          body: prefix === "push" ? null : body,
        });
      if (prefix === "mealie") reply = handleMealie(mealie, method, inner, auth, body);
      else if (prefix === "opengym") reply = handleOpenGym(opengym, method, inner, auth, body);
      else if (prefix === "google") reply = handleGoogle(google, body);
      else if (prefix === "off")
        reply = { status: 404, json: { status: 0, status_verbose: "product not found" } };
      else if (prefix === "push" && method === "POST") {
        const id = restParts.join("/");
        if (!subscribers.has(id) && !id) reply = { status: 404, json: {} };
        else if (push.gone.has(id)) reply = { status: 410, json: { reason: "gone" } };
        else {
          const headers: Record<string, string> = {};
          for (const [k, v] of Object.entries(req.headers))
            if (typeof v === "string") headers[k] = v;
          push.received.push({ id, headers, body: raw });
          reply = { status: 201, body: Buffer.alloc(0) };
        }
      } else reply = notFound();
    }
    if (reply.json !== undefined) {
      res.writeHead(reply.status, { "content-type": "application/json", ...reply.headers });
      res.end(JSON.stringify(reply.json));
    } else {
      res.writeHead(reply.status, reply.headers);
      res.end(reply.body ?? "");
    }
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return {
    url: base,
    mealie,
    opengym,
    push,
    google,
    requests,
    env: {
      MEALIE_BASE_URL: `${base}/mealie`,
      OPENGYM_BASE_URL: `${base}/opengym`,
      PUSH_ENDPOINT_ORIGINS: base,
      OFF_BASE_URL: `${base}/off`,
      AI_GOOGLE_BASE_URL: `${base}/google/v1beta`,
    },
    reset: () => {
      mealie.reset();
      opengym.reset();
      push.reset();
      google.reset();
      requests.length = 0;
    },
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections?.();
        server.close(() => resolve());
      }),
  };
};
