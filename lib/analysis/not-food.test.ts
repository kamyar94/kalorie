import { describe, expect, it } from "vitest";

import { mealError, notFoodPhotoDetail } from "./errors";
import { logsAsMedicine, mealNotFoodKind, notFoodDetail, notFoodKindFromWords } from "./not-food";

describe("notFoodKindFromWords", () => {
  it("finds medicines and supplements by keyword, in English", () => {
    const cases: [string, string][] = [
      ["Prescription medication bottle and tablet", "medicine"],
      ["A box of allergy medicine", "medicine"],
      ["Two white pills on a hand", "medicine"],
      ["Blister pack of tablets", "medicine"],
      ["Gel capsules in a jar", "medicine"],
      ["Cough syrup bottle", "medicine"],
      ["Eye drops", "medicine"],
      ["Asthma inhaler", "medicine"],
      ["A strip of caplets", "medicine"],
      ["Vitamin D bottle", "supplement"],
      ["Multivitamin tablets", "supplement"],
      ["Magnesium supplement capsules", "supplement"],
      ["A jar of probiotics", "supplement"],
    ];
    for (const [words, kind] of cases) expect(notFoodKindFromWords(words), words).toBe(kind);
  });

  it("finds them in Persian, with suffixes", () => {
    const cases: [string, string][] = [
      ["قرص سرماخوردگی", "medicine"],
      ["بسته داروها", "medicine"],
      ["کپسول امپرازول", "medicine"],
      ["شربت سرفه", "medicine"],
      ["قطره چشم", "medicine"],
      ["ویتامین د", "supplement"],
      ["مکمل آهن", "supplement"],
    ];
    for (const [words, kind] of cases) expect(notFoodKindFromWords(words), words).toBe(kind);
  });

  it("keeps everything else as other, also words that only contain a keyword", () => {
    for (const words of [
      "A laptop on a desk",
      "A tablet computer on a table",
      "A cat on a sofa",
      "Raindrops on a window",
      "Pillow and a blanket",
      "Supplemental reading for a class",
      "",
    ])
      expect(notFoodKindFromWords(words), words).toBe("other");
    expect(notFoodKindFromWords(null, undefined)).toBe("other");
  });
});

describe("mealNotFoodKind", () => {
  const notFood = (title: string, notFoodKind?: "medicine" | "supplement" | "other") =>
    mealError("not-food", { detail: notFoodPhotoDetail(title), notFoodKind });

  it("reads the stored detail of the error", () => {
    expect(notFoodDetail(notFood("A box of ibuprofen tablets").message)).toBe(
      "A box of ibuprofen tablets",
    );
    expect(notFoodDetail("These photos do not seem to show food or drink.")).toBeNull();
    expect(notFoodDetail(null)).toBeNull();
  });

  it("takes the kind kept with the error first, then the analysis, then the words", () => {
    // Analysed with not_food_kind: the stored kind wins over the words.
    expect(mealNotFoodKind({ error: notFood("A laptop on a desk", "medicine") })).toBe("medicine");
    expect(mealNotFoodKind({ error: notFood("Pill bottle", "other") })).toBe("other");
    // The analysis output said it.
    expect(
      mealNotFoodKind({
        error: notFood("Something"),
        analysis: { is_food: false, not_food_kind: "supplement", title: "Something" },
      }),
    ).toBe("supplement");
    // Analysed before: the detail, then the analysis title.
    expect(mealNotFoodKind({ error: notFood("A medication bottle and a tablet") })).toBe(
      "medicine",
    );
    expect(
      mealNotFoodKind({
        error: { kind: "not-food", message: "These photos do not seem to show food or drink." },
        analysis: { is_food: false, title: "Vitamin C tablets" },
      }),
    ).toBe("supplement");
    expect(mealNotFoodKind({ error: notFood("A laptop on a desk") })).toBe("other");
  });

  it("reads the description of a meal typed in words, and nothing for other errors", () => {
    const typed = mealError("not-food", { textOnly: true });
    expect(mealNotFoodKind({ error: typed, note: "two allergy pills", textOnly: true })).toBe(
      "medicine",
    );
    expect(mealNotFoodKind({ error: typed, note: "دو تا قرص", textOnly: true })).toBe("medicine");
    // A photo meal's note is not the description of what the photo shows.
    expect(mealNotFoodKind({ error: notFood("A cat"), note: "after my pills" })).toBe("other");
    expect(mealNotFoodKind({ error: mealError("no-key") })).toBeNull();
    expect(mealNotFoodKind({ error: null })).toBeNull();
  });

  it("offers Log as a medicine only for failed medicines and supplements", () => {
    const error = (notFoodKind: "medicine" | "supplement" | "other" | null) => ({
      kind: "not-food",
      notFoodKind,
    });
    expect(logsAsMedicine({ status: "failed", error: error("medicine") })).toBe(true);
    expect(logsAsMedicine({ status: "failed", error: error("supplement") })).toBe(true);
    expect(logsAsMedicine({ status: "failed", error: error("other") })).toBe(false);
    expect(logsAsMedicine({ status: "failed", error: error(null) })).toBe(false);
    expect(logsAsMedicine({ status: "queued", error: error("medicine") })).toBe(false);
    expect(logsAsMedicine({ status: "failed", error: { kind: "no-key", notFoodKind: null } })).toBe(
      false,
    );
    expect(logsAsMedicine({ status: "failed", error: null })).toBe(false);
  });
});
