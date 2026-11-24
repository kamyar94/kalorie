import { describe, expect, it } from "vitest";

import { groupPhotos, limitBatch, type SortPhoto } from "./group";
import { BULK } from "./rules";
import type { PhotoSignature } from "./signature";

// Photos two days ago (UTC), at made-up times; the grouping itself never looks at the clock.
const DAY = (() => {
  const now = new Date();
  return Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - 2);
})();
const at = (h: number, m: number, s = 0) => DAY + ((h * 60 + m) * 60 + s) * 1000;

/** A look: all pixels in one colour bin, with a hash pattern. */
const look = (bin: number, hash = "0123456789abcdef"): PhotoSignature => {
  const colours = new Array<number>(64).fill(0);
  colours[bin] = 1;
  return { colours, hash };
};
const GREEN = look(20, "00ff00ff00ff00ff");
const GREENISH = look(20, "00ff00ff00ff00fe");
const RED = look(48, "00ff00ff00ff00ff"); // other colours, the same shapes: 0.4, clearly different
const BLUE = look(3, "ff00ff00ff00ff00"); // nothing alike

let n = 0;
const photo = (takenAt: number | null, signature: PhotoSignature | null = GREEN): SortPhoto => ({
  id: `p${++n}`,
  takenAt,
  signature,
});
const ids = (photos: SortPhoto[], groups: string[][]) =>
  groups.map((g) => g.map((id) => photos.findIndex((p) => p.id === id) + 1));

describe("groupPhotos: time", () => {
  it("starts a new meal at a gap of more than 30 minutes", () => {
    const photos = [
      photo(at(8, 12)),
      photo(at(8, 14)),
      photo(at(12, 47)),
      photo(at(12, 48)),
      photo(at(12, 51)),
      photo(at(16, 5)),
      photo(at(19, 52)),
      photo(at(19, 53)),
      photo(at(19, 58)),
    ];
    expect(ids(photos, groupPhotos(photos, "UTC"))).toEqual([[1, 2], [3, 4, 5], [6], [7, 8, 9]]);
  });

  it("keeps exactly 30 minutes together and splits at 30 minutes and a second", () => {
    const together = [photo(at(8, 0)), photo(at(8, 30))];
    expect(ids(together, groupPhotos(together, "UTC"))).toEqual([[1, 2]]);
    const apart = [photo(at(8, 0)), photo(at(8, 30, 1))];
    expect(ids(apart, groupPhotos(apart, "UTC"))).toEqual([[1], [2]]);
    // Chained gaps under the limit stay one meal (up to its 3 photos).
    const chain = [photo(at(8, 0)), photo(at(8, 25)), photo(at(8, 50))];
    expect(ids(chain, groupPhotos(chain, "UTC"))).toEqual([[1, 2, 3]]);
  });

  it("sorts by time taken, whatever order the photos were picked in", () => {
    const photos = [photo(at(19, 52)), photo(at(8, 12)), photo(at(8, 14)), photo(at(19, 53))];
    expect(ids(photos, groupPhotos(photos, "UTC"))).toEqual([
      [2, 3],
      [1, 4],
    ]);
  });
});

describe("groupPhotos: look", () => {
  it("splits neighbours that look clearly different and are more than 5 minutes apart", () => {
    const photos = [photo(at(12, 0), GREEN), photo(at(12, 7), RED)];
    expect(ids(photos, groupPhotos(photos, "UTC"))).toEqual([[1], [2]]);
  });

  it("keeps different-looking photos together within 5 minutes (a plate, then its drink)", () => {
    const photos = [photo(at(12, 0), GREEN), photo(at(12, 5), BLUE)];
    expect(ids(photos, groupPhotos(photos, "UTC"))).toEqual([[1, 2]]);
  });

  it("keeps alike photos together across a longer gap, and photos without a look", () => {
    const alike = [photo(at(12, 0), GREEN), photo(at(12, 20), GREENISH)];
    expect(ids(alike, groupPhotos(alike, "UTC"))).toEqual([[1, 2]]);
    const unknown = [photo(at(12, 0), null), photo(at(12, 20), RED)];
    expect(ids(unknown, groupPhotos(unknown, "UTC"))).toEqual([[1, 2]]);
  });

  it("uses the likeness threshold from BULK", () => {
    expect(BULK.differentBelow).toBeGreaterThan(0.4);
    expect(BULK.differentBelow).toBeLessThan(0.6);
  });
});

