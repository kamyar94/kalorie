import { describe, expect, it } from "vitest";

import {
  brunchTime,
  classifyDay,
  classifyMeal,
  isLate,
  saysBrunch,
  type ClassifyItem,
  type DayMeal,
} from "./classify";
import type { MealWindows } from "./time";

const at = (h: number, m = 0) => h * 60 + m;
const food = (name: string, energy: number): ClassifyItem => ({ name, kind: "dish", energy });
const drink = (name: string, energy = 0): ClassifyItem => ({ name, kind: "drink", energy });

describe("classifyMeal", () => {
  it("names a meal of drinks only a drink, whatever the time and the model say", () => {
    expect(classifyMeal({ items: [drink("Coffee", 4)], minutes: at(10, 40) })).toBe("drink");
    expect(
      classifyMeal({
        items: [drink("Tea"), { name: "Water", kind: "ingredient", energy: 0 }],
        modelType: "breakfast",
        minutes: at(8),
      }),
    ).toBe("drink");
    // The model's "drink" for a plate with food does not stick.
    expect(
      classifyMeal({
        items: [food("Toast", 300), drink("Tea")],
        modelType: "drink",
        minutes: at(8),
      }),
    ).toBe("breakfast");
  });

  it("takes the model's judgment for food", () => {
    for (const type of ["snack", "supper", "dessert", "lunch"] as const)
      expect(classifyMeal({ items: [food("Cake", 400)], modelType: type, minutes: at(13) })).toBe(
        type,
      );
    // Not a slot: the rules decide.
    expect(
      classifyMeal({ items: [food("Rice", 600)], modelType: "elevenses", minutes: at(13) }),
    ).toBe("lunch");
  });

  it("uses the windows for main meals and calls a small bite a snack", () => {
    expect(classifyMeal({ items: [food("Eggs", 410)], minutes: at(8, 10) })).toBe("breakfast");
    // A small breakfast stays breakfast.
    expect(classifyMeal({ items: [food("Toast", 150)], minutes: at(8) })).toBe("breakfast");
    expect(classifyMeal({ items: [food("Rice and chicken", 567)], minutes: at(13, 20) })).toBe(
      "lunch",
    );
    expect(classifyMeal({ items: [food("Apple", 95)], minutes: at(13) })).toBe("snack");
    expect(classifyMeal({ items: [food("Apple", 95)], minutes: at(16, 30) })).toBe("snack");
    expect(classifyMeal({ items: [food("Stew", 700)], minutes: at(19) })).toBe("dinner");
    // Between lunch and dinner, a plate is still a snack by the rules.
    expect(classifyMeal({ items: [food("Pasta", 500)], minutes: at(16) })).toBe("snack");
  });

  it("calls real food after the dinner window and before 04:00 supper", () => {
    expect(classifyMeal({ items: [food("Yogurt and honey", 260)], minutes: at(22, 40) })).toBe(
      "supper",
    );
    expect(classifyMeal({ items: [food("Pizza", 800)], minutes: at(1, 30) })).toBe("supper");
    expect(classifyMeal({ items: [food("Biscuit", 80)], minutes: at(23) })).toBe("snack");
    // 04:00 starts the breakfast window.
    expect(classifyMeal({ items: [food("Eggs", 300)], minutes: at(4) })).toBe("breakfast");
  });

  it("keeps the time window while there are no items yet", () => {
    expect(classifyMeal({ items: [], minutes: at(13) })).toBe("lunch");
    expect(classifyMeal({ items: [], minutes: at(23) })).toBe("snack");
  });

  it("follows the person's own windows", () => {
    const late: MealWindows = {
      breakfast: ["07:00", "11:00"],
      lunch: ["12:00", "16:00"],
      dinner: ["19:00", "23:00"],
    };
    expect(classifyMeal({ items: [food("Stew", 600)], minutes: at(22, 30), windows: late })).toBe(
      "dinner",
    );
    expect(isLate(at(22, 30), late)).toBe(false);
    expect(isLate(at(23, 30), late)).toBe(true);
  });
});

