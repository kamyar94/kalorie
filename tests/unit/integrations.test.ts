// Pure parts of the integrations: Mealie nutrition strings, ingredient amounts and units, the
// meal plan search, openGym's state and the workout estimate, Web Push encryption and VAPID, and
// the address checks that keep the server from calling anywhere else.
import crypto from "node:crypto";

import { describe, expect, it } from "vitest";

import type { FoodResult } from "@/lib/contracts/food-search";
import { cleanBaseUrl, integrationConfig } from "@/lib/integrations/config";
import {
  canonicalUnit,
  ingredientGrams,
  parseIngredient,
  parseQuantity,
} from "@/lib/integrations/mealie/ingredients";
import {
  isNutritionEmpty,
  mealieToNutrients,
  nutrientsToMealie,
  parseAmount,
} from "@/lib/integrations/mealie/nutrition";
import { suggestPlan, type PlanRecipe } from "@/lib/integrations/mealie/planner";
import { recipeServings } from "@/lib/integrations/mealie/recipes";
import { mealieEntryType, slotOfEntry } from "@/lib/integrations/mealie/service";
import { cleanPairCode } from "@/lib/integrations/opengym/service";
import { metFor, parseState, weightForDay, workoutKcal } from "@/lib/integrations/opengym/parse";
import { allowedEndpoint, vapidConfig } from "@/lib/push/config";
import {
  encryptPayload,
  generateVapidKeys,
  scalar32,
  vapidAuthorization,
  vapidKeysValid,
} from "@/lib/push/webpush";
import { decryptPush, verifyVapid } from "@/tests/helpers/mock-integrations";

describe("Mealie nutrition", () => {
  it("reads numbers with or without units, in Mealie's units", () => {
    expect(parseAmount("650 kcal")).toEqual({ amount: 650, unit: "kcal" });
    expect(parseAmount("1,200 mg")).toEqual({ amount: 1200, unit: "mg" });
    expect(parseAmount("12,5 g")).toEqual({ amount: 12.5, unit: "g" });
    expect(parseAmount("about 30")).toEqual({ amount: 30, unit: "" });
    expect(parseAmount("none")).toBeNull();
    expect(
      mealieToNutrients({
        calories: "2093 kJ",
        proteinContent: "30",
        sodiumContent: "0.8 g",
        cholesterolContent: "45",
        fatContent: null,
        sugarContent: "",
      }),
    ).toEqual({ energy: expect.closeTo(500.24, 2), protein: 30, sodium: 800, cholesterol: 45 });
  });

  it("calls nutrition empty without energy, and writes it back as plain numbers", () => {
    expect(isNutritionEmpty(null)).toBe(true);
    expect(isNutritionEmpty({ calories: null, proteinContent: "10" })).toBe(true);
    expect(isNutritionEmpty({ calories: "0" })).toBe(true);
    expect(isNutritionEmpty({ calories: "310" })).toBe(false);
    expect(
      nutrientsToMealie({ energy: 412.6, protein: 21.04, sodium: 812.4, fat_sat: 3.06, vit_c: 9 }),
    ).toEqual({
      calories: "413",
      proteinContent: "21",
      sodiumContent: "812",
      saturatedFatContent: "3.1",
    });
  });
});

