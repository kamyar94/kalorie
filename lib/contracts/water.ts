// CONTRACT: the day's water entries. The Today screen's Water card lists them, oldest first: water
// added on its own (from the card's buttons: a meal of plain water only, without a photo), which
// the water sheet changes, and the drinks inside meals, which open their meal. Plain data, safe to
// import from client components.
//
// Server functions (lib/meals/water-service.ts), scoped by the signed-in person's id:
//   listWaterEntries(userId, localDate)            -> WaterEntryDto[]
//   updateWaterEntry(userId, mealId, WaterPatch)   -> WaterEntryDto | "not-water" | null
// HTTP: PATCH /api/water/:mealId. New water is a manual meal (POST /api/manual-meals, as the
// card's "+ Glass" adds it) and removing it deletes that meal (DELETE /api/meals/:id).

/** One amount of water: whole millilitres from 10 ml to 3 L; the sheet's buttons step by 50 ml. */
export const WATER_LIMITS = { minMl: 10, maxMl: 3000, stepMl: 50 } as const;

/** The amounts the water sheet offers: "Sip 100", "Glass 250", "Bottle 500", "Large 750", "1 L". */
export const WATER_PRESETS: { ml: number; label: string }[] = [
  { ml: 100, label: "Sip 100" },
  { ml: 250, label: "Glass 250" },
  { ml: 500, label: "Bottle 500" },
  { ml: 750, label: "Large 750" },
  { ml: 1000, label: "1 L" },
];

export type WaterEntryDto = {
  /** The drink (a meal item) and its meal. */
  itemId: string;
  mealId: string;
  /** The meal's time, ISO; its time zone, day and HH:MM there. */
  eatenAt: string;
  tz: string;
  localDate: string;
  localTime: string;
  /**
   * Water added on its own (a meal of plain water only, without a photo): the water sheet
   * changes its amount and time. Otherwise a drink inside a meal, which opens the meal.
   */
  standalone: boolean;
  /** The drink's name and emoji ("Water" 💧, "Coffee" ☕). */
  name: string;
  emoji: string;
  /** Millilitres of water it adds to the day (lib/meals/hydration.ts: alcohol counts 0). */
  waterMl: number;
  /** For a drink inside a meal: the meal's title, or its slot's name ("Lunch"). */
  mealTitle: string | null;
};

/** Changes to water added on its own: the amount, and the time with its zone. */
export type WaterPatch = { ml?: number; eatenAt?: string; tz?: string };