describe("brunch", () => {
  const plate = [food("Eggs, toast and salad", 640)];
  const brunchAt = (minutes: number, extra: Partial<Parameters<typeof classifyMeal>[0]> = {}) =>
    classifyMeal({ items: plate, minutes, ...extra });

  it("is the day's first main meal from 10:00 to 12:30 with the default windows", () => {
    expect(brunchTime()).toEqual({ from: at(10), to: at(12, 30) });
    expect(brunchAt(at(9, 59))).toBe("breakfast");
    expect(brunchAt(at(10))).toBe("brunch");
    // In the breakfast window, between the windows and in the lunch window.
    expect(brunchAt(at(10, 15))).toBe("brunch");
    expect(brunchAt(at(10, 45))).toBe("brunch");
    expect(brunchAt(at(12, 10))).toBe("brunch");
    expect(brunchAt(at(12, 30))).toBe("brunch");
    expect(brunchAt(at(12, 31))).toBe("lunch");
    // Exactly SNACK_KCAL is a main meal.
    expect(classifyMeal({ items: [food("Bagel", 250)], minutes: at(11, 30) })).toBe("brunch");
  });

  it("follows the person's own meal windows", () => {
    const late: MealWindows = {
      breakfast: ["07:00", "11:00"],
      lunch: ["12:00", "16:00"],
      dinner: ["19:00", "23:00"],
    };
    expect(brunchTime(late)).toEqual({ from: at(10, 30), to: at(13, 30) });
    expect(brunchAt(at(10, 29), { windows: late })).toBe("breakfast");
    expect(brunchAt(at(10, 30), { windows: late })).toBe("brunch");
    expect(brunchAt(at(13, 30), { windows: late })).toBe("brunch");
    expect(brunchAt(at(13, 31), { windows: late })).toBe("lunch");
    // 10:15 is brunch by default, breakfast with these windows.
    expect(brunchAt(at(10, 15), { windows: late })).toBe("breakfast");
    const early: MealWindows = {
      breakfast: ["05:00", "08:00"],
      lunch: ["10:00", "13:00"],
      dinner: ["17:00", "20:00"],
    };
    expect(brunchTime(early)).toEqual({ from: at(7, 30), to: at(11, 30) });
    expect(brunchAt(at(11, 45), { windows: early })).toBe("lunch");
    // Windows that cannot be read give no brunch time; the windows still name the meal.
    const broken = { ...early, breakfast: ["early", "late"] } as unknown as MealWindows;
    expect(brunchTime(broken)).toBeNull();
    expect(brunchAt(at(11), { windows: broken })).toBe("lunch");
  });

  it("is not the meal after a breakfast or another main meal of the day", () => {
    for (const earlier of [["breakfast"], ["brunch"], ["drink", "breakfast"], ["lunch"]] as const)
      expect(brunchAt(at(11, 30), { earlier })).toBe("lunch");
    // A breakfast earlier makes a meal between the windows a snack, as before.
    expect(brunchAt(at(10, 45), { earlier: ["breakfast"] })).toBe("snack");
    // Drinks, snacks, desserts and a night's supper do not make a main meal.
    expect(
      brunchAt(at(11, 30), { earlier: ["supper", "drink", "snack", "dessert", "snack"] }),
    ).toBe("brunch");
  });

  it("needs a main meal: small meals and drinks alone are not a brunch", () => {
    expect(classifyMeal({ items: [food("Apple", 95)], minutes: at(11, 30) })).toBe("snack");
    expect(classifyMeal({ items: [food("Toast", 249)], minutes: at(10, 15) })).toBe("breakfast");
    expect(classifyMeal({ items: [food("Toast", 249)], minutes: at(10, 45) })).toBe("snack");
    expect(
      classifyMeal({
        items: [drink("Latte", 190), drink("Orange juice", 110)],
        modelType: "brunch",
        minutes: at(11),
      }),
    ).toBe("drink");
    // Items without energy count as 0 kcal.
    expect(
      classifyMeal({ items: [{ name: "Salad", kind: "dish", energy: null }], minutes: at(11, 30) }),
    ).toBe("snack");
  });

  it("is what the person's words or the title say, whatever the time and the day", () => {
    expect(saysBrunch(["Brunch: eggs, toast and salad"])).toBe(true);
    expect(saysBrunch([null, "Sunday BRUNCH with friends"])).toBe(true);
    expect(saysBrunch(["برانچ با دوستان"])).toBe(true);
    expect(saysBrunch(["lunch", "a late breakfast", undefined])).toBe(false);
    expect(brunchAt(at(19), { words: [null, "Brunch: eggs, toast and salad"] })).toBe("brunch");
    expect(brunchAt(at(11, 30), { words: ["Brunch"], earlier: ["breakfast"] })).toBe("brunch");
    expect(brunchAt(at(13), { words: ["برانچ"], modelType: "lunch" })).toBe("brunch");
    // Even before the analysis has items.
    expect(classifyMeal({ items: [], minutes: at(13), words: ["brunch"] })).toBe("brunch");
    expect(classifyMeal({ items: [], minutes: at(11, 30) })).toBe("lunch");
    // Drinks alone stay a drink.
    expect(classifyMeal({ items: [drink("Mimosa", 90)], minutes: at(11), words: ["Brunch"] })).toBe(
      "drink",
    );
  });

  it("takes the model's brunch only for the day's first main meal", () => {
    expect(brunchAt(at(13, 30), { modelType: "brunch" })).toBe("brunch");
    expect(brunchAt(at(13, 30), { modelType: "brunch", earlier: ["breakfast"] })).toBe("lunch");
    // A small brunch, as the model saw it.
    expect(
      classifyMeal({ items: [food("Pancake", 200)], modelType: "brunch", minutes: at(11) }),
    ).toBe("brunch");
  });

  it("decides between the model's breakfast, brunch and lunch from the day in brunch time", () => {
    expect(brunchAt(at(12, 10), { modelType: "lunch" })).toBe("brunch");
    expect(brunchAt(at(10, 15), { modelType: "breakfast" })).toBe("brunch");
    expect(brunchAt(at(12, 10), { modelType: "lunch", earlier: ["breakfast"] })).toBe("lunch");
    expect(brunchAt(at(10, 15), { modelType: "breakfast", earlier: ["breakfast"] })).toBe(
      "breakfast",
    );
    // Outside brunch time, and for the other types, the model's word stands.
    expect(brunchAt(at(13), { modelType: "lunch" })).toBe("lunch");
    expect(brunchAt(at(9), { modelType: "breakfast" })).toBe("breakfast");
    for (const type of ["snack", "dessert", "dinner", "supper"] as const)
      expect(brunchAt(at(11, 30), { modelType: type })).toBe(type);
  });
});

