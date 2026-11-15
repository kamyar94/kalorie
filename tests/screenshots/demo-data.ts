// Made-up data for the README's screenshots: one demo person's meals, water, medicines,
// activities and body values over about four months, written straight to the database. Nothing
// here comes from a real person. Choices are drawn from a seeded random generator, so every run
// makes the same data (moved to the day it runs). Times are wall-clock times in UTC, the zone the
// screenshot browser runs in (playwright.screenshots.config.ts).
import crypto from "node:crypto";

import type pg from "pg";

import type { NutrientMap } from "../../lib/contracts/nutrients";
import { unitFor, type MedicineForm } from "../../lib/contracts/medicines";
import { emojiFor } from "../../lib/food/emoji";
import { shiftLocalDate } from "../../lib/meals/time";
import { targetsFromProfile } from "../../lib/targets/formulas";

export const DEMO_TZ = "UTC";
/** Days before today that get data. */
export const DEMO_DAYS = 120;

type Kind = "dish" | "ingredient" | "drink" | "packaged";
type Slot = "breakfast" | "lunch" | "dinner" | "snack" | "drink" | "dessert";

/** One food of a meal: a food of the database (by its English name), or a model estimate. */
type Part = {
  name: string;
  food?: string;
  grams: number;
  ml?: number;
  kind?: Kind;
  portion?: string;
  count?: number;
  emoji?: string;
  /** For a food that is not in the database: its amounts as the model would estimate them. */
  estimate?: NutrientMap;
};

type Template = { title: string; slot: Slot; parts: Part[] };

const TEA: Part = {
  name: "Black tea",
  grams: 250,
  ml: 250,
  kind: "drink",
  portion: "1 cup",
  emoji: "🍵",
  estimate: { energy: 2, protein: 0, carbs: 0.5, fat: 0, water: 249, caffeine: 47, potassium: 90 },
};

const F = {
  greekYogurt: "Yogurt, Greek, plain, whole milk",
  yogurt: "Yogurt, plain, whole milk",
  walnuts: "Nuts, walnuts, english",
  almonds: "Nuts, almonds",
  pistachios: "Nuts, pistachio nuts, raw",
  dates: "Dates, medjool",
  egg: "Egg, whole, cooked, hard-boiled",
  cucumber: "Cucumber, with peel, raw",
  tomato: "Tomatoes, red, ripe, raw, year round average",
  tomatoCooked: "Tomatoes, red, ripe, cooked",
  milk: "Milk, whole",
  chicken: "Chicken, broilers or fryers, breast, meat only, cooked, roasted",
  rice: "Rice, white, long-grain, regular, enriched, cooked",
  spinach: "Spinach, raw",
  oliveOil: "Oil, olive, salad or cooking",
  pasta: "Pasta, cooked, enriched, without added salt",
  lentils: "Lentils, mature seeds, cooked, boiled, without salt",
  potatoes: "Potatoes, boiled, cooked without skin, flesh, without salt",
  peas: "Peas, green, frozen, cooked, boiled, drained, without salt",
  pomegranateJuice: "Pomegranate juice, bottled",
  water: "Beverages, water, tap, drinking",
  chelow: "Chelow (Persian steamed rice)",
  ghormeh: "Ghormeh sabzi (herb stew with lamb and kidney beans)",
  joojeh: "Joojeh kabab (saffron chicken kebab)",
  koobideh: "Kabab koobideh (ground lamb and beef kebab)",
  fesenjan: "Fesenjan (walnut and pomegranate stew with chicken)",
  ash: "Ash reshteh (noodle, bean and herb soup)",
  kuku: "Kuku sabzi (herb frittata)",
  shirazi: "Shirazi salad (cucumber, tomato and onion salad)",
  doogh: "Doogh (salted yogurt drink with mint)",
  sholeh: "Sholeh zard (saffron rice pudding)",
  adasPolo: "Adas polo (lentil rice with dates and raisins)",
  bademjan: "Khoresh bademjan (eggplant and lamb stew)",
  mirza: "Mirza ghasemi (smoked eggplant with tomato, garlic and egg)",
  olivieh: "Olivieh (chicken and potato salad)",
  sabziPolo: "Sabzi polo (herb rice)",
} as const;

const part = (name: string, food: string, grams: number, extra: Partial<Part> = {}): Part => ({
  name,
  food,
  grams,
  ...extra,
});

