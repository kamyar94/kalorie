// Meals for the balance and suggestion specs, written straight into the e2e database: a ready
// meal at a given moment whose first item carries the nutrients (so a copy adds up the same),
// and totals at a chosen part of each nutrient's share of the default targets (2,000 kcal and
// the US Daily Values, for a person without a profile). Values are made up.
import { pool, zone } from "./helpers";

/** Totals at `factor` of each nutrient's share for the energy, limits at `limits` of theirs. */
export const mix = (energy: number, factor: number, limits = 0.5) => {
  const share = Math.max(energy / 2000, 0.05);
  const f = (target: number) => target * share * factor;
  const l = (target: number) => target * share * limits;
  return {
    energy,
    protein: f(50),
    fiber: f(28),
    vit_a: f(900),
    vit_c: f(90),
    vit_e: f(15),
    calcium: f(1300),
    iron: f(18),
    potassium: f(4700),
    magnesium: f(420),
    fat_sat: l(20),
    sugars_added: l(50),
    sodium: l(2300),
  };
};

export type Item = { name: string; emoji: string; kind?: "dish" | "drink" };

/** A ready meal at `eatenAt` (an SQL expression) whose first item carries its nutrients. */
export const addMeal = async (
  userId: string,
  eatenAt: { sql: string; params: unknown[] },
  values: {
    title: string;
    slot?: string;
    totals: Record<string, number>;
    items: Item[];
    favorite?: boolean;
  },
) => {
  const offset = 4;
  const at = eatenAt.sql.replace(/\$(\d+)/g, (_m, n) => `$${Number(n) + offset}`);
  const row = await pool().query(
    `insert into meals (user_id, eaten_at, tz, local_date, slot, status, source, title, totals,
       favorite_at)
     select $1, at, $2, (at at time zone $2)::date, $3, 'ready', 'manual', $4, '{}'::jsonb,
       ${values.favorite ? "now()" : "null"}
     from (select ${at} as at) t
     returning id`,
    [userId, zone(), values.slot ?? "lunch", values.title, ...eatenAt.params],
  );
  const mealId = row.rows[0].id as string;
  for (const [position, item] of values.items.entries())
    await pool().query(
      `insert into meal_items (meal_id, user_id, position, name, kind, emoji, grams, nutrients)
       values ($1, $2, $3, $4, $5, $6, 200, $7)`,
      [
        mealId,
        userId,
        position,
        item.name,
        item.kind ?? "dish",
        item.emoji,
        JSON.stringify(position === 0 ? values.totals : {}),
      ],
    );
  await pool().query("update meals set totals = $2 where id = $1", [
    mealId,
    JSON.stringify(values.totals),
  ]);
  return mealId;
};

/** 12:30 on a local day. */
export const onDay = (date: string) => ({
  sql: `(($1::date + time '12:30') at time zone '${zone()}')`,
  params: [date],
});