describe("Mealie ingredients", () => {
  it("reads amounts, fractions and ranges", () => {
    expect(parseQuantity("1 1/2 cups rice")).toEqual({ quantity: 1.5, rest: " cups rice" });
    expect(parseQuantity("3/4 cup")?.quantity).toBe(0.75);
    expect(parseQuantity("½ onion")?.quantity).toBe(0.5);
    expect(parseQuantity("1½ cups")?.quantity).toBe(1.5);
    expect(parseQuantity("2-3 cloves")).toEqual({ quantity: 2, rest: " cloves" });
    expect(parseQuantity("salt to taste")).toBeNull();
  });

  it("knows units by name and abbreviation", () => {
    expect(canonicalUnit("Tablespoons")).toBe("tbsp");
    expect(canonicalUnit("T")).toBe("tbsp");
    expect(canonicalUnit("t")).toBe("tsp");
    expect(canonicalUnit("tsp.")).toBe("tsp");
    expect(canonicalUnit("Grams")).toBe("g");
    expect(canonicalUnit("handful")).toBeNull();
  });

  it("reads parsed and plain-text ingredients", () => {
    expect(parseIngredient("2 cloves garlic, crushed")).toMatchObject({
      name: "garlic",
      quantity: 2,
      unit: "clove",
    });
    expect(parseIngredient("1 large onion (diced)")).toMatchObject({
      name: "onion",
      quantity: 1,
      unit: "large",
    });
    expect(parseIngredient("Salt to taste")).toMatchObject({
      name: "Salt to taste",
      quantity: null,
    });
    expect(
      parseIngredient({
        quantity: 2,
        unit: { name: "tablespoon", abbreviation: "tbsp" },
        food: { name: "Olive oil" },
        note: "extra virgin",
      }),
    ).toMatchObject({ name: "Olive oil", quantity: 2, unit: "tbsp" });
    expect(parseIngredient({ quantity: 0, food: null, note: "", display: "" })).toBeNull();
  });

  const food = (overrides: Partial<FoodResult>): FoodResult => ({
    id: "f",
    source: "fdc_sr_legacy",
    kind: "food",
    nameEn: "Food",
    nameFa: null,
    brand: null,
    category: null,
    barcode: null,
    per100g: { energy: 100 },
    densityGPerMl: null,
    servingGrams: null,
    portions: [],
    sourceNote: null,
    personal: false,
    score: 1,
    ...overrides,
  });

  it("turns amounts into grams through units, portions and density", () => {
    const rice = food({
      portions: [{ id: 1, label: "1 cup", labelFa: null, amount: 1, unit: "cup", grams: 158 }],
    });
    expect(ingredientGrams({ name: "rice", quantity: 300, unit: "g", text: "" }, rice)).toBe(300);
    expect(ingredientGrams({ name: "rice", quantity: 2, unit: "cup", text: "" }, rice)).toBe(316);
    expect(ingredientGrams({ name: "rice", quantity: 1, unit: "tbsp", text: "" }, rice)).toBe(15);
    const milk = food({ densityGPerMl: 1.03 });
    expect(
      ingredientGrams({ name: "milk", quantity: 250, unit: "ml", text: "" }, milk),
    ).toBeCloseTo(257.5);
    const egg = food({
      portions: [{ id: 2, label: "1 large", labelFa: null, amount: 1, unit: "large", grams: 50 }],
    });
    expect(ingredientGrams({ name: "eggs", quantity: 3, unit: null, text: "" }, egg)).toBe(150);
    expect(ingredientGrams({ name: "x", quantity: 1, unit: null, text: "" }, food({}))).toBeNull();
    expect(
      ingredientGrams({ name: "x", quantity: null, unit: "g", text: "" }, food({})),
    ).toBeNull();
  });

  it("counts servings from the recipe, the yield or one", () => {
    expect(recipeServings({ recipeServings: 6 })).toBe(6);
    expect(recipeServings({ recipeServings: 0, recipeYieldQuantity: 3 })).toBe(3);
    expect(recipeServings({})).toBe(1);
  });

  it("maps plan entry types to meal slots (side has none)", () => {
    expect(slotOfEntry("dinner")).toBe("dinner");
    expect(slotOfEntry("dessert")).toBe("dessert");
    expect(slotOfEntry("drink")).toBe("drink");
    expect(slotOfEntry("side")).toBeNull();
  });
});