describe("groupPhotos: never more than 3 photos in a meal", () => {
  it("cuts a bigger group where neighbours look least alike, keeping time order", () => {
    const photos = [
      photo(at(12, 0), GREEN),
      photo(at(12, 1), GREEN),
      photo(at(12, 2), BLUE),
      photo(at(12, 3), BLUE),
      photo(at(12, 4), BLUE),
    ];
    expect(ids(photos, groupPhotos(photos, "UTC"))).toEqual([
      [1, 2],
      [3, 4, 5],
    ]);
  });

  it("cuts into as few meals as fit, at the longest gaps when all look alike", () => {
    const photos = [
      photo(at(12, 0)),
      photo(at(12, 1)),
      photo(at(12, 2)),
      photo(at(12, 12)),
      photo(at(12, 13)),
      photo(at(12, 20)),
      photo(at(12, 21)),
    ];
    const groups = groupPhotos(photos, "UTC");
    expect(groups).toHaveLength(3);
    expect(groups.every((g) => g.length <= 3)).toBe(true);
    expect(ids(photos, groups)).toEqual([
      [1, 2, 3],
      [4, 5],
      [6, 7],
    ]);
  });

  it("holds for many photos at once", () => {
    const photos = Array.from({ length: 20 }, (_, i) => photo(at(12, i)));
    const groups = groupPhotos(photos, "UTC");
    expect(groups).toHaveLength(7);
    expect(groups.flat()).toEqual(photos.map((p) => p.id));
    expect(Math.max(...groups.map((g) => g.length))).toBe(3);
  });
});

describe("groupPhotos: photos with no time taken", () => {
  it("join the most alike meal with room when they look strongly alike", () => {
    const photos = [
      photo(at(8, 0), BLUE),
      photo(at(12, 0), GREEN),
      photo(null, GREENISH),
      photo(null, BLUE),
    ];
    expect(ids(photos, groupPhotos(photos, "UTC"))).toEqual([
      [1, 4],
      [2, 3],
    ]);
  });

  it("form a meal of their own beside a full meal or a weak likeness, and join each other", () => {
    const photos = [
      photo(at(12, 0), GREEN),
      photo(at(12, 1), GREEN),
      photo(at(12, 2), GREEN),
      photo(null, GREEN),
      photo(null, RED),
      photo(null, RED),
    ];
    expect(ids(photos, groupPhotos(photos, "UTC"))).toEqual([[1, 2, 3], [4], [5, 6]]);
  });

  it("never join on a missing look", () => {
    const photos = [photo(at(12, 0), GREEN), photo(null, null)];
    expect(ids(photos, groupPhotos(photos, "UTC"))).toEqual([[1], [2]]);
  });
});

describe("groupPhotos: days", () => {
  it("keeps different local days apart, even minutes apart", () => {
    const photos = [photo(at(23, 50)), photo(at(24, 10))];
    expect(ids(photos, groupPhotos(photos, "UTC"))).toEqual([[1], [2]]);
    // In a zone 3.5 hours ahead both are the same morning.
    expect(ids(photos, groupPhotos(photos, "Asia/Tehran"))).toEqual([[1, 2]]);
  });
});

describe("groupPhotos: the same input gives the same meals", () => {
  it("is deterministic, and ties in time keep the order picked", () => {
    const make = () => {
      n = 100;
      return [
        photo(at(9, 0), GREEN),
        photo(at(9, 0), BLUE),
        photo(at(9, 1), RED),
        photo(at(9, 2), GREEN),
        photo(null, BLUE),
        photo(at(14, 0), RED),
      ];
    };
    const first = groupPhotos(make(), "UTC");
    expect(groupPhotos(make(), "UTC")).toEqual(first);
    // 09:00 green and 09:00 blue keep their order; the blue photo with no time joins them.
    expect(first).toEqual([["p101", "p102", "p105"], ["p103", "p104"], ["p106"]]);
    // The timed photos picked in another order: the same meals.
    const shuffled = make();
    const reordered = [shuffled[3]!, shuffled[5]!, shuffled[2]!, shuffled[0]!, shuffled[1]!];
    expect(groupPhotos(reordered, "UTC")).toEqual(
      groupPhotos(
        make().filter((p) => p.takenAt !== null),
        "UTC",
      ),
    );
  });
});

describe("limitBatch", () => {
  it("keeps the first 30 by time taken, photos with no time last, in the order picked", () => {
    const photos = [
      ...Array.from({ length: 30 }, (_, i) => ({ id: `t${i}`, takenAt: at(20, 0) - i * 60_000 })),
      { id: "none1", takenAt: null },
      { id: "late", takenAt: at(23, 0) },
      { id: "early", takenAt: at(6, 0) },
      { id: "none2", takenAt: null },
    ];
    const { kept, left } = limitBatch(photos);
    expect(left).toBe(4);
    expect(kept).toHaveLength(BULK.maxPhotos);
    expect(kept).toContain("early");
    expect(kept).not.toContain("late");
    expect(kept).not.toContain("none1");
    expect(kept).not.toContain("t0"); // the latest of the 30
    expect(kept.slice(0, 2)).toEqual(["t1", "t2"]);
    expect(kept.at(-1)).toBe("early");
  });

  it("keeps everything at 30 or fewer", () => {
    const photos = [
      { id: "a", takenAt: null },
      { id: "b", takenAt: at(9, 0) },
    ];
    expect(limitBatch(photos)).toEqual({ kept: ["a", "b"], left: 0 });
    expect(limitBatch(photos, 1)).toEqual({ kept: ["b"], left: 1 });
  });
});
