// The balance score (lib/balance/score.ts): density after NRF9.3 against the person's targets for
// the meal's share of the day, the share's floor, the caps, the limits, portion fit by meal name,
// the weights, the exclusions and the words. Values are made up.
import { describe, expect, it } from "vitest";

import type { MealSlot } from "@/lib/contracts/meals";
import type { NutrientCode, NutrientMap } from "@/lib/contracts/nutrients";
import type { NutrientTarget } from "@/lib/contracts/targets";

import {
  BALANCE,
  balanceOf,
  drinksOnly,
  partAmounts,
  partState,
  portionFit,
  scoreBand,
  scoreLabel,
  timesText,
  type Balance,
} from "./score";

const t = (code: string, target: number | null, kind: NutrientTarget["kind"] = "min") =>
  [code, { code, target, upper: null, kind, custom: false, basis: "dri" }] as const;

/** A day of 2,000 kcal with round targets, so a 10 % meal "should" bring a tenth of each. */
const TARGETS = Object.fromEntries([
  t("energy", 2000, "goal"),
  t("protein", 100),
  t("fiber", 30),
  t("vit_a", 900),
  t("vit_c", 90),
  t("vit_e", 15),
  t("calcium", 1000),
  t("iron", 10),
  t("potassium", 3500),
  t("magnesium", 400),
  t("fat_sat", 20, "max"),
  t("sugars_added", 50, "max"),
  t("sodium", 2000, "max"),
]) as Partial<Record<NutrientCode, NutrientTarget>>;

/** Exactly `factor` times each nutrient's share for a meal of `energy` kcal. */
const even = (energy: number, factor = 1, limits = 0.5): NutrientMap => {
  const share = Math.max(energy / 2000, BALANCE.shareFloor);
  return {
    energy,
    protein: 100 * share * factor,
    fiber: 30 * share * factor,
    vit_a: 900 * share * factor,
    vit_c: 90 * share * factor,
    vit_e: 15 * share * factor,
    calcium: 1000 * share * factor,
    iron: 10 * share * factor,
    potassium: 3500 * share * factor,
    magnesium: 400 * share * factor,
    fat_sat: 20 * share * limits,
    sugars_added: 50 * share * limits,
    sodium: 2000 * share * limits,
  };
};

const judge = (totals: NutrientMap, slot: MealSlot = "lunch", targets = TARGETS) =>
  balanceOf({ totals, slot, status: "ready", drinksOnly: false }, targets);

const judged = (balance: Balance) => {
  if (!balance.judged) throw new Error(`not judged: ${balance.why}`);
  return balance;
};

describe("portion fit", () => {
  it("is 1 inside the band, both ends included", () => {
    expect(portionFit(0.25, "lunch")).toBe(1);
    expect(portionFit(0.3, "lunch")).toBe(1);
    expect(portionFit(0.35, "lunch")).toBe(1);
    expect(portionFit(0.2, "breakfast")).toBe(1);
    expect(portionFit(0.05, "snack")).toBe(1);
    expect(portionFit(0.15, "snack")).toBe(1);
  });

  it("falls linearly to 0 at nothing below the band and at twice its top above", () => {
    expect(portionFit(0.125, "lunch")).toBeCloseTo(0.5);
    expect(portionFit(0, "lunch")).toBe(0);
    expect(portionFit(0.525, "lunch")).toBeCloseTo(0.5);
    expect(portionFit(0.7, "lunch")).toBe(0);
    expect(portionFit(0.9, "dinner")).toBe(0);
    expect(portionFit(0.225, "snack")).toBeCloseTo(0.5);
    expect(portionFit(0.3, "snack")).toBe(0);
  });

  it("has a band for every meal name", () => {
    for (const [slot, [lo, hi]] of Object.entries(BALANCE.bands)) {
      expect(lo, slot).toBeGreaterThan(0);
      expect(hi, slot).toBeGreaterThan(lo);
    }
  });
});

