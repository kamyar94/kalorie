// The meals of "Add photos" while the person checks them (boards 45 to 47): selecting photos,
// moving them to another meal or a new one, removing photos or a meal, a meal's note and time.
// A pure reducer: after every change the meals are put in order again (see `settle`).
//
// - A meal holds at most BULK.perMeal photos: a move that would put more in one is refused
//   (checkMove says why) and changes nothing.
// - A meal left with no photos goes away; the others renumber (their number is their place).
// - A meal's time is its earliest photo's time taken until the person sets one; with no time
//   taken on any of its photos it is the batch's fallback (when the photos were picked, or 12:00
//   of the earlier day the screen was opened for) and the screen asks to check it.
// - Meals are in time order (ties: the older meal first); photos in a meal too (no time last).
import { BULK } from "./rules";

export type BulkPhotoInfo = {
  /** Time taken (ms), null when the photo has none. */
  takenAt: number | null;
  /** Its place in the batch as picked, for ties. */
  order: number;
};

export type BulkMeal = {
  id: string;
  /** Creation order, for ties between meals at the same time. */
  seq: number;
  photoIds: string[];
  /** The meal's time (ms). */
  at: number;
  /** Set by hand in the When sheet: photos moving in or out then leave the time alone. */
  timeSet: boolean;
  note: string;
};

export type BulkState = {
  photos: Record<string, BulkPhotoInfo>;
  meals: BulkMeal[];
  /** Selected photo ids, in the order they were selected. */
  selected: string[];
  /** The time of a meal whose photos have no time taken (ms). */
  fallbackAt: number;
  nextSeq: number;
  /** Whether the person changed the meals Kal found (moved or removed photos). */
  changed: boolean;
};

/** "new" is the New meal zone (or "A new meal" in Move to). */
export type MoveTarget = string | "new";

export type BulkAction =
  | { type: "toggle"; id: string }
  /** Shift or Ctrl on a computer: adds to the selection, never removes. */
  | { type: "select"; id: string }
  | { type: "clear" }
  | { type: "move"; ids: string[]; to: MoveTarget }
  | { type: "remove"; ids: string[] }
  | { type: "remove-meal"; mealId: string }
  | { type: "note"; mealId: string; note: string }
  | { type: "time"; mealId: string; at: number };

export type MoveCheck =
  | { ok: true; ids: string[] }
  | { ok: false; reason: "nothing" }
  /** All the photos are in that meal already. */
  | { ok: false; reason: "same" }
  /** More than a meal holds would end up in it; number is its place (1-based), room what fits. */
  | { ok: false; reason: "full"; number: number; room: number }
  /** A new meal cannot take more than BULK.perMeal photos. */
  | { ok: false; reason: "too-many" };

const byPhotoTime = (photos: Record<string, BulkPhotoInfo>) => (a: string, b: string) => {
  const pa = photos[a];
  const pb = photos[b];
  const ta = pa?.takenAt ?? Infinity;
  const tb = pb?.takenAt ?? Infinity;
  if (ta !== tb) return ta < tb ? -1 : 1;
  return (pa?.order ?? 0) - (pb?.order ?? 0);
};

/** The earliest time taken of some photos, or null when none has one. */
export const earliestTaken = (photos: Record<string, BulkPhotoInfo>, ids: readonly string[]) => {
  let earliest: number | null = null;
  for (const id of ids) {
    const t = photos[id]?.takenAt ?? null;
    if (t !== null && (earliest === null || t < earliest)) earliest = t;
  }
  return earliest;
};

/** Whether the meal's time is only the fallback: no photo of it has a time and none was set. */
export const mealHasNoTime = (state: Pick<BulkState, "photos">, meal: BulkMeal) =>
  !meal.timeSet && earliestTaken(state.photos, meal.photoIds) === null;

/** Puts the meals in order again: empty ones go, times follow the photos, then time order. */
const settle = (state: BulkState): BulkState => {
  const sort = byPhotoTime(state.photos);
  const meals = state.meals
    .map((meal) => ({ ...meal, photoIds: meal.photoIds.filter((id) => id in state.photos) }))
    .filter((meal) => meal.photoIds.length > 0)
    .map((meal) => {
      const photoIds = [...meal.photoIds].sort(sort);
      const at = meal.timeSet
        ? meal.at
        : (earliestTaken(state.photos, photoIds) ?? state.fallbackAt);
      return { ...meal, photoIds, at };
    })
    .sort((a, b) => a.at - b.at || a.seq - b.seq);
  const present = new Set(meals.flatMap((meal) => meal.photoIds));
  return { ...state, meals, selected: state.selected.filter((id) => present.has(id)) };
};