describe("classifyDay", () => {
  const meal = (minutes: number, items: ClassifyItem[], extra: Partial<DayMeal> = {}): DayMeal => ({
    slot: "snack",
    locked: false,
    items,
    minutes,
    ...extra,
  });
  const brunch = meal(at(11, 30), [food("Eggs, toast and salad", 1119)]);

  it("names the first main meal brunch and a later one in the lunch window lunch", () => {
    expect(classifyDay([meal(at(8), [drink("Coffee", 5)]), brunch])).toEqual(["drink", "brunch"]);
    expect(classifyDay([brunch, meal(at(12, 20), [food("Rice and stew", 700)])])).toEqual([
      "brunch",
      "lunch",
    ]);
  });

  it("turns a brunch into a lunch when a breakfast comes before it, and back without it", () => {
    const breakfast = meal(at(8, 30), [food("Toast", 150)]);
    expect(classifyDay([breakfast, brunch])).toEqual(["breakfast", "lunch"]);
    expect(classifyDay([brunch])).toEqual(["brunch"]);
    // A breakfast moved after it: the earlier meal is the brunch, the later one a lunch.
    expect(classifyDay([brunch, meal(at(12), [food("Toast", 300)])])).toEqual(["brunch", "lunch"]);
  });

  it("keeps slots chosen by hand and counts them as they are", () => {
    // The person called a big late-morning meal a snack: the next meal is the brunch.
    expect(
      classifyDay([
        meal(at(10, 15), [food("Granola", 400)], { slot: "snack", locked: true }),
        meal(at(12, 15), [food("Rice and stew", 700)]),
      ]),
    ).toEqual(["snack", "brunch"]);
    // A breakfast chosen by hand comes first.
    expect(classifyDay([meal(at(10, 5), [], { slot: "breakfast", locked: true }), brunch])).toEqual(
      ["breakfast", "lunch"],
    );
    // A locked lunch stays lunch even as the first main meal in brunch time.
    expect(
      classifyDay([meal(at(11, 30), [food("Soup", 500)], { slot: "lunch", locked: true })]),
    ).toEqual(["lunch"]);
  });

  it("does not count a failed meal without items", () => {
    expect(classifyDay([meal(at(8), [], { slot: "breakfast", counts: false }), brunch])).toEqual([
      "breakfast",
      "brunch",
    ]);
  });

  it("uses the person's windows for the whole day", () => {
    const late: MealWindows = {
      breakfast: ["07:00", "11:00"],
      lunch: ["12:00", "16:00"],
      dinner: ["19:00", "23:00"],
    };
    expect(classifyDay([meal(at(13, 15), [food("Omelette", 500)])], late)).toEqual(["brunch"]);
    expect(classifyDay([meal(at(13, 15), [food("Omelette", 500)])])).toEqual(["lunch"]);
  });
});