describe("meal plan suggestions", () => {
  const recipes: PlanRecipe[] = [
    { id: "a", slug: "a", name: "Oats", kcal: 380, protein: 18 },
    { id: "b", slug: "b", name: "Eggs on toast", kcal: 450, protein: 28 },
    { id: "c", slug: "c", name: "Chicken salad", kcal: 600, protein: 45 },
    { id: "d", slug: "d", name: "Lentil stew", kcal: 650, protein: 32 },
    { id: "e", slug: "e", name: "Pizza", kcal: 1100, protein: 40 },
    { id: "f", slug: "f", name: "Salmon and rice", kcal: 700, protein: 42 },
    { id: "g", slug: "g", name: "Water", kcal: 0, protein: 0 },
  ];

  it("keeps each day within energy and above protein, varies the days, and is deterministic", () => {
    const input = {
      days: ["2026-11-02", "2026-11-01"],
      slots: ["dinner", "breakfast", "lunch"] as const,
      energyTarget: 2200,
      proteinTarget: 110,
      recipes,
    };
    const plan = suggestPlan({ ...input, slots: [...input.slots] });
    expect(plan.map((d) => d.date)).toEqual(["2026-11-01", "2026-11-02"]);
    for (const day of plan) {
      expect(day.entries.map((e) => e.slot)).toEqual(["breakfast", "lunch", "dinner"]);
      expect(day.meetsTargets).toBe(true);
      expect(day.kcal).toBeLessThanOrEqual(day.energyBudget);
      expect(day.protein).toBeGreaterThanOrEqual(day.proteinMin);
      expect(day.entries.some((e) => e.recipeId === "e" || e.recipeId === "g")).toBe(false);
    }
    // 90 % of the day for breakfast, lunch and dinner.
    expect(plan[0]!.energyBudget).toBe(1980);
    const first = new Set(plan[0]!.entries.map((e) => e.recipeId));
    expect(plan[1]!.entries.filter((e) => first.has(e.recipeId)).length).toBeLessThan(3);
    expect(suggestPlan({ ...input, slots: [...input.slots] })).toEqual(plan);
  });

  it("marks a day it cannot fit and copes with no recipes", () => {
    const tight = suggestPlan({
      days: ["2026-11-01"],
      slots: ["dinner"],
      energyTarget: 1000,
      proteinTarget: 200,
      recipes,
    });
    expect(tight[0]!.meetsTargets).toBe(false);
    expect(tight[0]!.entries).toHaveLength(1);
    const none = suggestPlan({
      days: ["2026-11-01"],
      slots: ["dinner"],
      energyTarget: 2000,
      proteinTarget: 80,
      recipes: [],
    });
    expect(none[0]).toMatchObject({ entries: [], meetsTargets: false });
  });
});

describe("openGym", () => {
  it("reads weigh-ins and workouts, in kg, without removed weigh-ins", () => {
    const now = new Date("2026-10-31T12:00:00Z");
    const snapshot = parseState(
      {
        unit: "lb",
        bodyweight: [
          { d: "2026-10-01", w: 180, t: 1 },
          { d: "2026-10-20", w: 178, t: 2 },
          { d: "2026-10-20", w: 177, t: 3 },
          { d: "2026-10-25", w: 999, t: 4 },
          { d: "2026-10-30", w: 176, t: 5 },
          { d: "bad", w: 170 },
        ],
        deleted: { bodyweight: { "2026-10-25": 123, "2026-10-30": -5 }, workouts: { w4: 9 } },
        workouts: [
          {
            id: "w1",
            d: "2026-10-30",
            start: 0,
            end: 75 * 60_000,
            name: "Push",
            bw: 176,
            entries: [{ id: "bench-press" }, { id: "c1" }],
          },
          { id: "w2", d: "2026-10-31", start: 0, end: 9 * 3600_000, name: "", entries: [] },
          { id: "w3", d: "2025-01-01", start: 0, end: 1, name: "Old" },
          { id: "w4", d: "2026-10-29", start: 0, end: 60_000, name: "Removed in openGym" },
        ],
        customEx: [{ id: "c1", name: "Cable fly" }],
      },
      { now },
    );
    expect(snapshot.unit).toBe("lb");
    expect(snapshot.weights).toEqual([
      { date: "2026-10-01", kg: 81.6 },
      { date: "2026-10-20", kg: 80.3 },
      { date: "2026-10-30", kg: 79.8 },
    ]);
    expect(snapshot.latestWeight).toEqual({ date: "2026-10-30", kg: 79.8 });
    expect(snapshot.workouts).toEqual([
      expect.objectContaining({
        id: "w1",
        durationMin: 75,
        bwKg: 79.8,
        exercises: ["Bench press", "Cable fly"],
      }),
      expect.objectContaining({ id: "w2", name: "Workout", durationMin: null }),
    ]);
    expect(parseState(null).weights).toEqual([]);
  });

  it("estimates energy from MET values, body weight and duration", () => {
    expect(metFor("Legs")).toMatchObject({ met: 3.5, code: "02054" });
    expect(metFor("Kettlebell circuit")).toMatchObject({ met: 7.5 });
    expect(metFor("Morning yoga")).toMatchObject({ met: 2.3 });
    expect(workoutKcal(3.5, 80, 60)).toBe(280);
    expect(workoutKcal(3.5, null, 60)).toBeNull();
    expect(workoutKcal(3.5, 80, null)).toBeNull();
    expect(
      weightForDay(
        "2026-10-21",
        [
          { date: "2026-10-01", kg: 81 },
          { date: "2026-10-20", kg: 80 },
        ],
        90,
      ),
    ).toBe(80);
    expect(weightForDay("2026-09-01", [{ date: "2026-10-01", kg: 81 }], 90)).toBe(81);
    expect(weightForDay("2026-09-01", [], 90)).toBe(90);
  });

  it("cleans pairing codes", () => {
    expect(cleanPairCode(" k7wq-2mzp ")).toBe("K7WQ2MZP");
    expect(cleanPairCode("K7WQ2MZ0")).toBeNull(); // 0 is not in openGym's alphabet
    expect(cleanPairCode(42)).toBeNull();
  });
});

