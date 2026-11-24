// The look of a photo for sorting a batch into meals ("Add photos", docs/DESIGN.md section 3):
// a colour histogram of a 32 x 32 copy and a difference hash of a 9 x 8 grey copy. Worked out on
// the device from tiny copies of the photo (lib/photos/client.ts) and kept in memory while the
// screen is open: never sent, never stored. Plain functions over RGBA pixels, safe for tests.
import { BULK } from "./rules";

export type PhotoSignature = {
  /** Share of the pixels in each of 64 colour bins (4 levels each of red, green and blue). */
  colours: number[];
  /** 64-bit difference hash, 16 hex digits: 1 where a pixel is brighter than its right neighbour. */
  hash: string;
};

/** The sizes of the two tiny copies. */
export const SIGNATURE_SIZE = { colours: 32, hashWidth: 9, hashHeight: 8 } as const;

const LEVELS = 4;
const BINS = LEVELS * LEVELS * LEVELS;

/** Share of the pixels (RGBA, alpha ignored) in each of the 64 colour bins; sums to 1. */
export const colourHistogram = (rgba: ArrayLike<number>): number[] => {
  const bins = new Array<number>(BINS).fill(0);
  const pixels = Math.floor(rgba.length / 4);
  if (!pixels) return bins;
  const step = 256 / LEVELS;
  for (let i = 0; i < pixels; i++) {
    const r = Math.min(LEVELS - 1, Math.floor((rgba[i * 4] ?? 0) / step));
    const g = Math.min(LEVELS - 1, Math.floor((rgba[i * 4 + 1] ?? 0) / step));
    const b = Math.min(LEVELS - 1, Math.floor((rgba[i * 4 + 2] ?? 0) / step));
    bins[r * LEVELS * LEVELS + g * LEVELS + b]! += 1;
  }
  return bins.map((count) => count / pixels);
};

/**
 * The difference hash of a width x height RGBA copy (9 x 8 gives 64 bits): for each row, 1 where
 * a pixel is brighter than the one to its right.
 */
export const differenceHash = (
  rgba: ArrayLike<number>,
  width: number = SIGNATURE_SIZE.hashWidth,
  height: number = SIGNATURE_SIZE.hashHeight,
): string => {
  const grey = (x: number, y: number) => {
    const i = (y * width + x) * 4;
    return 0.299 * (rgba[i] ?? 0) + 0.587 * (rgba[i + 1] ?? 0) + 0.114 * (rgba[i + 2] ?? 0);
  };
  let hex = "";
  let nibble = 0;
  let bits = 0;
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width - 1; x++) {
      nibble = (nibble << 1) | (grey(x, y) > grey(x + 1, y) ? 1 : 0);
      bits += 1;
      if (bits === 4) {
        hex += nibble.toString(16);
        nibble = 0;
        bits = 0;
      }
    }
  if (bits) hex += (nibble << (4 - bits)).toString(16);
  return hex;
};

export const signatureFromPixels = (
  colourPixels: ArrayLike<number>,
  hashPixels: ArrayLike<number>,
): PhotoSignature => ({
  colours: colourHistogram(colourPixels),
  hash: differenceHash(hashPixels),
});

/** Histogram intersection: 1 for the same colours, 0 for none in common. */
export const colourLikeness = (a: readonly number[], b: readonly number[]) => {
  let sum = 0;
  for (let i = 0; i < Math.min(a.length, b.length); i++) sum += Math.min(a[i] ?? 0, b[i] ?? 0);
  return Math.max(0, Math.min(1, sum));
};

const NIBBLE_BITS = [0, 1, 1, 2, 1, 2, 2, 3, 1, 2, 2, 3, 2, 3, 3, 4];

/** Share of the hash bits two photos have in common (unrelated pictures share about half). */
export const hashLikeness = (a: string, b: string) => {
  const length = Math.min(a.length, b.length);
  if (!length) return 0;
  let different = 0;
  for (let i = 0; i < length; i++)
    different += NIBBLE_BITS[(parseInt(a[i]!, 16) ^ parseInt(b[i]!, 16)) & 15] ?? 0;
  return 1 - different / (length * 4);
};

/**
 * How alike two photos look, 0 (nothing alike) to 1 (the same picture): the colours count for
 * BULK.colourWeight, the shapes for the rest. Half the hash bits in common is what unrelated
 * pictures have, so it counts as nothing alike. Null when either signature is missing.
 */
export const likeness = (a: PhotoSignature | null, b: PhotoSignature | null): number | null => {
  if (!a || !b) return null;
  const colours = colourLikeness(a.colours, b.colours);
  const shapes = Math.max(0, (hashLikeness(a.hash, b.hash) - 0.5) / 0.5);
  return BULK.colourWeight * colours + (1 - BULK.colourWeight) * shapes;
};
