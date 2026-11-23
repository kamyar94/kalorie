// "What should I eat?" arithmetic (lib/suggest/compute.ts): what is left today, the pattern window
// around now, the size that suits now, the ranking (open protein and fiber, the limits, recency,
// favorites and how often, never more than what is left), and the words. Values are made up.
import { describe, expect, it } from "vitest";

import type { MealSlot } from "@/lib/contracts/meals";
import type { NutrientCode, NutrientMap } from "@/lib/contracts/nutrients";
import type { NutrientTarget } from "@/lib/contracts/targets";
import type { EatingPatternDto, LeftTodayDto } from "@/lib/contracts/suggest";

import {
  badgeFor,
  balancedIdea,
  candidateKey,
  eatingPattern,
  introFor,
  leftToday,
  noteFor,
  rankCandidates,
  sizeNow,
  SUGGEST,
  type Candidate,
  type PatternMeal,
} from "./compute";

const t = (code: string, target: number, kind: NutrientTarget["kind"] = "min") =>
  [code, { code, target, upper: null, kind, custom: false, basis: "dri" }] as const;
const TARGETS = Object.fromEntries([
  t("energy", 2000, "goal"),
  t("protein", 100),
  t("fiber", 30),
  t("sodium", 2000, "max"),
  t("fat_sat", 20, "max"),
  t("sugars_added", 50, "max"),
]) as Partial<Record<NutrientCode, NutrientTarget>>;

const hm = (time: string) => {
  const [h, m] = time.split(":").map(Number);
  return h! * 60 + m!;
};

const ate = (
  localDate: string,
  time: string,
  energy: number,
  slot: MealSlot = "lunch",
  food = true,
): PatternMeal => ({ localDate, minutes: hm(time), slot, energy, food });

describe("left today", () => {
  it("is each target minus what was eaten, never below zero for the nutrients", () => {
    const left = leftToday(
      { energy: 880, protein: 48, fiber: 16, sodium: 1100, fat_sat: 25, sugars_added: 10 },
      TARGETS,
      1,
    );
    expect(left).toEqual({
      energyTarget: 2000,
      eaten: 880,
      energyLeft: 1120,
      protein: 52,
      fiber: 14,
      limits: [
        { code: "sodium", limit: 2000, room: 900 },
        { code: "fat_sat", limit: 20, room: 0 },
        { code: "sugars_added", limit: 50, room: 40 },
      ],
      pending: 1,
    });
    // Over the energy target: below zero, so "kcal over".
    expect(leftToday({ energy: 2300, protein: 130 }, TARGETS).energyLeft).toBe(-300);
    expect(leftToday({ energy: 2300, protein: 130 }, TARGETS).protein).toBe(0);
  });

  it("counts unknown amounts as nothing eaten, and leaves out nutrients without a target", () => {
    const left = leftToday({}, { energy: TARGETS.energy });
    expect(left.energyLeft).toBe(2000);
    expect(left.protein).toBeNull();
    expect(left.limits).toEqual([]);
    // No energy target: the day is taken as 2,000 kcal.
    expect(leftToday({ energy: 500 }, {}).energyLeft).toBe(1500);
  });
});