describe("server addresses", () => {
  it("takes base URLs from the server only, http(s) without credentials", () => {
    expect(cleanBaseUrl(" https://mealie.example.org/ ")).toBe("https://mealie.example.org");
    expect(cleanBaseUrl("https://example.org/sub/path/")).toBe("https://example.org/sub/path");
    expect(cleanBaseUrl("ftp://example.org")).toBeNull();
    expect(cleanBaseUrl("https://user:pw@example.org")).toBeNull();
    expect(
      integrationConfig({ MEALIE_BASE_URL: "nonsense", INTEGRATION_TIMEOUT_MS: "-1" }),
    ).toEqual({
      mealieBaseUrl: null,
      opengymBaseUrl: null,
      timeoutMs: 8000,
    });
  });

  it("sends push only to known push services over https", () => {
    expect(allowedEndpoint("https://fcm.googleapis.com/fcm/send/abc", {})).toBe(true);
    expect(allowedEndpoint("https://web.push.apple.com/QGx", {})).toBe(true);
    expect(allowedEndpoint("https://wns2-par02p.notify.windows.com/w/?token=x", {})).toBe(true);
    expect(allowedEndpoint("https://updates.push.services.mozilla.com/wpush/v2/x", {})).toBe(true);
    expect(allowedEndpoint("http://fcm.googleapis.com/x", {})).toBe(false);
    expect(allowedEndpoint("https://fcm.googleapis.com.evil.example.org/x", {})).toBe(false);
    expect(allowedEndpoint("https://fcm.googleapis.com:8443/x", {})).toBe(false);
    expect(allowedEndpoint("https://127.0.0.1/x", {})).toBe(false);
    expect(
      allowedEndpoint("http://127.0.0.1:9/push/x", { PUSH_ENDPOINT_ORIGINS: "http://127.0.0.1:9" }),
    ).toBe(true);
    expect(
      allowedEndpoint("https://push.example.org/x", { PUSH_SERVICE_HOSTS: "push.example.org" }),
    ).toBe(true);
  });
});

