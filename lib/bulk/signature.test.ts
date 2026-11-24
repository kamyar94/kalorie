import { describe, expect, it } from "vitest";

import { mapLimit } from "./pool";
import {
  colourHistogram,
  colourLikeness,
  differenceHash,
  hashLikeness,
  likeness,
  signatureFromPixels,
} from "./signature";

/** RGBA pixels of a width x height picture drawn by `paint(x, y)`. */
const picture = (width: number, height: number, paint: (x: number, y: number) => number[]) => {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const [r, g, b] = paint(x, y);
      data.set([r!, g!, b!, 255], (y * width + x) * 4);
    }
  return data;
};

/** A made-up plate: a disc of one colour on a background of another, as the e2e fixtures. */
const plate = (fg: number[], bg: number[], size: number, shift = 0) =>
  picture(size, size, (x, y) =>
    (x - size / 2 - shift) ** 2 + (y - size / 2) ** 2 < (size / 3) ** 2 ? fg : bg,
  );
const sig = (fg: number[], bg: number[], shift = 0) =>
  signatureFromPixels(plate(fg, bg, 32, shift), plate(fg, bg, 9, shift / 4));

describe("colour histogram", () => {
  it("puts every pixel in one of 64 bins and sums to 1", () => {
    const bins = colourHistogram(picture(4, 4, (x) => (x < 2 ? [255, 0, 0] : [0, 0, 255])));
    expect(bins).toHaveLength(64);
    expect(bins.reduce((a, b) => a + b, 0)).toBeCloseTo(1);
    expect(bins[3 * 16]).toBeCloseTo(0.5); // red
    expect(bins[3]).toBeCloseTo(0.5); // blue
    expect(colourHistogram([])).toEqual(new Array(64).fill(0));
  });

  it("compares by intersection", () => {
    const a = colourHistogram(picture(2, 1, () => [200, 120, 40]));
    const b = colourHistogram(picture(2, 1, (x) => (x ? [200, 120, 40] : [10, 10, 10])));
    expect(colourLikeness(a, a)).toBe(1);
    expect(colourLikeness(a, b)).toBeCloseTo(0.5);
  });
});

describe("difference hash", () => {
  it("is 64 bits as 16 hex digits, 1 where a pixel is brighter than its right neighbour", () => {
    const falling = differenceHash(
      picture(9, 8, (x) => [255 - x * 30, 255 - x * 30, 255 - x * 30]),
    );
    const rising = differenceHash(picture(9, 8, (x) => [x * 30, x * 30, x * 30]));
    expect(falling).toBe("ffffffffffffffff");
    expect(rising).toBe("0000000000000000");
    expect(hashLikeness(falling, rising)).toBe(0);
    expect(hashLikeness(falling, falling)).toBe(1);
    expect(hashLikeness("f0", "ff")).toBe(0.5);
  });
});

describe("likeness", () => {
  it("is 1 for the same picture and low for different plates", () => {
    const porridge = sig([168, 138, 84], [91, 74, 46]);
    const salad = sig([111, 154, 74], [47, 74, 42]);
    expect(likeness(porridge, porridge)).toBeCloseTo(1);
    expect(likeness(porridge, sig([168, 138, 84], [91, 74, 46], 2))!).toBeGreaterThan(0.8);
    expect(likeness(porridge, salad)!).toBeLessThan(0.45);
    expect(likeness(porridge, null)).toBeNull();
  });
});

describe("mapLimit", () => {
  it("runs at most `limit` at once, keeps the order and settles failures", async () => {
    let running = 0;
    let most = 0;
    const done: number[] = [];
    const results = await mapLimit(
      [5, 1, 4, 2, 3],
      2,
      async (ms, i) => {
        running += 1;
        most = Math.max(most, running);
        await new Promise((resolve) => setTimeout(resolve, ms));
        running -= 1;
        if (i === 2) throw new Error("not a photo");
        return ms * 10;
      },
      (count) => done.push(count),
    );
    expect(most).toBe(2);
    expect(done).toEqual([1, 2, 3, 4, 5]);
    expect(results.map((r) => (r.status === "fulfilled" ? r.value : "failed"))).toEqual([
      50,
      10,
      "failed",
      20,
      30,
    ]);
    expect(await mapLimit([], 2, async () => 1)).toEqual([]);
  });
});
