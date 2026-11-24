import { describe, expect, it } from "vitest";

import {
  bulkReducer,
  checkMove,
  initBulk,
  mealHasNoTime,
  shownPhotoIds,
  type BulkAction,
  type BulkState,
} from "./moves";

const MIN = 60_000;
const BASE = Date.now() - 2 * 86_400_000;
const FALLBACK = BASE + 12 * 60 * MIN;

/** Board 45's batch: breakfast 2, lunch 3, a snack 1, dinner 3 (made-up times), and no time. */
const photos = [
  { id: "b1", takenAt: BASE + 8 * 60 * MIN },
  { id: "b2", takenAt: BASE + (8 * 60 + 2) * MIN },
  { id: "l1", takenAt: BASE + 13 * 60 * MIN },
  { id: "l2", takenAt: BASE + (13 * 60 + 1) * MIN },
  { id: "l3", takenAt: BASE + (13 * 60 + 4) * MIN },
  { id: "s1", takenAt: BASE + 16 * 60 * MIN },
  { id: "d1", takenAt: BASE + 19 * 60 * MIN },
  { id: "d2", takenAt: BASE + (19 * 60 + 1) * MIN },
  { id: "d3", takenAt: BASE + (19 * 60 + 6) * MIN },
];
const groups = [["b1", "b2"], ["l1", "l2", "l3"], ["s1"], ["d1", "d2", "d3"]];

const start = () => initBulk(photos, groups, FALLBACK);
const run = (state: BulkState, ...actions: BulkAction[]) => actions.reduce(bulkReducer, state);
const layout = (state: BulkState) => state.meals.map((m) => m.photoIds);

describe("initBulk", () => {
  it("starts each meal at its earliest photo, in time order", () => {
    const state = start();
    expect(layout(state)).toEqual(groups);
    expect(state.meals.map((m) => m.at)).toEqual([
      photos[0]!.takenAt,
      photos[2]!.takenAt,
      photos[5]!.takenAt,
      photos[6]!.takenAt,
    ]);
    expect(state.changed).toBe(false);
    expect(shownPhotoIds(state)).toEqual(photos.map((p) => p.id));
  });

  it("starts a meal with no time taken at the fallback and says so", () => {
    const state = initBulk([...photos, { id: "x1", takenAt: null }], [...groups, ["x1"]], FALLBACK);
    const noTime = state.meals.find((m) => m.photoIds.includes("x1"))!;
    expect(noTime.at).toBe(FALLBACK);
    expect(mealHasNoTime(state, noTime)).toBe(true);
    // 12:00 sorts it between lunch (13:00) and breakfast.
    expect(state.meals.indexOf(noTime)).toBe(1);
    expect(mealHasNoTime(state, state.meals[0]!)).toBe(false);
  });
});

describe("selection", () => {
  it("toggles, adds with Shift or Ctrl, and clears", () => {
    let state = run(start(), { type: "toggle", id: "l2" }, { type: "toggle", id: "l3" });
    expect(state.selected).toEqual(["l2", "l3"]);
    state = run(state, { type: "toggle", id: "l2" });
    expect(state.selected).toEqual(["l3"]);
    state = run(state, { type: "select", id: "l3" }, { type: "select", id: "d1" });
    expect(state.selected).toEqual(["l3", "d1"]);
    expect(run(state, { type: "clear" }).selected).toEqual([]);
    expect(run(state, { type: "toggle", id: "nope" })).toBe(state);
  });
});