const BREAKFASTS: Template[] = [
  {
    title: "Greek yogurt with walnuts and dates",
    slot: "breakfast",
    parts: [
      part("Greek yogurt", F.greekYogurt, 170, { portion: "1 cup", emoji: "🥣" }),
      part("Walnuts", F.walnuts, 20, { portion: "5 halves", emoji: "🌰" }),
      part("Medjool dates", F.dates, 48, { portion: "2 dates", count: 2, emoji: "🌴" }),
      TEA,
    ],
  },
  {
    title: "Boiled eggs with cucumber and tomato",
    slot: "breakfast",
    parts: [
      part("Boiled eggs", F.egg, 100, { portion: "2 eggs", count: 2, kind: "ingredient" }),
      part("Cucumber", F.cucumber, 90, { portion: "1 small" }),
      part("Tomato", F.tomato, 90, { portion: "1 medium" }),
      TEA,
    ],
  },
  {
    title: "Kuku sabzi with yogurt",
    slot: "breakfast",
    parts: [
      part("Kuku sabzi", F.kuku, 95, { portion: "1 slice", emoji: "🍳" }),
      part("Yogurt", F.yogurt, 120, { portion: "1/2 cup", emoji: "🥣" }),
      TEA,
    ],
  },
  {
    title: "Milk, dates and almonds",
    slot: "breakfast",
    parts: [
      part("Milk", F.milk, 250, { ml: 245, kind: "drink", portion: "1 glass" }),
      part("Medjool dates", F.dates, 72, { portion: "3 dates", count: 3, emoji: "🌴" }),
      part("Almonds", F.almonds, 20, { portion: "15 almonds" }),
    ],
  },
];

const LUNCHES: Template[] = [
  {
    title: "Chicken, rice and spinach salad",
    slot: "lunch",
    parts: [
      part("Chicken breast, roasted", F.chicken, 150, { portion: "1 breast", kind: "ingredient" }),
      part("White rice, cooked", F.rice, 180, { portion: "1 cup" }),
      part("Spinach salad", F.spinach, 60, { portion: "2 cups", emoji: "🥗" }),
      part("Olive oil", F.oliveOil, 8, { portion: "2 tsp", kind: "ingredient" }),
    ],
  },
  {
    title: "Ghormeh sabzi with chelow",
    slot: "lunch",
    parts: [
      part("Ghormeh sabzi", F.ghormeh, 300, { portion: "1 bowl", emoji: "🍲" }),
      part("Chelow", F.chelow, 220, { portion: "1 plate", emoji: "🍚" }),
    ],
  },
  {
    title: "Adas polo with yogurt",
    slot: "lunch",
    parts: [
      part("Adas polo", F.adasPolo, 300, { portion: "1 plate", emoji: "🍚" }),
      part("Yogurt", F.yogurt, 100, { portion: "1 small bowl", emoji: "🥣" }),
    ],
  },
  {
    title: "Pasta with tomato sauce",
    slot: "lunch",
    parts: [
      part("Pasta, cooked", F.pasta, 220, { portion: "1 1/2 cups", emoji: "🍝" }),
      part("Tomato sauce", F.tomatoCooked, 150, { portion: "2/3 cup", emoji: "🍅" }),
      part("Olive oil", F.oliveOil, 10, { portion: "2 tsp", kind: "ingredient" }),
    ],
  },
  {
    title: "Olivieh with cucumber",
    slot: "lunch",
    parts: [
      part("Olivieh", F.olivieh, 245, { portion: "1 plate", emoji: "🥗" }),
      part("Cucumber", F.cucumber, 100, { portion: "1 medium" }),
    ],
  },
];

const DINNERS: Template[] = [
  {
    title: "Joojeh kabab with chelow",
    slot: "dinner",
    parts: [
      part("Joojeh kabab", F.joojeh, 160, { portion: "1 skewer", emoji: "🍢" }),
      part("Chelow", F.chelow, 220, { portion: "1 plate", emoji: "🍚" }),
      part("Shirazi salad", F.shirazi, 150, { portion: "1 small bowl", emoji: "🥗" }),
      part("Doogh", F.doogh, 250, { ml: 250, kind: "drink", portion: "1 glass", emoji: "🥛" }),
    ],
  },
  {
    title: "Kabab koobideh with rice",
    slot: "dinner",
    parts: [
      part("Kabab koobideh", F.koobideh, 190, { portion: "2 skewers", count: 2, emoji: "🍢" }),
      part("Chelow", F.chelow, 200, { portion: "1 plate", emoji: "🍚" }),
      part("Grilled tomato", F.tomatoCooked, 100, { portion: "1 tomato", emoji: "🍅" }),
    ],
  },
  {
    title: "Fesenjan with rice",
    slot: "dinner",
    parts: [
      part("Fesenjan", F.fesenjan, 280, { portion: "1 bowl", emoji: "🍲" }),
      part("Chelow", F.chelow, 200, { portion: "1 plate", emoji: "🍚" }),
    ],
  },
  {
    title: "Ash reshteh",
    slot: "dinner",
    parts: [part("Ash reshteh", F.ash, 450, { portion: "1 large bowl", emoji: "🍜" })],
  },
  {
    title: "Khoresh bademjan with sabzi polo",
    slot: "dinner",
    parts: [
      part("Khoresh bademjan", F.bademjan, 300, { portion: "1 bowl", emoji: "🍆" }),
      part("Sabzi polo", F.sabziPolo, 220, { portion: "1 plate", emoji: "🍚" }),
    ],
  },
  {
    title: "Lentils with potatoes and peas",
    slot: "dinner",
    parts: [
      part("Lentils, cooked", F.lentils, 200, { portion: "1 cup", kind: "ingredient" }),
      part("Boiled potatoes", F.potatoes, 150, { portion: "1 medium" }),
      part("Green peas", F.peas, 80, { portion: "1/2 cup" }),
    ],
  },
  {
    title: "Mirza ghasemi with eggs",
    slot: "dinner",
    parts: [part("Mirza ghasemi", F.mirza, 280, { portion: "1 plate", emoji: "🍆" })],
  },
];

