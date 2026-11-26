// More photos while sorting ("Add photos", board 48): photos picked from the gallery again after
// the first reading, put into one meal ("+ Add" on its card) or sorted into the whole batch
// ("More photos" in the header). Pure and deterministic, with the numbers of rules.ts and the
// grouping of group.ts.
//
// - The batch holds at most BULK.maxPhotos photos in all, counting every add: past that the first
//   ones by time taken are kept (limitBatch) and the others are left out (the screen says so).
// - Into a meal: as many as it has room for, oldest first (no time last). The others start new
//   meals, grouped among themselves by the same rules; with no time taken such a meal takes the
//   time of the meal they came from, so it sits right after it.
// - Into the batch: a photo whose closest neighbour by time (with no time: the most alike photo,
//   0.8 or more) is in a meal the person edited joins that meal when it has room and the rules
//   would keep them together. The other new photos are grouped again with the photos of the meals
//   nobody edited. A meal the person edited (moves, a note, a time, a cover) is never regrouped:
//   it only gains photos. A meal's time follows its earliest photo unless it was set by hand.
import { localParts } from "@/lib/meals/time";

import { groupPhotos, limitBatch, type SortPhoto } from "./group";
import {
  mealEdited,
  newMeal,
  settleBulk,
  type BulkMeal,
  type BulkPhotoInfo,
  type BulkState,
} from "./moves";
import { BULK } from "./rules";
import { likeness } from "./signature";

const MINUTE = 60_000;

export type AddResult = {
  state: BulkState;
  /** New photos now in the meals. */
  added: number;
  /** New photos left out because the batch is full. */
  left: number;
  /** New photos that went into meals holding photos from before. */
  joined: number;
  /** The meals that hold only new photos (ids), in the order shown. */
  started: string[];
  /** "+ Add": how many went into that meal; null when it was gone (then sorted into the batch). */
  into: number | null;
};

/** Photos the batch has room for (the first by time taken), and how many are left out. */
const keepWithin = (state: BulkState, photos: readonly SortPhoto[]) => {
  const room = Math.max(0, BULK.maxPhotos - Object.keys(state.photos).length);
  const { kept, left } = limitBatch(photos, room);
  const keep = new Set(kept);
  return { kept: photos.filter((photo) => keep.has(photo.id)), left };
};

/** The new photos added to what the batch knows, after the ones already there. */
const register = (known: Record<string, BulkPhotoInfo>, photos: readonly SortPhoto[]) => {
  let order = Math.max(-1, ...Object.values(known).map((photo) => photo.order)) + 1;
  const next = { ...known };
  for (const photo of photos)
    next[photo.id] = { takenAt: photo.takenAt, order: order++, signature: photo.signature };
  return next;
};

/** Oldest first, no time last; ties keep the order picked. */
const byTime = (photos: readonly SortPhoto[]) =>
  photos
    .map((photo, index) => ({ photo, index }))
    .sort(
      (a, b) =>
        (a.photo.takenAt === null ? 1 : 0) - (b.photo.takenAt === null ? 1 : 0) ||
        (a.photo.takenAt ?? 0) - (b.photo.takenAt ?? 0) ||
        a.index - b.index,
    )
    .map(({ photo }) => photo);

/** What the add did, for the screen's message. */
const summary = (before: BulkState, after: BulkState, added: number, left: number) => {
  let joined = 0;
  const started: string[] = [];
  for (const meal of after.meals) {
    const fresh = meal.photoIds.filter((id) => !(id in before.photos)).length;
    if (!fresh) continue;
    if (fresh === meal.photoIds.length) started.push(meal.id);
    else joined += fresh;
  }
  return { state: after, added, left, joined, started };
};

/**
 * "+ Add" on a meal's card: the photos go into that meal up to its room, the others start new
 * meals after it. A meal that is gone by now (its photos moved away) means the whole batch.
 */