describe("density", () => {
  it("is 1 when every nutrient meets its share and every limit stays within", () => {
    const b = judged(judge(even(600, 1)));
    expect(b.share).toBeCloseTo(0.3);
    expect(b.density).toBeCloseTo(1);
    expect(b.portion).toBe(1);
    expect(b.score).toBe(100);
  });

  it("weighs density 0.7 and portion 0.3", () => {
    expect(BALANCE.weights.density + BALANCE.weights.portion).toBeCloseTo(1);
    expect(BALANCE.weights.density).toBeGreaterThan(BALANCE.weights.portion);
    // Half of every share: density 0.5, the right size: 0.7 x 0.5 + 0.3 = 65.
    expect(judged(judge(even(600, 0.5))).score).toBe(65);
    // Nothing to encourage at all (known zeros): only the portion counts.
    const none = even(600, 0);
    expect(judged(judge(none)).score).toBe(30);
  });

  it("caps each nutrient at its share, so one very rich nutrient cannot hide the others", () => {
    const totals = { ...even(600, 0.5), vit_a: 900 * 0.3 * 20 };
    const b = judged(judge(totals));
    expect(b.encouraged.find((p) => p.code === "vit_a")!.points).toBe(1);
    // Eight at a half, one at a full point: (8 x 0.5 + 1) / 9.
    expect(b.density).toBeCloseTo((8 * 0.5 + 1) / 9);
  });

  it("penalises a limit only above its share: 0 within, a half at 1.5 times, 1 from twice", () => {
    const base = even(600, 1, 1);
    expect(judged(judge(base)).density).toBeCloseTo(1);
    const half = judged(judge({ ...base, sodium: 2000 * 0.3 * 1.5 }));
    expect(half.limited.find((p) => p.code === "sodium")!.penalty).toBeCloseTo(0.5);
    // One of three limits at half its penalty: density x (1 - 0.5 / 3).
    expect(half.density).toBeCloseTo(1 - 0.5 / 3);
    const twice = judged(judge({ ...base, sugars_added: 50 * 0.3 * 2 }));
    expect(twice.limited.find((p) => p.code === "sugars_added")!.penalty).toBe(1);
    const thrice = judged(judge({ ...base, sugars_added: 50 * 0.3 * 3 }));
    expect(thrice.density).toBeCloseTo(twice.density);
    // All three far over: nothing left of the density.
    const all = judged(
      judge({ ...base, sugars_added: 50 * 0.3 * 3, sodium: 2000, fat_sat: 20 * 0.3 * 4 }),
    );
    expect(all.density).toBe(0);
    expect(all.score).toBe(30);
  });

  it("counts an unknown limit as within its share", () => {
    const { sodium: _sodium, ...totals } = even(600, 1);
    const b = judged(judge(totals));
    expect(b.density).toBeCloseTo(1);
    expect(b.limited.find((p) => p.code === "sodium")!.state).toBe("unknown");
  });

  it("averages only the known nutrients to encourage", () => {
    const { vit_e: _e, magnesium: _m, ...totals } = even(600, 1);
    const b = judged(judge(totals));
    expect(b.density).toBeCloseTo(1);
    expect(b.encouraged.filter((p) => p.state === "unknown").map((p) => p.code)).toEqual([
      "vit_e",
      "magnesium",
    ]);
  });

  it("holds a tiny snack to at least 5% of the day", () => {
    const totals: NutrientMap = { ...even(40, 1), energy: 40 };
    const b = judged(judge(totals, "snack"));
    expect(b.share).toBeCloseTo(0.02);
    expect(b.densityShare).toBe(BALANCE.shareFloor);
    // even() already used the floor, so each nutrient meets the 5 % share exactly.
    expect(b.density).toBeCloseTo(1);
    // Under the snack band (5 to 15 %): 0.02 / 0.05 of the portion.
    expect(b.portion).toBeCloseTo(0.4);
    expect(b.shareSentence).toContain("Kal counts at least 5%");
    // Without the floor the same 40 kcal would need only 2 % of each target.
    const thin = judged(judge({ ...even(40, 0.4), energy: 40 }, "snack"));
    expect(thin.density).toBeCloseTo(0.4);
  });
});

