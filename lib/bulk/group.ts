// Sorting a batch of photos into meals ("Add photos", docs/DESIGN.md section 3). Pure and
// deterministic: the same photos in the same order always give the same meals. Every number is
// in BULK (rules.ts).
//
//   1. Photos with a time taken, oldest first (ties keep the order they were picked in).
//   2. A new meal starts at a gap of more than BULK.mealGapMinutes, and at a new local day.
//   3. Inside such a group, a new meal starts between neighbours that look clearly different
//      (likeness under BULK.differentBelow) and were taken more than BULK.lookSplitMinutes apart.
//   4. A meal never holds more than BULK.perMeal (3) photos: a bigger group is cut, in time
//      order, into as few meals as fit, at the places where neighbours look least alike (then
//      where they are furthest apart in time).
//   5. Photos with no time taken, in the order picked: each joins the meal with room that has the
//      photo most like it, when that likeness is at least BULK.noTimeJoinAt; else it starts a meal
//      of its own (which later photos with no time can join).
import { localParts } from "@/lib/meals/time";

import { BULK } from "./rules";
import { likeness, type PhotoSignature } from "./signature";

export type SortPhoto = {
  id: string;
  /** When it was taken (ms since 1970), from its EXIF; null when it has no time. */
  takenAt: number | null;
  signature: PhotoSignature | null;
};

const MINUTE = 60_000;

const alike = (a: SortPhoto, b: SortPhoto) =>
  likeness(a.signature, b.signature) ?? BULK.unknownLikeness;

/** Cuts a group into as few runs of at most BULK.perMeal as fit, where neighbours differ most. */
const splitToFit = (group: SortPhoto[]): SortPhoto[][] => {
  const n = group.length;
  const per = BULK.perMeal;
  const chunks = Math.ceil(n / per);
  // best[i][j]: the first i photos in j meals, the last meal ending at photo i. Cost: the sum of
  // the likeness across the cuts (lower is better), then the time across them (more is better).
  type Cell = { cost: number; gap: number; size: number } | null;
  const best: Cell[][] = Array.from({ length: n + 1 }, () =>
    new Array<Cell>(chunks + 1).fill(null),
  );
  best[0]![0] = { cost: 0, gap: 0, size: 0 };
  for (let i = 1; i <= n; i++)
    for (let j = 1; j <= chunks; j++)
      for (let size = 1; size <= per && size <= i; size++) {
        const before = best[i - size]![j - 1];
        if (!before) continue;
        const start = i - size;
        const cut = start > 0;
        const cost = before.cost + (cut ? alike(group[start - 1]!, group[start]!) : 0);
        const gap =
          before.gap + (cut ? (group[start]!.takenAt ?? 0) - (group[start - 1]!.takenAt ?? 0) : 0);
        const current = best[i]![j];
        if (
          !current ||
          cost < current.cost - 1e-9 ||
          (Math.abs(cost - current.cost) <= 1e-9 && gap > current.gap)
        )
          best[i]![j] = { cost, gap, size };
      }
  const meals: SortPhoto[][] = [];
  let end = n;
  for (let j = chunks; j > 0; j--) {
    const size = best[end]![j]!.size;
    meals.unshift(group.slice(end - size, end));
    end -= size;
  }
  return meals;
};

/** Splits a time group where neighbours look clearly different and are minutes apart. */
const splitByLook = (group: SortPhoto[]): SortPhoto[][] => {
  const meals: SortPhoto[][] = [[group[0]!]];
  for (let i = 1; i < group.length; i++) {
    const prev = group[i - 1]!;
    const photo = group[i]!;
    const apart = photo.takenAt! - prev.takenAt! > BULK.lookSplitMinutes * MINUTE;
    const score = likeness(prev.signature, photo.signature);
    if (apart && score !== null && score < BULK.differentBelow) meals.push([photo]);
    else meals.at(-1)!.push(photo);
  }
  return meals;
};

/**
 * The meals of a batch: lists of photo ids, each in time order (photos with no time last).
 * Meals of photos with a time come first, oldest first; meals of photos with no time after them.
 * tz names the local day of each time.
 */
export const groupPhotos = (photos: readonly SortPhoto[], tz: string): string[][] => {
  const order = new Map(photos.map((photo, i) => [photo.id, i]));
  const dayOf = (photo: SortPhoto) => localParts(new Date(photo.takenAt!), tz).date;
  const timed = photos
    .filter((photo) => photo.takenAt !== null)
    .sort((a, b) => a.takenAt! - b.takenAt! || order.get(a.id)! - order.get(b.id)!);

  const byTime: SortPhoto[][] = [];
  for (const photo of timed) {
    const group = byTime.at(-1);
    const prev = group?.at(-1);
    if (
      !group ||
      !prev ||
      photo.takenAt! - prev.takenAt! > BULK.mealGapMinutes * MINUTE ||
      dayOf(photo) !== dayOf(prev)
    )
      byTime.push([photo]);
    else group.push(photo);
  }

  const meals = byTime
    .flatMap(splitByLook)
    .flatMap((group) => (group.length > BULK.perMeal ? splitToFit(group) : [group]));

  for (const photo of photos) {
    if (photo.takenAt !== null) continue;
    let best = -1;
    let bestScore = -1;
    meals.forEach((meal, i) => {
      if (meal.length >= BULK.perMeal) return;
      for (const other of meal) {
        const score = likeness(photo.signature, other.signature);
        if (score !== null && score > bestScore) {
          best = i;
          bestScore = score;
        }
      }
    });
    if (best >= 0 && bestScore >= BULK.noTimeJoinAt) meals[best]!.push(photo);
    else meals.push([photo]);
  }
  return meals.map((meal) => meal.map((photo) => photo.id));
};

/**
 * The photos a batch keeps when more than `max` were picked: the first ones by time taken, then
 * the ones with no time in the order picked. Returns the kept ids in the order picked.
 */
export const limitBatch = (
  photos: readonly { id: string; takenAt: number | null }[],
  max: number = BULK.maxPhotos,
): { kept: string[]; left: number } => {
  if (photos.length <= max) return { kept: photos.map((p) => p.id), left: 0 };
  const order = new Map(photos.map((photo, i) => [photo.id, i]));
  const ranked = [...photos].sort(
    (a, b) =>
      (a.takenAt === null ? 1 : 0) - (b.takenAt === null ? 1 : 0) ||
      (a.takenAt ?? 0) - (b.takenAt ?? 0) ||
      order.get(a.id)! - order.get(b.id)!,
  );
  const keep = new Set(ranked.slice(0, max).map((p) => p.id));
  return { kept: photos.filter((p) => keep.has(p.id)).map((p) => p.id), left: photos.length - max };
};
