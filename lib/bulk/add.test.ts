import { describe, expect, it } from "vitest";

import { addToBatch, addToMeal } from "./add";
import type { SortPhoto } from "./group";
import { bulkReducer, initBulk, mealEdited, mealHasNoTime, type BulkState } from "./moves";
import { BULK } from "./rules";
import type { PhotoSignature } from "./signature";

// Made-up photos two days ago (UTC); the sorting never looks at the clock.
const DAY = (() => {
  const now = new Date();
  return Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - 2);
})();
const at = (h: number, m: number) => DAY + (h * 60 + m) * 60_000;
const FALLBACK = at(12, 0);
const TZ = "UTC";

const look = (bin: number, hash: string): PhotoSignature => {
  const colours = new Array<number>(64).fill(0);
  colours[bin] = 1;
  return { colours, hash };
};
const GREEN = look(20, "00ff00ff00ff00ff");
const GREENISH = look(20, "00ff00ff00ff00fe");
const RED = look(48, "00ff00ff00ff00ff");

const photo = (
  id: string,
  takenAt: number | null,
  signature: PhotoSignature | null = GREEN,
): SortPhoto => ({ id, takenAt, signature });

/** Breakfast 2 photos, lunch 1, a snack 1, dinner 3. */
const base = [
  photo("b1", at(8, 12)),
  photo("b2", at(8, 14)),
  photo("l1", at(12, 47)),
  photo("s1", at(16, 5)),
  photo("d1", at(19, 0)),
  photo("d2", at(19, 1)),
  photo("d3", at(19, 3)),
];
const start = () => initBulk(base, [["b1", "b2"], ["l1"], ["s1"], ["d1", "d2", "d3"]], FALLBACK);
const layout = (state: BulkState) => state.meals.map((m) => m.photoIds);

describe("+ Add on a meal", () => {
  it("puts the photos into that meal while it has room", () => {
    const result = addToMeal(start(), "m2", [photo("n1", at(12, 52)), photo("n2", at(12, 50))], TZ);
    expect(layout(result.state)[1]).toEqual(["l1", "n2", "n1"]);
    expect(result).toMatchObject({ added: 2, left: 0, joined: 2, started: [], into: 2 });
    expect(mealEdited(result.state.meals[1]!)).toBe(true);
    expect(result.state.changed).toBe(true);
    expect(result.state.photos.n1).toMatchObject({ takenAt: at(12, 52), signature: GREEN });
  });

  it("starts a new meal after it with the ones that do not fit, grouped by the rules", () => {
    const result = addToMeal(
      start(),
      "m1",
      [
        photo("n1", at(8, 25)),
        photo("n2", at(8, 16)),
        photo("n3", at(8, 20)),
        photo("n4", at(11, 0)),
      ],
      TZ,
    );
    // The oldest goes in (room for one); 08:20 and 08:25 stay together, 11:00 is its own meal.
    expect(layout(result.state)).toEqual([
      ["b1", "b2", "n2"],
      ["n3", "n1"],
      ["n4"],
      ["l1"],
      ["s1"],
      ["d1", "d2", "d3"],
    ]);
    expect(result).toMatchObject({ added: 4, joined: 1, into: 1, started: ["m5", "m6"] });
    // The new meals count as edited (the person put them there).
    expect(mealEdited(result.state.meals[1]!)).toBe(true);
  });

  it("gives photos with no time that do not fit the meal's time, right after it", () => {
    const result = addToMeal(
      start(),
      "m4",
      [photo("x1", null, GREEN), photo("x2", null, GREENISH)],
      TZ,
    );
    expect(result.into).toBe(0);
    // Alike, so one meal, at the dinner's time and after it (not at 12:00).
    expect(layout(result.state).at(-1)).toEqual(["x1", "x2"]);
    const meal = result.state.meals.at(-1)!;
    expect(meal.at).toBe(at(19, 0));
    expect(mealHasNoTime(result.state, meal)).toBe(true);
  });

  it("sorts into the batch when the meal is gone", () => {
    const moved = bulkReducer(start(), { type: "move", ids: ["l1"], to: "m3" });
    const result = addToMeal(moved, "m2", [photo("n1", at(21, 0))], TZ);
    expect(result.into).toBeNull();
    expect(layout(result.state).at(-1)).toEqual(["n1"]);
  });

  it("keeps the batch at 30 photos across adds, the first ones by time", () => {
    const many = Array.from({ length: 28 }, (_, i) => photo(`p${i}`, at(6, 0) + i * 2 * 3_600_000));
    let state = initBulk(
      many,
      many.map((p) => [p.id]),
      FALLBACK,
    );
    const first = addToMeal(
      state,
      state.meals[0]!.id,
      [photo("n3", at(6, 9)), photo("n1", at(6, 5)), photo("n2", at(6, 7))],
      TZ,
    );
    expect(first).toMatchObject({ added: 2, left: 1 });
    expect(Object.keys(first.state.photos)).toHaveLength(BULK.maxPhotos);
    expect(first.state.meals[0]!.photoIds).toEqual(["p0", "n1", "n2"]);
    state = first.state;
    const second = addToBatch(state, [photo("n4", at(6, 1))], TZ);
    expect(second).toMatchObject({ added: 0, left: 1, joined: 0, started: [] });
    expect(second.state).toBe(state);
  });
});