const SNACKS: Template[] = [
  {
    title: "Pistachios",
    slot: "snack",
    parts: [part("Pistachios", F.pistachios, 30, { portion: "1 handful" })],
  },
  {
    title: "Almonds and dates",
    slot: "snack",
    parts: [
      part("Almonds", F.almonds, 20, { portion: "15 almonds" }),
      part("Medjool dates", F.dates, 24, { portion: "1 date", emoji: "🌴" }),
    ],
  },
  {
    title: "Yogurt with walnuts",
    slot: "snack",
    parts: [
      part("Yogurt", F.yogurt, 150, { portion: "1 small bowl", emoji: "🥣" }),
      part("Walnuts", F.walnuts, 15, { portion: "4 halves", emoji: "🌰" }),
    ],
  },
];

const DRINK: Template = {
  title: "Pomegranate juice",
  slot: "drink",
  parts: [
    part("Pomegranate juice", F.pomegranateJuice, 205, {
      ml: 200,
      kind: "drink",
      portion: "1 glass",
      emoji: "🧃",
    }),
  ],
};

const DESSERT: Template = {
  title: "Sholeh zard",
  slot: "dessert",
  parts: [part("Sholeh zard", F.sholeh, 150, { portion: "1 small bowl", emoji: "🍮" })],
};

/** The words a meal in words would carry ("Greek yogurt, walnuts and medjool dates"). */
const wordsFor = (template: Template) => {
  const names = template.parts.map((p) => p.name.toLowerCase());
  const head = names.slice(0, -1).join(", ");
  const text = names.length > 1 ? `${head} and ${names.at(-1)}` : names[0]!;
  return text.charAt(0).toUpperCase() + text.slice(1);
};

// ---------------------------------------------------------------- helpers

