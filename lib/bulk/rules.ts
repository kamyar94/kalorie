// "Add photos" (docs/DESIGN.md section 3): every number that sorts a batch of photos into meals,
// in one place. The grouping (group.ts), the look of a photo (signature.ts) and the screen read
// them from here.
import { UPLOAD_LIMITS } from "@/lib/contracts/meals";

export const BULK = {
  /** Most photos in one batch; more keeps the first ones by time taken. */
  maxPhotos: 30,
  /** Most photos in one meal (the upload's own limit). */
  perMeal: UPLOAD_LIMITS.maxPhotos,
  /** A gap of more than this between neighbouring photos (by time taken) starts a new meal. */
  mealGapMinutes: 30,
  /**
   * Inside one time group, neighbours that look clearly different start a new meal only when they
   * were taken more than this far apart (a plate and a drink a minute later stay together).
   */
  lookSplitMinutes: 5,
  /** Two photos look clearly different below this likeness (0 to 1, see signature.ts). */
  differentBelow: 0.45,
  /** A photo with no time taken joins a meal only when it looks at least this much like one of its photos. */
  noTimeJoinAt: 0.8,
  /** Likeness when a signature is missing (neither alike nor different). */
  unknownLikeness: 0.5,
  /** Share of the likeness that comes from the colours; the rest from the shapes (the hash). */
  colourWeight: 0.6,
  /** Photos read at the same time (decoding a phone photo takes tens of MB), so 30 fit in memory. */
  concurrency: 2,
  /** Long edge of the small copy shown on the screen. */
  previewEdge: 256,
} as const;