describe("the pattern around now", () => {
  const days = ["2026-11-01", "2026-11-02", "2026-11-03", "2026-11-04"];
  const meals = [
    ...days.map((d) => ate(d, "08:00", 400, "breakfast")),
    ate(days[0]!, "12:00", 500),
    ate(days[1]!, "13:30", 700),
    ate(days[2]!, "14:30", 650), // exactly 90 minutes after 13:00
    ate(days[3]!, "14:31", 900), // a minute outside the window
    ...days.map((d) => ate(d, "19:30", 800, "dinner")),
    ate(days[0]!, "13:10", 150, "drink", false), // a drink on its own is no meal around now
  ];

  it("reads the meals within 90 minutes either side, both ends included", () => {
    const p = eatingPattern(meals, hm("13:00"));
    expect(p.days).toBe(4);
    expect(p.enough).toBe(true);
    expect(p.usualSlot).toBe("lunch");
    // 500, 700 and 650 on three of four days: the median 650.
    expect(p.usualKcal).toBe(650);
    expect(p.often).toBe(0.75);
    // From 13:00: lunches at 13:30, 14:30, 14:31 and four dinners, the 13:10 drink: per day.
    expect(p.after).toBe(Math.round((700 + 650 + 900 + 4 * 800 + 150) / 4));
    // After the window (from 14:31): the 14:31 lunch and the dinners.
    expect(p.afterWindow).toBe(Math.round((900 + 4 * 800) / 4));
  });

  it("adds the meals of one day in the window, and goes round midnight", () => {
    const late = [
      ate("2026-11-01", "23:30", 300, "snack"),
      ate("2026-11-01", "00:20", 200, "snack"),
      ate("2026-11-02", "23:50", 250, "snack"),
      ate("2026-11-03", "21:00", 900, "dinner"),
    ];
    const p = eatingPattern(late, hm("23:45"));
    // 23:30 and 00:20 on the 1st (500), 23:50 on the 2nd (250): median 375.
    expect(p.usualKcal).toBe(375);
    expect(p.usualSlot).toBe("snack");
    expect(p.often).toBeCloseTo(2 / 3);
  });

  it("names the most common meal, the latest on a tie", () => {
    const tie = [
      ate("2026-11-01", "16:00", 200, "snack"),
      ate("2026-11-02", "16:30", 600, "dinner"),
      ate("2026-11-03", "09:00", 400, "breakfast"),
    ];
    expect(eatingPattern(tie, hm("16:15")).usualSlot).toBe("dinner");
  });

  it("is too little under three logged days, and empty without meals", () => {
    const p = eatingPattern(
      [ate("2026-11-01", "12:00", 500), ate("2026-11-02", "12:30", 600)],
      720,
    );
    expect(p.enough).toBe(false);
    expect(p.days).toBe(2);
    expect(eatingPattern([], 720)).toEqual({
      days: 0,
      enough: false,
      usualSlot: null,
      usualKcal: null,
      often: 0,
      after: 0,
      afterWindow: 0,
    });
    expect(SUGGEST.minPatternDays).toBe(3);
    expect(SUGGEST.windowMinutes).toBe(90);
    expect(SUGGEST.patternDays).toBe(28);
  });
});

describe("the size that suits now", () => {
  const left = (energyLeft: number) => ({ energyLeft, energyTarget: 2000 });
  const pattern = (usualKcal: number | null, afterWindow: number, enough = true) => ({
    enough,
    usualKcal,
    afterWindow,
  });

  it("is the usual size when there is room for it and what usually comes after", () => {
    expect(sizeNow(left(1400), pattern(600, 800), "lunch")).toBe(600);
  });

  it("is scaled down when what is left is less than the meal plus what comes after", () => {
    // 700 left of a usual 600 + 800: 600 x 700 / 1,400.
    expect(sizeNow(left(700), pattern(600, 800), "lunch")).toBe(300);
  });

  it("is never more than what is left, and nothing once the day's energy is reached", () => {
    expect(sizeNow(left(400), pattern(600, 0), "lunch")).toBe(400);
    expect(sizeNow(left(0), pattern(600, 0), "lunch")).toBe(0);
    expect(sizeNow(left(-200), pattern(600, 0), "lunch")).toBe(0);
  });

  it("uses the middle of the meal name's band without a pattern", () => {
    expect(sizeNow(left(2000), pattern(null, 0, false), "lunch")).toBe(600);
    expect(sizeNow(left(2000), pattern(600, 900, false), "snack")).toBe(200);
    expect(sizeNow(left(2000), pattern(null, 0, true), "breakfast")).toBe(500);
  });
});

const NOW = new Date("2026-11-20T12:00:00Z");
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 86_400_000);

const candidate = (id: string, totals: NutrientMap, extra: Partial<Candidate> = {}): Candidate => ({
  mealId: id,
  title: id,
  slot: "lunch",
  totals,
  favorite: false,
  times: 1,
  lastAt: daysAgo(10),
  score: 70,
  ...extra,
});

const LEFT: LeftTodayDto = leftToday(
  { energy: 880, protein: 48, fiber: 16, sodium: 1100, fat_sat: 5, sugars_added: 10 },
  TARGETS,
);
const PATTERN: EatingPatternDto = {
  days: 20,
  enough: true,
  usualSlot: "lunch",
  usualKcal: 600,
  often: 0.9,
  after: 900,
};
const CTX = { now: NOW, left: LEFT, pattern: PATTERN, size: 600 };