/** mulberry32: a small seeded generator, so every run draws the same data. */
const random = (seed: number) => () => {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

type Rng = () => number;
const pick = <T>(rng: Rng, list: readonly T[]) => list[Math.floor(rng() * list.length)]!;
const between = (rng: Rng, low: number, high: number) => low + rng() * (high - low);
const round = (value: number, step = 1) => Math.round(value / step) * step;

const at = (day: string, time: string) => new Date(`${day}T${time}:00Z`);
const clock = (minutes: number) => {
  const m = ((Math.round(minutes) % 1440) + 1440) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
};

const scaleMap = (map: NutrientMap, factor: number): NutrientMap =>
  Object.fromEntries(
    Object.entries(map)
      .filter(([, value]) => typeof value === "number" && Number.isFinite(value))
      .map(([code, value]) => [code, Math.round((value as number) * factor * 1000) / 1000]),
  ) as NutrientMap;

const addMaps = (maps: NutrientMap[]) => {
  const total: Record<string, number> = {};
  for (const map of maps)
    for (const [code, value] of Object.entries(map))
      if (typeof value === "number") total[code] = (total[code] ?? 0) + value;
  return Object.fromEntries(
    Object.entries(total).map(([code, value]) => [code, Math.round(value * 1000) / 1000]),
  ) as NutrientMap;
};

/** Inserts rows in chunks, one statement per chunk. */
const insertRows = async (
  db: pg.Pool | pg.PoolClient,
  table: string,
  columns: string[],
  rows: unknown[][],
) => {
  for (let start = 0; start < rows.length; start += 250) {
    const values: unknown[] = [];
    const tuples = rows.slice(start, start + 250).map(
      (row) =>
        `(${row
          .map((value) => {
            values.push(value);
            return `$${values.length}`;
          })
          .join(", ")})`,
    );
    await db.query(
      `insert into ${table} (${columns.join(", ")}) values ${tuples.join(", ")}`,
      values,
    );
  }
};

type FoodRow = { id: string; nameFa: string | null; nutrients: NutrientMap };

const loadFoods = async (db: pg.Pool) => {
  const names = Object.values(F);
  const { rows } = await db.query<{
    id: string;
    name_en: string;
    name_fa: string | null;
    nutrients: NutrientMap;
  }>(
    `select distinct on (name_en) id, name_en, name_fa, nutrients from foods
     where owner_id is null and name_en = any($1::text[]) order by name_en, source`,
    [names],
  );
  const foods = new Map<string, FoodRow>(
    rows.map((r) => [r.name_en, { id: r.id, nameFa: r.name_fa, nutrients: r.nutrients }]),
  );
  const missing = names.filter((name) => !foods.has(name));
  if (missing.length) throw new Error(`Demo foods missing: ${missing.join("; ")}`);
  return foods;
};

// ---------------------------------------------------------------- meals

type MealRow = {
  id: string;
  day: string;
  time: string;
  slot: Slot;
  title: string;
  note: string | null;
  source: "text" | "manual";
  totals: NutrientMap;
  favorite: boolean;
};
type ItemRow = unknown[];

const buildMeal = (
  foods: Map<string, FoodRow>,
  userId: string,
  template: Template,
  day: string,
  time: string,
  factor = 1,
): { meal: MealRow; items: ItemRow[] } => {
  const id = crypto.randomUUID();
  const items: ItemRow[] = [];
  const maps: NutrientMap[] = [];
  template.parts.forEach((p, position) => {
    const kind = p.kind ?? "dish";
    // Drinks keep their glass; food follows the day's appetite.
    const scale = kind === "drink" ? 1 : factor;
    const grams = round(p.grams * scale, p.grams >= 50 ? 5 : 1);
    const food = p.food ? foods.get(p.food)! : null;
    const nutrients = food
      ? scaleMap(food.nutrients, grams / 100)
      : scaleMap(p.estimate ?? {}, grams / p.grams);
    maps.push(nutrients);
    items.push([
      id,
      userId,
      position,
      p.name,
      food?.nameFa ?? null,
      kind,
      p.emoji ?? emojiFor(p.name, kind),
      food?.id ?? null,
      grams,
      p.ml ?? null,
      p.portion ?? null,
      p.count ?? 1,
      grams,
      round(grams * 0.8),
      round(grams * 1.25),
      0.8,
      JSON.stringify(nutrients),
      food ? "food" : "ai_estimate",
      JSON.stringify(
        food
          ? null
          : {
              kcal: p.estimate?.energy ?? 0,
              protein: p.estimate?.protein ?? 0,
              carbs: p.estimate?.carbs ?? 0,
              fat: p.estimate?.fat ?? 0,
            },
      ),
    ]);
  });
  return {
    meal: {
      id,
      day,
      time,
      slot: template.slot,
      title: template.title,
      note: wordsFor(template),
      source: "text",
      totals: addMaps(maps),
      favorite: false,
    },
    items,
  };
};

const waterMeal = (
  foods: Map<string, FoodRow>,
  userId: string,
  day: string,
  time: string,
  ml: number,
): { meal: MealRow; items: ItemRow[] } => {
  const id = crypto.randomUUID();
  const food = foods.get(F.water)!;
  const nutrients = scaleMap(food.nutrients, ml / 100);
  return {
    meal: {
      id,
      day,
      time,
      slot: "drink",
      title: "Water",
      note: null,
      source: "manual",
      totals: nutrients,
      favorite: false,
    },
    items: [
      [
        id,
        userId,
        0,
        "Water",
        null,
        "drink",
        "💧",
        food.id,
        ml,
        ml,
        ml === 500 ? "1 bottle" : "1 glass",
        1,
        null,
        null,
        null,
        null,
        JSON.stringify(nutrients),
        "food",
        JSON.stringify(null),
      ],
    ],
  };
};

const MEAL_COLUMNS = [
  "id",
  "user_id",
  "eaten_at",
  "tz",
  "local_date",
  "slot",
  "status",
  "source",
  "title",
  "note",
  "totals",
  "analysed_at",
  "analysis_count",
  "favorite_at",
  "favorite_used_at",
];
const ITEM_COLUMNS = [
  "meal_id",
  "user_id",
  "position",
  "name",
  "local_name",
  "kind",
  "emoji",
  "food_id",
  "grams",
  "ml",
  "portion_text",
  "count",
  "model_grams",
  "grams_low",
  "grams_high",
  "confidence",
  "nutrients",
  "nutrient_source",
  "estimate",
];

const mealValues = (userId: string, meal: MealRow) => {
  const eaten = at(meal.day, meal.time);
  return [
    meal.id,
    userId,
    eaten,
    DEMO_TZ,
    meal.day,
    meal.slot,
    "ready",
    meal.source,
    meal.title,
    meal.note,
    JSON.stringify(meal.totals),
    meal.source === "text" ? new Date(eaten.getTime() + 20_000) : null,
    meal.source === "text" ? 1 : 0,
    meal.favorite ? eaten : null,
    meal.favorite ? eaten : null,
  ];
};

// ---------------------------------------------------------------- the person

/** Weight over the period: about 2.6 kg down in four months, with day-to-day noise. */
const weightOn = (rng: Rng, daysAgo: number) =>
  Math.round((66.4 + (daysAgo / DEMO_DAYS) * 2.6 + between(rng, -0.35, 0.35)) * 10) / 10;

/**
 * Fills the demo person's account: profile, four months of meals and water, today's meals in
 * words, medicines and their logs, activities with a streak, weigh-ins and tape measurements, and
 * a linked phone. Today's lunch is the photo meal, sent through the app by the screenshot spec.
 */
export const seedDemo = async (db: pg.Pool, userId: string, today: string) => {
  const rng = random(20261115);
  const foods = await loadFoods(db);
  const year = Number(today.slice(0, 4));
  const day = (daysAgo: number) => shiftLocalDate(today, -daysAgo);

  // The profile (targets come from it) and the zone the times are in.
  const latestWeight = 66.4;
  await db.query(
    `update users set sex = 'female', birth_year = $2, height_cm = 167, weight_kg = $3,
       activity_level = 'moderate', goal = 'lose', goal_rate_kg_per_week = 0.25,
       time_zone = $4 where id = $1`,
    [userId, year - 34, latestWeight, DEMO_TZ],
  );
  const energyTarget =
    targetsFromProfile({
      sex: "female",
      birthYear: year - 34,
      heightCm: 167,
      weightKg: latestWeight,
      activityLevel: "moderate",
      goal: "lose",
      goalRateKgPerWeek: 0.25,
    })?.energy ?? 1900;

  const meals: MealRow[] = [];
  const items: ItemRow[] = [];
  const add = (built: { meal: MealRow; items: ItemRow[] }) => {
    meals.push(built.meal);
    items.push(...built.items);
    return built.meal;
  };

  // ---- Past days: three or four meals, drinks and water; a few days without any meal.
  for (let daysAgo = DEMO_DAYS; daysAgo >= 1; daysAgo--) {
    const date = day(daysAgo);
    const roll = rng();
    if (roll < 0.07) continue;
    // How the day went against the energy target: mostly close, sometimes under or over.
    const ratio =
      roll < 0.12
        ? between(rng, 0.38, 0.6)
        : roll < 0.27
          ? between(rng, 0.68, 0.84)
          : roll < 0.8
            ? between(rng, 0.88, 1.08)
            : roll < 0.93
              ? between(rng, 1.12, 1.24)
              : between(rng, 1.28, 1.48);
    const plan: { template: Template; minutes: number }[] = [];
    if (rng() < 0.92)
      plan.push({ template: pick(rng, BREAKFASTS), minutes: between(rng, 435, 525) });
    if (rng() < 0.4) plan.push({ template: pick(rng, SNACKS), minutes: between(rng, 615, 680) });
    plan.push({ template: pick(rng, LUNCHES), minutes: between(rng, 735, 815) });
    if (rng() < 0.18) plan.push({ template: DRINK, minutes: between(rng, 930, 1000) });
    if (rng() < 0.35) plan.push({ template: pick(rng, SNACKS), minutes: between(rng, 960, 1030) });
    plan.push({ template: pick(rng, DINNERS), minutes: between(rng, 1125, 1215) });
    if (rng() < 0.12) plan.push({ template: DESSERT, minutes: between(rng, 1230, 1290) });

    const firstPass = plan.map((p) => buildMeal(foods, userId, p.template, date, "12:00"));
    const energy = firstPass.reduce((sum, b) => sum + (b.meal.totals.energy ?? 0), 0);
    const factor = Math.min(1.7, Math.max(0.35, (energyTarget * ratio) / Math.max(energy, 1)));
    for (const p of plan) {
      const built = add(
        buildMeal(foods, userId, p.template, date, clock(round(p.minutes, 5)), factor),
      );
      // Two favorites, logged again now and then.
      if (daysAgo === 9 && p.template.slot === "lunch") built.favorite = true;
    }
    const glasses = Math.floor(between(rng, 2, 6));
    for (let i = 0; i < glasses; i++)
      add(
        waterMeal(
          foods,
          userId,
          date,
          clock(round(between(rng, 540, 1260), 5)),
          rng() < 0.25 ? 500 : 250,
        ),
      );
  }

  // ---- Today: meals in words (the lunch photo comes from the spec), water through the day.
  const today0 = (template: Template, time: string, note?: string) => {
    const built = buildMeal(foods, userId, template, today, time);
    if (note) built.meal.note = note;
    return add(built);
  };
  const breakfast = today0(
    BREAKFASTS[0]!,
    "07:40",
    "Greek yogurt with a few walnuts, two dates and a cup of tea",
  );
  breakfast.favorite = true;
  today0(SNACKS[0]!, "10:45", "A handful of pistachios");
  today0(DRINK, "16:20", "A glass of pomegranate juice");
  for (const [time, ml] of [
    ["09:15", 250],
    ["11:30", 500],
    ["15:05", 250],
    ["17:45", 250],
  ] as const)
    add(waterMeal(foods, userId, today, time, ml));

  await insertRows(
    db,
    "meals",
    MEAL_COLUMNS,
    meals.map((m) => mealValues(userId, m)),
  );
  await insertRows(db, "meal_items", ITEM_COLUMNS, items);

  // ---- Medicines and their logs.
  const medicine = async (
    name: string,
    strength: string,
    form: MedicineForm,
    usual: number,
    ingredients: { name: string; strength: string }[],
    notes: string | null,
  ) => {
    const { rows } = await db.query<{ id: string }>(
      `insert into medicines (user_id, name, strength, form, usual_amount, unit, ingredients, notes,
         created_at)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9) returning id`,
      [
        userId,
        name,
        strength,
        form,
        usual,
        unitFor(form, 1),
        JSON.stringify(ingredients),
        notes,
        at(day(DEMO_DAYS), "08:00"),
      ],
    );
    return { id: rows[0]!.id, name, strength, form, usual };
  };
  const vitaminD = await medicine(
    "Vitamin D3",
    "1,000 IU",
    "capsule",
    1,
    [{ name: "Cholecalciferol", strength: "25 mcg" }],
    null,
  );
  const magnesium = await medicine(
    "Magnesium",
    "200 mg",
    "tablet",
    1,
    [{ name: "Magnesium glycinate", strength: "200 mg" }],
    "In the evening",
  );
  const ibuprofen = await medicine(
    "Ibuprofen",
    "200 mg",
    "tablet",
    2,
    [{ name: "Ibuprofen", strength: "200 mg" }],
    "When needed, with food",
  );
  const logs: unknown[][] = [];
  const log = (m: typeof vitaminD, date: string, time: string, amount = m.usual) =>
    logs.push([
      userId,
      m.id,
      m.name,
      m.strength,
      m.form,
      amount,
      unitFor(m.form, amount),
      at(date, time),
      DEMO_TZ,
      date,
    ]);
  for (let daysAgo = 90; daysAgo >= 1; daysAgo--) {
    if (rng() > 0.1) log(vitaminD, day(daysAgo), clock(round(between(rng, 470, 520), 5)));
    if (daysAgo <= 60 && rng() > 0.15)
      log(magnesium, day(daysAgo), clock(round(between(rng, 1270, 1320), 5)));
  }
  for (const daysAgo of [41, 40, 18, 6]) log(ibuprofen, day(daysAgo), "13:40");
  log(vitaminD, today, "08:05");
  await insertRows(
    db,
    "medicine_logs",
    [
      "user_id",
      "medicine_id",
      "name",
      "strength",
      "form",
      "amount",
      "unit",
      "taken_at",
      "tz",
      "local_date",
    ],
    logs,
  );

  // ---- Activities: steps every day from the phone, runs and rides from the watch, strength and
  // yoga typed in Kal. The last five weeks are all active days (the streak).
  const activities: unknown[][] = [];
  const activity = (
    date: string,
    time: string,
    a: {
      category: string;
      type: string;
      title: string;
      minutes?: number;
      metres?: number;
      steps?: number;
      kcal?: number;
      intensity?: string;
      source: "manual" | "health_connect";
    },
  ) =>
    activities.push([
      userId,
      a.category,
      a.type,
      a.title,
      at(date, time),
      DEMO_TZ,
      date,
      a.minutes ?? null,
      a.metres ?? null,
      a.steps ?? null,
      a.kcal ?? null,
      a.intensity ?? null,
      a.source,
      a.source === "health_connect" ? "com.sec.android.app.shealth" : null,
      a.source === "health_connect" ? `${a.type}:${date}:${time}` : null,
    ]);
  for (let daysAgo = DEMO_DAYS; daysAgo >= 1; daysAgo--) {
    const date = day(daysAgo);
    const streak = daysAgo <= 36;
    const steps = round(between(rng, streak ? 5600 : 2800, streak ? 12800 : 11000), 10);
    activity(date, "00:00", {
      category: "walking",
      type: "steps",
      title: "Steps",
      steps,
      source: "health_connect",
    });
    const weekday = new Date(`${date}T12:00:00Z`).getUTCDay();
    if ([1, 3, 6].includes(weekday) && rng() < 0.85) {
      const minutes = round(between(rng, 24, 42));
      activity(date, "07:00", {
        category: "cardio",
        type: "run",
        title: "Running",
        minutes,
        metres: round(minutes * between(rng, 160, 185), 10),
        kcal: round(minutes * 10.5),
        intensity: "vigorous",
        source: "health_connect",
      });
    }
    if ([2, 5].includes(weekday) && rng() < 0.8)
      activity(date, "18:15", {
        category: "strength",
        type: "weights",
        title: "Weight training",
        minutes: round(between(rng, 40, 55), 5),
        kcal: 210,
        intensity: "moderate",
        source: "manual",
      });
    if (weekday === 0 && rng() < 0.7)
      activity(date, "09:30", {
        category: "mobility",
        type: "yoga",
        title: "Yoga",
        minutes: 30,
        kcal: 95,
        intensity: "light",
        source: "manual",
      });
    if (weekday === 4 && rng() < 0.5)
      activity(date, "17:30", {
        category: "cardio",
        type: "cycle",
        title: "Cycling",
        minutes: 45,
        metres: round(between(rng, 13000, 17000), 100),
        kcal: 330,
        intensity: "moderate",
        source: "health_connect",
      });
  }
  activity(today, "07:00", {
    category: "cardio",
    type: "run",
    title: "Running",
    minutes: 32,
    metres: 5400,
    kcal: 336,
    intensity: "vigorous",
    source: "health_connect",
  });
  activity(today, "00:00", {
    category: "walking",
    type: "steps",
    title: "Steps",
    steps: 8240,
    source: "health_connect",
  });
  await insertRows(
    db,
    "activities",
    [
      "user_id",
      "category",
      "type",
      "title",
      "started_at",
      "tz",
      "local_date",
      "duration_min",
      "distance_m",
      "steps",
      "energy_kcal",
      "intensity",
      "source",
      "source_app",
      "external_id",
    ],
    activities,
  );

  // ---- Body: weigh-ins from a smart scale (through Health Connect), tape measurements by hand.
  const body: unknown[][] = [];
  const measure = (
    date: string,
    time: string,
    code: string,
    unit: string,
    value: number,
    source: "manual" | "health_connect",
  ) =>
    body.push([
      userId,
      code,
      unit,
      value,
      at(date, time),
      DEMO_TZ,
      date,
      source,
      source === "health_connect" ? "com.renpho.health" : null,
      source === "health_connect" ? `${code}:${date}` : `${date}:${code}`,
    ]);
  for (let daysAgo = DEMO_DAYS; daysAgo >= 0; daysAgo -= daysAgo > 30 ? 3 : 2) {
    const date = day(daysAgo);
    const weight = daysAgo === 0 ? latestWeight : weightOn(rng, daysAgo);
    measure(date, "07:20", "weight", "kg", weight, "health_connect");
    const fat =
      Math.round((27.4 + (daysAgo / DEMO_DAYS) * 1.9 + between(rng, -0.3, 0.3)) * 10) / 10;
    measure(date, "07:20", "body_fat", "%", fat, "health_connect");
    measure(
      date,
      "07:20",
      "muscle",
      "kg",
      Math.round(weight * (1 - fat / 100) * 0.93 * 10) / 10,
      "health_connect",
    );
    measure(
      date,
      "07:20",
      "water",
      "%",
      Math.round((52.6 - (daysAgo / DEMO_DAYS) * 1.1) * 10) / 10,
      "health_connect",
    );
  }
  for (const [daysAgo, waist, hips, chest, thigh] of [
    [118, 79.5, 100.5, 92.5, 58.5],
    [88, 78.6, 100.0, 92.0, 58.0],
    [60, 77.4, 99.2, 91.6, 57.6],
    [32, 76.5, 98.6, 91.0, 57.0],
    [4, 75.4, 98.0, 90.6, 56.5],
  ] as const) {
    const date = day(daysAgo);
    measure(date, "07:30", "waist", "cm", waist, "manual");
    measure(date, "07:30", "hips", "cm", hips, "manual");
    measure(date, "07:30", "chest", "cm", chest, "manual");
    measure(date, "07:30", "thigh_l", "cm", thigh, "manual");
  }
  await insertRows(
    db,
    "body_measurements",
    [
      "user_id",
      "code",
      "unit",
      "value",
      "measured_at",
      "tz",
      "local_date",
      "source",
      "source_app",
      "external_id",
    ],
    body,
  );

  // ---- A phone linked through Kal for Android, last heard from a few minutes ago.
  const now = Date.now();
  await db.query(
    `insert into devices (user_id, name, platform, app_version, token_hash, sends, created_at,
       last_seen_at, last_sync_at)
     values ($1, 'Pixel 7', 'android', '1.0', $2, $3, $4, $5, $5)`,
    [
      userId,
      crypto.randomBytes(32).toString("hex"),
      ["steps", "workouts", "heart_rate", "sleep", "weight", "body"],
      new Date(now - 40 * 86_400_000),
      new Date(now - 12 * 60_000),
    ],
  );

  return { energyTarget };
};

/**
 * Today's dinner, logged once the photo lunch is analysed: sized so the day ends a little under
 * the energy target (the ring on Today shows what is left).
 */
export const addTodayDinner = async (
  db: pg.Pool,
  userId: string,
  today: string,
  energyTarget: number,
) => {
  const foods = await loadFoods(db);
  const { rows } = await db.query<{ energy: number }>(
    `select coalesce(sum((totals->>'energy')::float), 0) as energy from meals
     where user_id = $1 and local_date = $2 and deleted_at is null`,
    [userId, today],
  );
  const template = DINNERS[0]!;
  const full = buildMeal(foods, userId, template, today, "19:30");
  const wanted = energyTarget * 0.94 - Number(rows[0]?.energy ?? 0);
  const factor = Math.min(1.2, Math.max(0.4, wanted / Math.max(full.meal.totals.energy ?? 1, 1)));
  const built = buildMeal(foods, userId, template, today, "19:30", factor);
  built.meal.note = "Joojeh kabab with rice, Shirazi salad and a glass of doogh";
  await insertRows(db, "meals", MEAL_COLUMNS, [mealValues(userId, built.meal)]);
  await insertRows(db, "meal_items", ITEM_COLUMNS, built.items);
};

/** The photo meal's analysis, as the mock provider answers it (tests/fixtures/meal.jpg). */
export const PHOTO_ANALYSIS = {
  is_food: true,
  not_food_kind: "none",
  title: "Koobideh with rice",
  cuisine: "Persian",
  meal_type: "lunch",
  overall_confidence: 0.78,
  questions: [
    {
      question: "Was there butter on the rice?",
      answers: ["No butter", "A little", "A lot"],
    },
  ],
  items: [
    {
      name: "Chelow",
      local_name: "چلو",
      kind: "dish",
      emoji: "🍚",
      preparation: "steamed",
      grams: 220,
      ml: 0,
      grams_low: 180,
      grams_high: 270,
      portion_text: "1 plate",
      confidence: 0.8,
      photo_indexes: [0],
      search_terms: ["chelow", "white rice cooked"],
      matches_usual: "",
      matches_planned: "",
      same_as_item: "",
      components: [],
      label: [],
      estimate: { kcal: 300, protein: 6, carbs: 62, fat: 3, fiber: 1, sugar: 0, sodium: 250 },
    },
    {
      name: "Kabab koobideh",
      local_name: "کباب کوبیده",
      kind: "dish",
      emoji: "🍢",
      preparation: "grilled",
      grams: 95,
      ml: 0,
      grams_low: 80,
      grams_high: 120,
      portion_text: "1 skewer",
      confidence: 0.75,
      photo_indexes: [0],
      search_terms: ["kabab koobideh", "ground lamb kebab"],
      matches_usual: "",
      matches_planned: "",
      same_as_item: "",
      components: [],
      label: [],
      estimate: { kcal: 260, protein: 17, carbs: 2, fat: 20, fiber: 0, sugar: 1, sodium: 380 },
    },
    {
      name: "Parsley and mint",
      local_name: "سبزی خوردن",
      kind: "ingredient",
      emoji: "🌿",
      preparation: "raw",
      grams: 40,
      ml: 0,
      grams_low: 25,
      grams_high: 60,
      portion_text: "1 handful",
      confidence: 0.7,
      photo_indexes: [0],
      search_terms: ["fresh herbs", "parsley fresh"],
      matches_usual: "",
      matches_planned: "",
      same_as_item: "",
      components: [],
      label: [],
      estimate: { kcal: 14, protein: 1, carbs: 2, fat: 0, fiber: 1, sugar: 0, sodium: 22 },
    },
  ],
};
