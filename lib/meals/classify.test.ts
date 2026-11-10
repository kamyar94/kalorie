import { describe, expect, it } from "vitest";

import { classifyMeal, isLate, type ClassifyItem } from "./classify";
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
    expect(classifyMeal({ items: [food("Rice", 600)], modelType: "brunch", minutes: at(13) })).toBe(
      "lunch",
    );
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