describe("ranking", () => {
  it("prefers the meal that fills the open protein and fiber at the usual size", () => {
    const ranked = rankCandidates(
      [
        candidate("pasta", { energy: 600, protein: 12, fiber: 3, sodium: 300 }),
        candidate("chicken salad", { energy: 580, protein: 34, fiber: 9, sodium: 300 }),
        candidate("big curry", { energy: 1000, protein: 40, fiber: 10, sodium: 300 }),
      ],
      CTX,
    );
    expect(ranked.map((r) => r.mealId)).toEqual(["chicken salad", "pasta", "big curry"]);
    expect(ranked[0]!.reason).toBe(
      "Covers 34 g of the 52 g protein you still need; fits your usual 600 kcal lunch.",
    );
  });

  it("never suggests more than what is left today", () => {
    const ranked = rankCandidates(
      [
        candidate("feast", { energy: 1200, protein: 60, fiber: 15 }),
        candidate("soup", { energy: 450, protein: 20, fiber: 8 }),
      ],
      CTX,
    );
    expect(ranked.map((r) => r.mealId)).toEqual(["soup"]);
    expect(
      rankCandidates([candidate("soup", { energy: 450 })], {
        ...CTX,
        left: { ...LEFT, energyLeft: 0 },
      }),
    ).toEqual([]);
    expect(rankCandidates([candidate("nothing", {})], CTX)).toEqual([]);
  });

  it("keeps under the room left by the limits", () => {
    const ranked = rankCandidates(
      [
        candidate("salty", { energy: 600, protein: 30, fiber: 8, sodium: 1000 }),
        candidate("plain", { energy: 600, protein: 30, fiber: 8, sodium: 300 }),
        candidate("near", { energy: 600, protein: 30, fiber: 8, sodium: 650 }),
      ],
      CTX,
    );
    expect(ranked.map((r) => r.mealId)).toEqual(["plain", "near", "salty"]);
    // 1,000 mg is over the 900 mg left; 650 is over this meal's part of it (900 x 600 / 1,120).
    expect(ranked[2]!.parts.limits).toBeLessThan(ranked[1]!.parts.limits);
    expect(ranked[2]!.reason).toContain("sodium would go over today's limit");
    expect(ranked[1]!.reason).toContain(
      "sodium near its share of what is left, so keep the rest of the day light",
    );
  });

  it("spaces out a meal had in the last two days", () => {
    const totals = { energy: 600, protein: 30, fiber: 8 };
    const ranked = rankCandidates(
      [
        candidate("yesterday", totals, { lastAt: daysAgo(1) }),
        candidate("last week", totals, { lastAt: daysAgo(7) }),
        candidate("just under two days", totals, {
          lastAt: new Date(NOW.getTime() - 47 * 3_600_000),
        }),
      ],
      CTX,
    );
    expect(ranked.map((r) => r.mealId)).toEqual(["last week", "yesterday", "just under two days"]);
    expect(ranked[1]!.parts.recent).toBe(SUGGEST.weights.recent);
    expect(ranked[0]!.parts.recent).toBe(0);
  });

  it("gives a favorite and a meal had often a bonus, capped", () => {
    const totals = { energy: 600, protein: 30, fiber: 8 };
    const ranked = rankCandidates(
      [
        candidate("once", totals, { lastAt: daysAgo(3) }),
        candidate("favorite", totals, { favorite: true, lastAt: daysAgo(4) }),
        candidate("often", totals, { times: 3, lastAt: daysAgo(5) }),
        candidate("very often", totals, { times: 30, lastAt: daysAgo(6) }),
      ],
      CTX,
    );
    expect(ranked.map((r) => r.mealId)).toEqual(["favorite", "very often", "often", "once"]);
    expect(ranked.find((r) => r.mealId === "often")!.parts.bonus).toBeCloseTo(0.04);
    expect(ranked.find((r) => r.mealId === "very often")!.parts.bonus).toBe(
      SUGGEST.weights.oftenMax,
    );
  });

  it("counts the balance score, a meal without one as middling", () => {
    const totals = { energy: 600, protein: 30, fiber: 8 };
    const ranked = rankCandidates(
      [
        candidate("low", totals, { score: 20 }),
        candidate("unknown", totals, { score: null }),
        candidate("high", totals, { score: 95 }),
      ],
      CTX,
    );
    expect(ranked.map((r) => r.mealId)).toEqual(["high", "unknown", "low"]);
  });

  it("asks less of a small meal when protein is already met", () => {
    const left = leftToday({ energy: 1700, protein: 120, fiber: 30 }, TARGETS);
    const ranked = rankCandidates(
      [candidate("fruit", { energy: 150, protein: 1, fiber: 4 }, { slot: "snack" })],
      { now: NOW, left, pattern: { ...PATTERN, usualSlot: "snack", usualKcal: 200 }, size: 200 },
    );
    expect(ranked[0]!.parts.fill).toBe(1);
    expect(ranked[0]!.reason).toBe("A bit smaller than your usual snack.");
  });

  it("speaks of the size that suits now when the usual size was scaled down", () => {
    const left = leftToday({ energy: 1600 }, TARGETS);
    const ranked = rankCandidates([candidate("wrap", { energy: 300 })], {
      now: NOW,
      left,
      pattern: PATTERN,
      size: 300,
    });
    expect(ranked[0]!.reason).toBe("Fits the 300 kcal that suits now.");
  });
});