/** The state for the meals Kal found (groupPhotos), before any change. */
export const initBulk = (
  photos: readonly { id: string; takenAt: number | null }[],
  groups: readonly (readonly string[])[],
  fallbackAt: number,
): BulkState => {
  const info: Record<string, BulkPhotoInfo> = {};
  photos.forEach((photo, order) => (info[photo.id] = { takenAt: photo.takenAt, order }));
  const meals = groups.map((photoIds, i) => ({
    id: `m${i + 1}`,
    seq: i + 1,
    photoIds: [...photoIds],
    at: fallbackAt,
    timeSet: false,
    note: "",
  }));
  return settle({
    photos: info,
    meals,
    selected: [],
    fallbackAt,
    nextSeq: groups.length + 1,
    changed: false,
  });
};

/** Whether photos can move to a meal (by id) or to a new meal, and why not. */
export const checkMove = (state: BulkState, ids: readonly string[], to: MoveTarget): MoveCheck => {
  const moving = [...new Set(ids)].filter((id) => id in state.photos);
  if (!moving.length) return { ok: false, reason: "nothing" };
  if (to === "new")
    return moving.length > BULK.perMeal
      ? { ok: false, reason: "too-many" }
      : { ok: true, ids: moving };
  const index = state.meals.findIndex((meal) => meal.id === to);
  const meal = state.meals[index];
  if (!meal) return { ok: false, reason: "nothing" };
  const incoming = moving.filter((id) => !meal.photoIds.includes(id));
  if (!incoming.length) return { ok: false, reason: "same" };
  if (meal.photoIds.length + incoming.length > BULK.perMeal)
    return {
      ok: false,
      reason: "full",
      number: index + 1,
      room: Math.max(0, BULK.perMeal - meal.photoIds.length),
    };
  return { ok: true, ids: incoming };
};

export const bulkReducer = (state: BulkState, action: BulkAction): BulkState => {
  switch (action.type) {
    case "toggle":
      if (!(action.id in state.photos)) return state;
      return {
        ...state,
        selected: state.selected.includes(action.id)
          ? state.selected.filter((id) => id !== action.id)
          : [...state.selected, action.id],
      };
    case "select":
      if (!(action.id in state.photos) || state.selected.includes(action.id)) return state;
      return { ...state, selected: [...state.selected, action.id] };
    case "clear":
      return state.selected.length ? { ...state, selected: [] } : state;
    case "move": {
      const check = checkMove(state, action.ids, action.to);
      if (!check.ok) return state;
      const moving = new Set(check.ids);
      const meals = state.meals.map((meal) => ({
        ...meal,
        photoIds: meal.photoIds.filter((id) => !moving.has(id)),
      }));
      let nextSeq = state.nextSeq;
      if (action.to === "new") {
        meals.push({
          id: `m${nextSeq}`,
          seq: nextSeq,
          photoIds: check.ids,
          at: state.fallbackAt,
          timeSet: false,
          note: "",
        });
        nextSeq += 1;
      } else {
        const target = meals.find((meal) => meal.id === action.to)!;
        target.photoIds = [...target.photoIds, ...check.ids];
      }
      return settle({ ...state, meals, nextSeq, selected: [], changed: true });
    }
    case "remove": {
      const removing = new Set(action.ids.filter((id) => id in state.photos));
      if (!removing.size) return state;
      const photos = Object.fromEntries(
        Object.entries(state.photos).filter(([id]) => !removing.has(id)),
      );
      return settle({ ...state, photos, changed: true });
    }
    case "remove-meal": {
      const meal = state.meals.find((m) => m.id === action.mealId);
      if (!meal) return state;
      return bulkReducer(state, { type: "remove", ids: meal.photoIds });
    }
    case "note":
      return {
        ...state,
        meals: state.meals.map((meal) =>
          meal.id === action.mealId ? { ...meal, note: action.note } : meal,
        ),
      };
    case "time":
      if (!Number.isFinite(action.at)) return state;
      return settle({
        ...state,
        meals: state.meals.map((meal) =>
          meal.id === action.mealId ? { ...meal, at: action.at, timeSet: true } : meal,
        ),
      });
  }
};

/** The photo ids of the batch in the order shown: meal by meal. */
export const shownPhotoIds = (state: BulkState) => state.meals.flatMap((meal) => meal.photoIds);