describe("a snack against a main meal", () => {
  it("judges both by their own size: the same mix scores the same at the right size", () => {
    const snack = judged(judge(even(200, 0.8), "snack"));
    const lunch = judged(judge(even(600, 0.8), "lunch"));
    expect(snack.density).toBeCloseTo(lunch.density);
    expect(snack.score).toBe(lunch.score);
  });

  it("marks down a snack the size of a lunch, and a lunch the size of a snack", () => {
    const bigSnack = judged(judge(even(600, 0.8), "snack"));
    const smallLunch = judged(judge(even(200, 0.8), "lunch"));
    const lunch = judged(judge(even(600, 0.8), "lunch"));
    expect(bigSnack.portion).toBe(0);
    expect(bigSnack.score).toBeLessThan(lunch.score);
    expect(smallLunch.portion).toBeCloseTo(0.4);
    expect(smallLunch.score).toBeLessThan(lunch.score);
    expect(bigSnack.size).toBe("3 times a usual snack (30% of your day; usually 5 to 15%).");
    expect(smallLunch.size).toBe(
      "Much smaller than a usual lunch (10% of your day; usually 25 to 35%).",
    );
    expect(lunch.size).toBe("Right size for a lunch (30% of your day).");
  });
});

describe("meals that are not judged", () => {
  const ready = even(600);
  it.each([
    ["queued", "analysing"],
    ["analysing", "analysing"],
    ["failed", "failed"],
  ] as const)("a %s meal: %s", (status, why) => {
    expect(balanceOf({ totals: ready, slot: "lunch", status, drinksOnly: false }, TARGETS)).toEqual(
      { judged: false, why },
    );
  });

  it("drinks on their own", () => {
    expect(
      balanceOf({ totals: ready, slot: "drink", status: "ready", drinksOnly: true }, TARGETS),
    ).toEqual({ judged: false, why: "drinks" });
    expect(drinksOnly([{ drink: true }, { drink: true }])).toBe(true);
    expect(drinksOnly([{ drink: true }, { drink: false }])).toBe(false);
    expect(drinksOnly([])).toBe(false);
  });

  it("too few nutrients: no energy, under 20 kcal, or under 5 of the 9 to encourage", () => {
    const { energy: _energy, ...noEnergy } = ready;
    expect(judge(noEnergy)).toEqual({ judged: false, why: "few" });
    expect(judge({ ...ready, energy: 19 })).toEqual({ judged: false, why: "few" });
    expect(judge({ ...ready, energy: 20 }).judged).toBe(true);
    // An AI estimate alone: protein, fiber and sodium.
    expect(judge({ energy: 450, protein: 20, fiber: 4, sodium: 600, sugars: 9 })).toEqual({
      judged: false,
      why: "few",
    });
    const { vit_a: _a, vit_c: _c, vit_e: _e, calcium: _ca, ...fiveKnown } = ready;
    expect(judge(fiveKnown).judged).toBe(true);
    const { iron: _iron, ...fourKnown } = fiveKnown;
    expect(judge(fourKnown)).toEqual({ judged: false, why: "few" });
  });

  it("needs the nutrient to have a target: one set to nothing does not count", () => {
    const targets = { ...TARGETS, vit_a: { ...TARGETS.vit_a!, target: null } };
    const b = judged(judge(ready, "lunch", targets));
    expect(b.encouraged.map((p) => p.code)).not.toContain("vit_a");
  });

  it("takes the day as 2,000 kcal without an energy target", () => {
    const targets = { ...TARGETS, energy: undefined };
    const b = judged(judge(ready, "lunch", targets));
    expect(b.energyTarget).toBe(2000);
    expect(b.share).toBeCloseTo(0.3);
  });
});