describe("words", () => {
  it("labels the best fit, then favorites, then meals had more than once", () => {
    expect(badgeFor({ favorite: true, times: 4 }, 0)).toBe("Best fit");
    expect(badgeFor({ favorite: true, times: 4 }, 1)).toBe("Favorite");
    expect(badgeFor({ favorite: false, times: 3 }, 2)).toBe("Had 3 times");
    expect(badgeFor({ favorite: false, times: 1 }, 2)).toBeNull();
  });

  it("introduces now with the usual meal and what usually comes after", () => {
    expect(introFor("13:05", PATTERN)).toBe(
      "It is 13:05. You usually have lunch now, about 600 kcal, and eat about 900 kcal more after this hour.",
    );
    expect(introFor("16:10", { ...PATTERN, usualSlot: "snack", usualKcal: 183 })).toBe(
      "It is 16:10. You usually have a snack now, about 180 kcal, and eat about 900 kcal more after this hour.",
    );
    expect(introFor("22:40", { ...PATTERN, after: 20 })).toBe(
      "It is 22:40. You usually have lunch now, about 600 kcal, and usually eat nothing more after this hour.",
    );
    expect(introFor("15:40", { ...PATTERN, usualSlot: null, usualKcal: null, after: 720 })).toBe(
      "It is 15:40. You do not usually eat around now, and eat about 700 kcal more after this hour.",
    );
    expect(introFor("15:40", { ...PATTERN, often: 0.2 })).toContain(
      "You do not usually eat around now",
    );
    expect(introFor("13:05", { ...PATTERN, enough: false, days: 1 })).toBe(
      "It is 13:05. Kal needs a few more days of meals to learn when and how much you usually eat.",
    );
  });

  it("notes the day's energy reached, nothing small enough, and meals still worked out", () => {
    const over = leftToday({ energy: 2100 }, TARGETS);
    expect(noteFor(over, 0, 5)).toBe(
      "You have eaten today's 2,000 kcal; anything more goes over it.",
    );
    const little = leftToday({ energy: 1880 }, TARGETS, 2);
    expect(noteFor(little, 0, 5)).toBe(
      "Nothing you have had fits in the 120 kcal left today. 2 meals are still being worked out and not counted yet.",
    );
    expect(noteFor(leftToday({}, TARGETS, 1), 3, 5)).toBe(
      "One meal is still being worked out and not counted yet.",
    );
    expect(noteFor(leftToday({}, TARGETS), 3, 5)).toBeNull();
    expect(noteFor(leftToday({}, TARGETS), 0, 0)).toBeNull();
  });

  it("makes a balanced idea from the targets alone", () => {
    expect(balancedIdea(LEFT, 600)).toEqual({
      energy: 600,
      protein: 28,
      fiber: 8,
      sodium: 480,
      text: "About 600 kcal with at least 28 g protein and 8 g fiber, under 480 mg sodium. For example, a plate that is half vegetables, a quarter protein (fish, eggs, beans or lean meat) and a quarter whole grains.",
    });
    expect(balancedIdea(LEFT, 0)).toBeNull();
  });

  it("treats the same foods in any order as one meal", () => {
    expect(candidateKey("Lunch", ["Rice", "chicken ", "rice"])).toBe("chicken|rice");
    expect(candidateKey("Dinner", ["Chicken", "Rice"])).toBe("chicken|rice");
    expect(candidateKey("Toast", [])).toBe("title:toast");
  });
});
