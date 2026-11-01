// The deterministic side of matching: trigram scores, candidate ranking and the fallback choice.
import { describe, expect, it } from "vitest";

import type { FoodResult } from "@/lib/contracts/food-search";

import {
  chooseByTrigram,
  MATCH_THRESHOLD,
  rankCandidates,
  subjectScore,
  type MatchSubject,
} from "./matching";
import {
  matchScore,
  trigramContainment,
  trigrams,
  trigramSimilarity,
  withoutGenericMarkers,
} from "./trigram";

const food = (id: string, nameEn: string, extra: Partial<FoodResult> = {}): FoodResult => ({
  id,
  source: "fdc_sr_legacy",
  kind: "food",
  nameEn,
  nameFa: null,
  brand: null,
  category: null,
  barcode: null,
  per100g: { energy: 100 },
  densityGPerMl: null,
  servingGrams: null,
  portions: [],
  sourceNote: null,
  personal: false,
  score: 0,
  ...extra,
});

const subject = (overrides: Partial<MatchSubject>): MatchSubject => ({
  key: "item:0",
  name: "Item",
  localName: null,
  kind: "dish",
  preparation: null,
  grams: 100,
  searchTerms: [],
  partOf: null,
  barcode: null,
  memoryFoodId: null,
  ...overrides,
});

describe("trigrams", () => {
  it("pads words like pg_trgm and handles Persian letters", () => {
    expect([...trigrams("Rice")]).toEqual(["  r", " ri", "ric", "ice", "ce "]);
    expect(trigrams("كباب").size).toBe(trigrams("کباب").size); // Arabic kaf is unified
    expect(trigramSimilarity("کباب کوبیده", "کباب کوبیده")).toBe(1);
    expect(trigramSimilarity("", "rice")).toBe(0);
  });

  it("scores containment for long database names", () => {
    expect(
      trigramContainment("white rice cooked", "Rice, white, long-grain, regular, cooked"),
    ).toBe(1);
    expect(
      trigramSimilarity("white rice cooked", "Rice, white, long-grain, regular, cooked"),
    ).toBeLessThan(0.6);
    expect(matchScore("rice", "Rice, cooked")).toBeGreaterThan(
      matchScore("rice", "Rice pudding with raisins"),
    );
  });
});

describe("matching selection", () => {
  const rice = food("rice", "Rice, white, long-grain, cooked");
  const pudding = food("pudding", "Rice pudding with raisins");
  const beef = food("beef", "Beef, stewed");
  const chicken = food("chicken", "Chicken stew");

  it("picks the best name above the threshold", () => {
    const s = subject({ name: "Rice, white, cooked", searchTerms: ["white rice"] });
    expect(chooseByTrigram(s, [pudding, rice])).toBe(rice);
    expect(subjectScore(s, rice)).toBeGreaterThanOrEqual(MATCH_THRESHOLD);
  });

  it("picks none rather than a different food", () => {
    const s = subject({ name: "Beef stew", searchTerms: ["beef stew"] });
    expect(chooseByTrigram(s, [chicken])).toBeNull();
    expect(
      chooseByTrigram(subject({ name: "Ghormeh sabzi", searchTerms: ["herb stew with beef"] }), [
        beef,
      ]),
    ).toBeNull();
    expect(chooseByTrigram(s, [])).toBeNull();
  });

  it("uses Persian names too", () => {
    const kabab = food("koobideh", "Kabab koobideh", { nameFa: "کباب کوبیده" });
    expect(
      chooseByTrigram(subject({ name: "Ground meat kebab", localName: "کباب کوبیده" }), [kabab]),
    ).toBe(kabab);
  });

  it("ranks the remembered food first, then by score, then the person's own", () => {
    const own = food("own-rice", "Rice, white, long-grain, cooked", { personal: true });
    const s = subject({ name: "Rice, white, cooked", memoryFoodId: "pudding" });
    expect(rankCandidates(s, [rice, pudding, own]).map((f) => f.id)).toEqual([
      "pudding",
      "own-rice",
      "rice",
    ]);
    expect(chooseByTrigram(s, [rice, pudding])).toBe(pudding);
  });

  it("leaves FoodData Central's not-specified markers out of the score", () => {
    expect(withoutGenericMarkers("Rice, white, cooked, no added fat")).toMatch(
      /^Rice, white, cooked,\s*$/,
    );
    expect(withoutGenericMarkers("Rice, white, cooked, NS as to fat")).toMatch(
      /^Rice, white, cooked,\s*$/,
    );
    expect(withoutGenericMarkers("Rice, cooked, NFS")).toMatch(/^Rice, cooked,\s*$/);
    expect(withoutGenericMarkers("Bread, NS as to major flour, toasted")).toMatch(
      /^Bread,\s*, toasted$/,
    );
    expect(withoutGenericMarkers("NFS")).toBe("NFS");
    expect(withoutGenericMarkers("Nfsomething, raw")).toBe("Nfsomething, raw");

    const plain = food("plain", "Rice, white, cooked, no added fat", { score: 1.54 });
    const glutinous = food("glutinous", "Rice, white, cooked, glutinous", { score: 1.51 });
    const s = subject({ name: "white rice cooked", searchTerms: ["white rice", "steamed rice"] });
    expect(chooseByTrigram(s, [glutinous, plain])).toBe(plain);
    expect(rankCandidates(s, [glutinous, plain]).map((f) => f.id)).toEqual(["plain", "glutinous"]);
  });

  it("breaks trigram ties by the food search's order, not the alphabet", () => {
    // "raw" and "baked" give "banana" the same trigram score.
    const baked = food("baked", "Banana, baked", { score: 1.58 });
    const raw = food("raw", "Banana, raw", { score: 1.62 });
    const s = subject({ name: "banana" });
    expect(subjectScore(s, raw)).toBeCloseTo(subjectScore(s, baked), 2);
    expect(chooseByTrigram(s, [baked, raw])).toBe(raw);
    expect(rankCandidates(s, [baked, raw]).map((f) => f.id)).toEqual(["raw", "baked"]);
  });

  it("keeps at most eight candidates", () => {
    const many = Array.from({ length: 12 }, (_, i) => food(`f${i}`, `Rice dish ${i}`));
    expect(rankCandidates(subject({ name: "Rice dish" }), many)).toHaveLength(8);
  });
});