export const addToMeal = (
  state: BulkState,
  mealId: string,
  photos: readonly SortPhoto[],
  tz: string,
): AddResult => {
  const meal = state.meals.find((m) => m.id === mealId);
  if (!meal) return { ...addToBatch(state, photos, tz), into: null };
  const { kept, left } = keepWithin(state, photos);
  if (!kept.length) return { state, added: 0, left, joined: 0, started: [], into: 0 };
  const ordered = byTime(kept);
  const room = Math.max(0, BULK.perMeal - meal.photoIds.length);
  const into = ordered.slice(0, room);
  const over = ordered.slice(room);
  let nextSeq = state.nextSeq;
  const meals: BulkMeal[] = state.meals.map((m) =>
    m.id === mealId && into.length
      ? { ...m, photoIds: [...m.photoIds, ...into.map((p) => p.id)], touched: true }
      : m,
  );
  // The order picked among the ones that do not fit, for the grouping's ties.
  const overIds = new Set(over.map((photo) => photo.id));
  for (const group of groupPhotos(
    kept.filter((photo) => overIds.has(photo.id)),
    tz,
  ))
    meals.push(newMeal(nextSeq++, group, state.fallbackAt, { touched: true, anchorAt: meal.at }));
  const after = settleBulk({
    ...state,
    photos: register(state.photos, kept),
    meals,
    nextSeq,
    changed: true,
  });
  return { ...summary(state, after, kept.length, left), into: into.length };
};

/**
 * "More photos": the photos are sorted into the batch as the rules would, without regrouping a
 * meal the person edited (see the top of this file).
 */
export const addToBatch = (
  state: BulkState,
  photos: readonly SortPhoto[],
  tz: string,
): AddResult => {
  const { kept, left } = keepWithin(state, photos);
  if (!kept.length) return { state, added: 0, left, joined: 0, started: [], into: null };
  const known = register(state.photos, kept);
  const signatureOf = (id: string) => known[id]?.signature ?? null;
  const dayOf = (at: number) => localParts(new Date(at), tz).date;
  const meals = state.meals.map((meal) => ({ ...meal, photoIds: [...meal.photoIds] }));
  const edited = new Set(meals.filter(mealEdited).map((meal) => meal.id));
  const hasRoom = (meal: BulkMeal) => meal.photoIds.length < BULK.perMeal;

  // 1. Into the meals the person edited, where the rules would put a photo.
  const rest = new Set<string>();
  for (const photo of byTime(kept)) {
    let home: BulkMeal | null = null;
    if (photo.takenAt !== null) {
      const taken = photo.takenAt;
      let best: { meal: BulkMeal; id: string; gap: number } | null = null;
      for (const meal of meals)
        for (const id of meal.photoIds) {
          const at = known[id]?.takenAt ?? null;
          if (at === null || dayOf(at) !== dayOf(taken)) continue;
          const gap = Math.abs(at - taken);
          if (gap > BULK.mealGapMinutes * MINUTE) continue;
          if (!best || gap < best.gap) best = { meal, id, gap };
        }
      if (best && edited.has(best.meal.id) && hasRoom(best.meal)) {
        const score = likeness(photo.signature, signatureOf(best.id));
        const looksApart =
          best.gap > BULK.lookSplitMinutes * MINUTE &&
          score !== null &&
          score < BULK.differentBelow;
        if (!looksApart) home = best.meal;
      }
    } else {
      let bestScore = -1;
      let bestMeal: BulkMeal | null = null;
      for (const meal of meals) {
        if (!hasRoom(meal)) continue;
        for (const id of meal.photoIds) {
          const score = likeness(photo.signature, signatureOf(id));
          if (score !== null && score > bestScore) {
            bestScore = score;
            bestMeal = meal;
          }
        }
      }
      if (bestMeal && bestScore >= BULK.noTimeJoinAt && edited.has(bestMeal.id)) home = bestMeal;
    }
    if (home) home.photoIds.push(photo.id);
    else rest.add(photo.id);
  }

  // 2. The rest with the photos of the meals nobody edited, grouped again.
  const unedited = meals.filter((meal) => !edited.has(meal.id));
  const pool: SortPhoto[] = [
    ...unedited
      .flatMap((meal) => meal.photoIds)
      .sort((a, b) => known[a]!.order - known[b]!.order)
      .map((id) => ({ id, takenAt: known[id]!.takenAt, signature: signatureOf(id) })),
    ...kept.filter((photo) => rest.has(photo.id)),
  ];
  const sameAs = new Map(unedited.map((meal) => [[...meal.photoIds].sort().join(" "), meal]));
  let nextSeq = state.nextSeq;
  const regrouped = (pool.length ? groupPhotos(pool, tz) : []).map((group) => {
    // A meal whose photos stay together exactly keeps its id and its place among equal times.
    const key = [...group].sort().join(" ");
    const same = sameAs.get(key);
    if (!same) return newMeal(nextSeq++, group, state.fallbackAt);
    sameAs.delete(key);
    return { ...same, photoIds: group };
  });

  const after = settleBulk({
    ...state,
    photos: known,
    meals: [...meals.filter((meal) => edited.has(meal.id)), ...regrouped],
    nextSeq,
  });
  return { ...summary(state, after, kept.length, left), into: null };
};