describe("moves", () => {
  it("moves one photo to another meal and keeps time order in it", () => {
    const state = run(start(), { type: "move", ids: ["b2"], to: "m3" });
    // The snack's time follows its earliest photo now (08:02), so it is the second meal.
    expect(layout(state)).toEqual([["b1"], ["b2", "s1"], ["l1", "l2", "l3"], ["d1", "d2", "d3"]]);
    expect(state.meals[1]!.at).toBe(photos[1]!.takenAt);
    expect(state.changed).toBe(true);
  });

  it("moves several at once and clears the selection", () => {
    let state = run(start(), { type: "toggle", id: "l2" }, { type: "toggle", id: "l3" });
    state = run(state, { type: "move", ids: state.selected, to: "new" });
    expect(layout(state)).toEqual([["b1", "b2"], ["l1"], ["l2", "l3"], ["s1"], ["d1", "d2", "d3"]]);
    expect(state.selected).toEqual([]);
    expect(state.meals[2]!.at).toBe(photos[3]!.takenAt);
  });

  it("refuses a move into a full meal and changes nothing", () => {
    const state = run(start(), { type: "toggle", id: "s1" });
    expect(checkMove(state, ["s1"], "m4")).toEqual({
      ok: false,
      reason: "full",
      number: 4,
      room: 0,
    });
    expect(run(state, { type: "move", ids: ["s1"], to: "m4" })).toBe(state);
    // Two photos into a meal with room for one.
    expect(checkMove(state, ["l2", "l3"], "m1")).toMatchObject({ reason: "full", room: 1 });
    expect(checkMove(state, ["l3"], "m1")).toEqual({ ok: true, ids: ["l3"] });
  });

  it("counts only the photos that come in, and refuses a move to where they are", () => {
    const state = start();
    expect(checkMove(state, ["b1", "s1"], "m1")).toEqual({ ok: true, ids: ["s1"] });
    expect(checkMove(state, ["b1", "b2"], "m1")).toEqual({ ok: false, reason: "same" });
    expect(checkMove(state, [], "new")).toEqual({ ok: false, reason: "nothing" });
    expect(checkMove(state, ["b1"], "m99")).toEqual({ ok: false, reason: "nothing" });
  });

  it("makes a new meal of at most 3 photos", () => {
    const state = start();
    expect(checkMove(state, ["b1", "b2", "s1"], "new")).toEqual({
      ok: true,
      ids: ["b1", "b2", "s1"],
    });
    expect(checkMove(state, ["b1", "b2", "s1", "d1"], "new")).toEqual({
      ok: false,
      reason: "too-many",
    });
    const moved = run(state, { type: "move", ids: ["d3"], to: "new" });
    expect(layout(moved)).toEqual([["b1", "b2"], ["l1", "l2", "l3"], ["s1"], ["d1", "d2"], ["d3"]]);
    expect(moved.meals.at(-1)!.id).toBe("m5");
  });

  it("removes a meal left with no photos; the rest renumber by place", () => {
    const state = run(start(), { type: "move", ids: ["s1"], to: "m1" });
    expect(layout(state)).toEqual([
      ["b1", "b2", "s1"],
      ["l1", "l2", "l3"],
      ["d1", "d2", "d3"],
    ]);
    // The dinner is the third meal now.
    expect(checkMove(state, ["b1"], "m4")).toMatchObject({ reason: "full", number: 3 });
  });
});

describe("remove", () => {
  it("removes photos, and a whole meal with its note", () => {
    let state = run(
      start(),
      { type: "toggle", id: "l1" },
      { type: "toggle", id: "d1" },
      { type: "note", mealId: "m3", note: "An apple" },
    );
    state = run(state, { type: "remove", ids: state.selected });
    expect(layout(state)).toEqual([["b1", "b2"], ["l2", "l3"], ["s1"], ["d2", "d3"]]);
    expect(state.selected).toEqual([]);
    expect("l1" in state.photos).toBe(false);
    state = run(state, { type: "remove-meal", mealId: "m3" });
    expect(layout(state)).toEqual([
      ["b1", "b2"],
      ["l2", "l3"],
      ["d2", "d3"],
    ]);
    expect(state.meals.some((m) => m.note)).toBe(false);
    expect(run(state, { type: "remove-meal", mealId: "m3" })).toBe(state);
  });
});

describe("note and time", () => {
  it("keeps a note per meal", () => {
    const state = run(start(), { type: "note", mealId: "m1", note: "Oats with banana" });
    expect(state.meals[0]!.note).toBe("Oats with banana");
    expect(state.changed).toBe(false);
  });

  it("sorts by a time set by hand and keeps it when photos move", () => {
    const evening = BASE + 21 * 60 * MIN;
    let state = run(start(), { type: "time", mealId: "m1", at: evening });
    expect(state.meals.map((m) => m.id)).toEqual(["m2", "m3", "m4", "m1"]);
    expect(state.meals.at(-1)!.at).toBe(evening);
    state = run(state, { type: "move", ids: ["l1"], to: "m1" });
    expect(state.meals.at(-1)!.at).toBe(evening);
    expect(state.meals.at(-1)!.photoIds).toEqual(["b1", "b2", "l1"]);
    // A time set by hand also ends the "no time" flag.
    let noTime = initBulk([{ id: "x", takenAt: null }], [["x"]], FALLBACK);
    noTime = run(noTime, { type: "time", mealId: "m1", at: FALLBACK + MIN });
    expect(mealHasNoTime(noTime, noTime.meals[0]!)).toBe(false);
    expect(run(noTime, { type: "time", mealId: "m1", at: Number.NaN })).toBe(noTime);
  });
});