describe("Web Push", () => {
  it("encrypts so that only the subscriber can read it (RFC 8291)", () => {
    const browser = generateVapidKeys(); // any P-256 pair serves as the browser's keys
    const subscriber = {
      keys: { p256dh: browser.publicKey, auth: Buffer.alloc(16, 7).toString("base64url") },
      privateKey: browser.privateKey,
    };
    const body = encryptPayload(
      Buffer.from(JSON.stringify({ title: "Hi", body: "سلام" })),
      subscriber.keys,
    );
    expect(body.readUInt32BE(16)).toBe(4096);
    expect(body.readUInt8(20)).toBe(65);
    expect(decryptPush(body, subscriber)).toEqual({ title: "Hi", body: "سلام" });
    const stranger = generateVapidKeys();
    expect(() =>
      decryptPush(body, { keys: subscriber.keys, privateKey: stranger.privateKey }),
    ).toThrow();
    expect(() =>
      encryptPayload(Buffer.alloc(10), { p256dh: "AAAA", auth: subscriber.keys.auth }),
    ).toThrow();
  });

  it("signs VAPID tokens for the push service's origin, and checks the server keys", () => {
    const keys = { ...generateVapidKeys(), subject: "mailto:admin@example.org" };
    const header = vapidAuthorization(
      "https://fcm.googleapis.com/fcm/send/abc",
      keys,
      Date.UTC(2026, 9, 31),
    );
    expect(header).toMatch(/^vapid t=[\w-]+\.[\w-]+\.[\w-]+, k=[\w-]+$/);
    expect(verifyVapid(header)).toEqual({
      aud: "https://fcm.googleapis.com",
      exp: Date.UTC(2026, 9, 31) / 1000 + 12 * 3600,
      sub: "mailto:admin@example.org",
    });
    expect(vapidKeysValid(keys)).toBe(true);
    const other = generateVapidKeys();
    expect(vapidKeysValid({ publicKey: keys.publicKey, privateKey: other.privateKey })).toBe(false);
    expect(
      vapidConfig({
        VAPID_PUBLIC_KEY: keys.publicKey,
        VAPID_PRIVATE_KEY: keys.privateKey,
        VAPID_SUBJECT: "mailto:admin@example.org",
      }),
    ).toMatchObject({ publicKey: keys.publicKey });
    expect(
      vapidConfig({
        VAPID_PUBLIC_KEY: keys.publicKey,
        VAPID_PRIVATE_KEY: other.privateKey,
        VAPID_SUBJECT: "mailto:a@example.org",
      }),
    ).toBeNull();
    expect(
      vapidConfig({
        VAPID_PUBLIC_KEY: keys.publicKey,
        VAPID_PRIVATE_KEY: keys.privateKey,
        VAPID_SUBJECT: "admin",
      }),
    ).toBeNull();
  });

  it("keeps the private key at 32 bytes, and accepts one a tool wrote without leading zeros", async () => {
    // Node's ECDH.getPrivateKey() drops leading zero bytes: about one key pair in 256 used to
    // come out with a 31-byte private key that the server then refused ("not set up").
    const { newVapidKeys } = await import("../../scripts/cal.mjs");
    for (let i = 0; i < 2000; i++) {
      expect(Buffer.from(generateVapidKeys().privateKey, "base64url")).toHaveLength(32);
      expect(Buffer.from(newVapidKeys().privateKey, "base64url")).toHaveLength(32);
    }
    let short: { publicKey: string; privateKey: string } | null = null;
    for (let i = 0; i < 20_000 && !short; i++) {
      const ecdh = crypto.createECDH("prime256v1");
      ecdh.generateKeys();
      if (ecdh.getPrivateKey().length < 32)
        short = {
          publicKey: ecdh.getPublicKey("base64url"),
          privateKey: ecdh.getPrivateKey("base64url"),
        };
    }
    expect(short).not.toBeNull();
    expect(vapidKeysValid(short!)).toBe(true);
    expect(
      vapidConfig({
        VAPID_PUBLIC_KEY: short!.publicKey,
        VAPID_PRIVATE_KEY: short!.privateKey,
        VAPID_SUBJECT: "mailto:admin@example.org",
      }),
    ).not.toBeNull();
    expect(Buffer.from(scalar32(Buffer.from([1, 2])))).toHaveLength(32);
  });
});

describe("Cal's meal slots as Mealie entry types", () => {
  it("writes supper as dinner (Mealie has no supper) and the others as they are", () => {
    expect(mealieEntryType("supper")).toBe("dinner");
    for (const slot of ["breakfast", "lunch", "dinner", "snack", "drink", "dessert"] as const)
      expect(mealieEntryType(slot)).toBe(slot);
  });
});