describe("More photos for the batch", () => {
  it("sorts into the meals nobody edited as the rules would, else new meals", () => {
    const result = addToBatch(
      start(),
      [photo("n1", at(12, 50)), photo("n2", at(21, 30)), photo("n3", at(16, 9))],
      TZ,
    );
    expect(layout(result.state)).toEqual([
      ["b1", "b2"],
      ["l1", "n1"],
      ["s1", "n3"],
      ["d1", "d2", "d3"],
      ["n2"],
    ]);
    expect(result).toMatchObject({ added: 3, joined: 2, into: null });
    expect(result.started).toHaveLength(1);
    // Breakfast and dinner kept their ids; nothing counts as moved by the person.
    expect(result.state.meals[0]!.id).toBe("m1");
    expect(result.state.meals[3]!.id).toBe("m4");
    expect(result.state.changed).toBe(false);
  });

  it("adds to a meal the person edited only where the rules allow, never regrouping it", () => {
    let state = bulkReducer(start(), { type: "note", mealId: "m2", note: "A salad" });
    state = bulkReducer(state, { type: "cover", mealId: "m4", id: "d3" });
    const result = addToBatch(
      state,
      [
        // Close to the salad and alike: joins it, and the meal's time follows it (12:40).
        photo("n1", at(12, 40)),
        // Near the full dinner: a meal of its own (the dinner keeps its photos and cover).
        photo("n2", at(19, 5)),
        // Minutes after the salad but clearly different: not with it.
        photo("n3", at(12, 58), RED),
      ],
      TZ,
    );
    const lunch = result.state.meals.find((m) => m.id === "m2")!;
    expect(lunch.photoIds).toEqual(["n1", "l1"]);
    expect(lunch.at).toBe(at(12, 40));
    expect(lunch.note).toBe("A salad");
    const dinner = result.state.meals.find((m) => m.id === "m4")!;
    expect(dinner.photoIds).toEqual(["d3", "d1", "d2"]);
    expect(layout(result.state)).toContainEqual(["n2"]);
    expect(layout(result.state)).toContainEqual(["n3"]);
    expect(result).toMatchObject({ joined: 1 });
    expect(result.started).toHaveLength(2);
  });

  it("keeps a time set by hand when earlier photos join", () => {
    let state = bulkReducer(start(), { type: "time", mealId: "m2", at: at(13, 30) });
    state = addToBatch(state, [photo("n1", at(12, 45))], TZ).state;
    const lunch = state.meals.find((m) => m.id === "m2")!;
    expect(lunch.photoIds).toEqual(["n1", "l1"]);
    expect(lunch.at).toBe(at(13, 30));
  });

  it("joins a photo with no time to an edited meal it looks like, else a meal of its own", () => {
    const apple: PhotoSignature = look(48, "0f0f0f0f0f0f0f0f");
    const withApple = initBulk(
      base.map((p) => (p.id === "s1" ? { ...p, signature: apple } : p)),
      [["b1", "b2"], ["l1"], ["s1"], ["d1", "d2", "d3"]],
      FALLBACK,
    );
    const noted = bulkReducer(withApple, { type: "note", mealId: "m3", note: "An apple" });
    const result = addToBatch(
      noted,
      [
        photo("x1", null, look(48, "0f0f0f0f0f0f0f0e")),
        photo("x2", null, look(3, "ff00ff00ff00ff00")),
      ],
      TZ,
    );
    expect(result.state.meals.find((m) => m.id === "m3")!.photoIds).toEqual(["s1", "x1"]);
    const alone = result.state.meals.find((m) => m.photoIds.includes("x2"))!;
    expect(alone.photoIds).toEqual(["x2"]);
    expect(alone.at).toBe(FALLBACK);
  });
});