describe("words", () => {
  it("says what a good meal brings, and its share", () => {
    const b = judged(judge({ ...even(600, 1, 0.3) }));
    expect(b.reason).toBe("Plenty of protein, fiber and vitamin A; little saturated fat");
    expect(b.shareSentence).toBe(
      "Shares are this meal's part of your daily targets: 600 kcal of 2,000 kcal is 30%, so its protein share is 30% of 100 g.",
    );
  });

  it("puts a limit far over its share first, then the size or what is short", () => {
    const sweet = judged(
      judge({ ...even(300, 0.4), sugars_added: 50 * 0.15 * 3, protein: 0.5, fiber: 0.3 }, "snack"),
    );
    expect(sweet.band).toBe("fair");
    expect(sweet.reason).toBe("Added sugar 3× its share; almost no protein or fiber");
    const big = judged(judge({ ...even(1500, 0.5), sodium: 2000 * 0.75 * 2.4 }, "dinner"));
    expect(big.reason).toBe("Sodium 2.4× its share; twice a usual dinner");
    expect(big.size).toBe("Twice a usual dinner (75% of your day; usually 25 to 35%).");
    const bare = judged(judge(even(600, 0.1)));
    expect(bare.reason).toBe("Little of anything to encourage; little saturated fat");
  });

  it("names what comes close when nothing reaches its full share", () => {
    const b = judged(
      judge({
        ...even(600, 0.8, 0.3),
        protein: 100 * 0.3 * 0.95,
        fiber: 30 * 0.3 * 0.9,
        vit_a: 900 * 0.3 * 0.85,
        vit_c: 90 * 0.3 * 0.5,
      }),
    );
    expect(b.band).toBe("good");
    expect(b.reason).toBe("Good amounts of protein, fiber and vitamin A; little saturated fat");
  });

  it("names a limit a little over its share gently", () => {
    const b = judged(judge({ ...even(600, 1), sodium: 2000 * 0.3 * 1.1 }));
    expect(b.reason).toBe("Plenty of protein, fiber and vitamin A; sodium a little over its share");
  });

  it("gives each nutrient's row and state", () => {
    const b = judged(
      judge({ ...even(600, 1), vit_c: 90 * 0.3 * 0.67, sodium: 2000 * 0.3 * 1.1, fat_sat: 4 }),
    );
    const vitC = b.encouraged.find((p) => p.code === "vit_c")!;
    expect(partState(vitC)).toEqual({ text: "67%", tone: "fair" });
    expect(partAmounts(vitC)).toBe("18 mg of 27 mg");
    const protein = b.encouraged.find((p) => p.code === "protein")!;
    expect(partState(protein)).toEqual({ text: "met", tone: "good" });
    expect(partAmounts(protein)).toBe("30 g of 30 g");
    const sodium = b.limited.find((p) => p.code === "sodium")!;
    expect(partState(sodium)).toEqual({ text: "1.1×", tone: "fair" });
    expect(partAmounts(sodium)).toBe("660 mg, limit 600 mg");
    const fat = b.limited.find((p) => p.code === "fat_sat")!;
    expect(partState(fat)).toEqual({ text: "within", tone: "good" });
    const far = judged(judge({ ...even(600, 1), sodium: 2000 * 0.3 * 2.5 }));
    expect(partState(far.limited.find((p) => p.code === "sodium")!)).toEqual({
      text: "2.5×",
      tone: "low",
    });
  });

  it("bands and labels the score", () => {
    expect(scoreBand(100)).toBe("good");
    expect(scoreBand(70)).toBe("good");
    expect(scoreBand(69)).toBe("fair");
    expect(scoreBand(40)).toBe("fair");
    expect(scoreBand(39)).toBe("low");
    expect(scoreLabel(91)).toBe("Balance score 91 of 100, well balanced");
    expect(scoreLabel(18)).toBe("Balance score 18 of 100, poorly balanced");
    expect(timesText(3)).toBe("3×");
    expect(timesText(2.44)).toBe("2.4×");
  });

  it("writes a share near the band's edge with one decimal", () => {
    const apple = judged(judge({ ...even(92, 1), energy: 92 }, "snack"));
    expect(apple.size).toBe("Smaller than a usual snack (4.6% of your day; usually 5 to 15%).");
  });
});
