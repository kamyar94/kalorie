// US Dietary Reference Intakes for the vitamins and minerals Cal tracks, by sex and age band
// (docs/DESIGN.md section 6). A static table: lib/targets/service.ts reads it directly, and
// scripts/lib/reference.mjs copies it into the dri_targets table. Node scripts import this file
// directly, so it has no runtime imports.
//
// SOURCE: National Academies of Sciences, Engineering, and Medicine, Food and Nutrition Board.
// "Dietary Reference Intakes (DRIs)" summary tables: Recommended Dietary Allowances and Adequate
// Intakes (vitamins; elements) and Tolerable Upper Intake Levels (vitamins; elements), as
// reprinted in "Dietary Reference Intakes for Sodium and Potassium" (2019), Appendix J
// (doi:10.17226/25353). These tables include the 2011 calcium and vitamin D values and the 2019
// sodium and potassium values (Adequate Intake, and the Chronic Disease Risk Reduction intake
// of 2,300 mg sodium). Fiber and total water: "Dietary Reference Intakes for Energy,
// Carbohydrate, Fiber, Fat, Fatty Acids, Cholesterol, Protein, and Amino Acids" (2005) and
// "... for Water, Potassium, Sodium, Chloride, and Sulfate" (2005).
// Pregnancy and lactation values are not included (the profile has no such setting).
import type { NutrientCode } from "../contracts/nutrients";

export const DRI_SOURCE =
  "US Dietary Reference Intakes, National Academies (Food and Nutrition Board), summary tables as in Dietary Reference Intakes for Sodium and Potassium (2019), Appendix J";

/** Age bands in years, inclusive. */
export const DRI_AGE_BANDS = [
  [14, 18],
  [19, 30],
  [31, 50],
  [51, 70],
  [71, 120],
] as const;

/**
 * Who a Tolerable Upper Intake Level applies to. Only "total" limits (food, drinks and
 * supplements together) are compared with logged food; the others concern supplements,
 * fortificants or one form of the nutrient, so a meal log cannot be held against them.
 */
export type UlScope = "total" | "supplements" | "synthetic" | "preformed";

type Five = readonly [number, number, number, number, number];

type DriNutrient = {
  code: NutrientCode;
  /** RDA when the band's value is a Recommended Dietary Allowance, AI for an Adequate Intake. */
  basis: "rda" | "ai";
  /** By age band, in the catalogue unit of the code (lib/contracts/nutrients.ts). */
  male: Five;
  female: Five;
  ul: Five | null;
  ulScope: UlScope | null;
  note?: string;
};

const same = (a: number, b = a, c = b, d = c, e = d): Five => [a, b, c, d, e];

export const DRI_NUTRIENTS: readonly DriNutrient[] = [
  // Vitamins
  {
    code: "vit_a",
    basis: "rda",
    male: same(900),
    female: same(700),
    ul: same(2800, 3000),
    ulScope: "preformed",
    note: "µg RAE; the upper limit is for preformed vitamin A (retinol) only",
  },
  {
    code: "vit_c",
    basis: "rda",
    male: same(75, 90),
    female: same(65, 75),
    ul: same(1800, 2000),
    ulScope: "total",
  },
  {
    code: "vit_d",
    basis: "rda",
    male: [15, 15, 15, 15, 20],
    female: [15, 15, 15, 15, 20],
    ul: same(100),
    ulScope: "total",
  },
  {
    code: "vit_e",
    basis: "rda",
    male: same(15),
    female: same(15),
    ul: same(800, 1000),
    ulScope: "supplements",
    note: "mg alpha-tocopherol; the upper limit is for supplements and fortificants",
  },
  {
    code: "vit_k",
    basis: "ai",
    male: same(75, 120),
    female: same(75, 90),
    ul: null,
    ulScope: null,
  },
  {
    code: "thiamin",
    basis: "rda",
    male: same(1.2),
    female: same(1.0, 1.1),
    ul: null,
    ulScope: null,
  },
  {
    code: "riboflavin",
    basis: "rda",
    male: same(1.3),
    female: same(1.0, 1.1),
    ul: null,
    ulScope: null,
  },
  {
    code: "niacin",
    basis: "rda",
    male: same(16),
    female: same(14),
    ul: same(30, 35),
    ulScope: "synthetic",
    note: "mg niacin equivalents; the upper limit is for supplements and fortified foods",
  },
  {
    code: "vit_b6",
    basis: "rda",
    male: [1.3, 1.3, 1.3, 1.7, 1.7],
    female: [1.2, 1.3, 1.3, 1.5, 1.5],
    ul: same(80, 100),
    ulScope: "total",
  },
  {
    code: "folate",
    basis: "rda",
    male: same(400),
    female: same(400),
    ul: same(800, 1000),
    ulScope: "synthetic",
    note: "µg DFE; the upper limit is for folic acid from supplements and fortified foods",
  },
  {
    code: "vit_b12",
    basis: "rda",
    male: same(2.4),
    female: same(2.4),
    ul: null,
    ulScope: null,
  },
  {
    code: "choline",
    basis: "ai",
    male: same(550),
    female: same(400, 425),
    ul: same(3000, 3500),
    ulScope: "total",
  },
  // Elements
  {
    code: "calcium",
    basis: "rda",
    male: [1300, 1000, 1000, 1000, 1200],
    female: [1300, 1000, 1000, 1200, 1200],
    ul: [3000, 2500, 2500, 2000, 2000],
    ulScope: "total",
  },
  {
    code: "copper",
    basis: "rda",
    male: same(0.89, 0.9),
    female: same(0.89, 0.9),
    ul: same(8, 10),
    ulScope: "total",
    note: "tabled in µg (890, 900; upper limits 8,000 and 10,000 µg), stored in mg",
  },
  {
    code: "iron",
    basis: "rda",
    male: [11, 8, 8, 8, 8],
    female: [15, 18, 18, 8, 8],
    ul: same(45),
    ulScope: "total",
  },
  {
    code: "magnesium",
    basis: "rda",
    male: [410, 400, 420, 420, 420],
    female: [360, 310, 320, 320, 320],
    ul: same(350),
    ulScope: "supplements",
    note: "the upper limit is for magnesium from supplements and medicines only",
  },
  {
    code: "phosphorus",
    basis: "rda",
    male: same(1250, 700),
    female: same(1250, 700),
    ul: [4000, 4000, 4000, 4000, 3000],
    ulScope: "total",
  },
  {
    code: "selenium",
    basis: "rda",
    male: same(55),
    female: same(55),
    ul: same(400),
    ulScope: "total",
  },
  {
    code: "zinc",
    basis: "rda",
    male: same(11),
    female: same(9, 8),
    ul: same(34, 40),
    ulScope: "total",
  },
  {
    code: "potassium",
    basis: "ai",
    male: same(3000, 3400),
    female: same(2300, 2600),
    ul: null,
    ulScope: null,
  },
  {
    code: "sodium",
    basis: "ai",
    male: same(1500),
    female: same(1500),
    // The Chronic Disease Risk Reduction intake: reduce intakes above 2,300 mg a day.
    ul: same(2300),
    ulScope: "total",
    note: "upper value is the Chronic Disease Risk Reduction intake (CDRR), not a UL",
  },
  {
    code: "fiber",
    basis: "ai",
    male: [38, 38, 38, 30, 30],
    female: [26, 25, 25, 21, 21],
    ul: null,
    ulScope: null,
    note: "14 g per 1,000 kcal; Cal uses that rule with the computed energy target when it can",
  },
  {
    code: "water",
    basis: "ai",
    male: same(3300, 3700),
    female: same(2300, 2700),
    ul: null,
    ulScope: null,
    note: "total water from drinks and food, g (1 g = 1 ml); not used as a daily target",
  },
];

export type DriValue = {
  code: NutrientCode;
  rda: number | null;
  ai: number | null;
  ul: number | null;
  ulScope: UlScope | null;
};

export type DriRow = DriValue & {
  sex: "female" | "male";
  ageMin: number;
  ageMax: number;
};

/** Every value as rows (for the dri_targets table). */
export const driRows = (): DriRow[] => {
  const rows: DriRow[] = [];
  for (const nutrient of DRI_NUTRIENTS)
    for (const sex of ["female", "male"] as const)
      DRI_AGE_BANDS.forEach(([ageMin, ageMax], band) => {
        const value = nutrient[sex][band] ?? null;
        rows.push({
          sex,
          ageMin,
          ageMax,
          code: nutrient.code,
          rda: nutrient.basis === "rda" ? value : null,
          ai: nutrient.basis === "ai" ? value : null,
          ul: nutrient.ul?.[band] ?? null,
          ulScope: nutrient.ul ? nutrient.ulScope : null,
        });
      });
  return rows;
};

/** The band index for an age, or -1 below 14 (the table starts at 14). */
export const driBand = (age: number) => {
  if (!Number.isFinite(age) || age < DRI_AGE_BANDS[0][0]) return -1;
  const index = DRI_AGE_BANDS.findIndex(([min, max]) => age >= min && age <= max);
  return index < 0 ? DRI_AGE_BANDS.length - 1 : index;
};

/** The DRI values for one person, or null when the age is outside the table. */
export const driFor = (sex: "female" | "male", age: number): DriValue[] | null => {
  const band = driBand(age);
  if (band < 0) return null;
  return DRI_NUTRIENTS.map((nutrient) => {
    const value = nutrient[sex][band] ?? null;
    return {
      code: nutrient.code,
      rda: nutrient.basis === "rda" ? value : null,
      ai: nutrient.basis === "ai" ? value : null,
      ul: nutrient.ul?.[band] ?? null,
      ulScope: nutrient.ul ? nutrient.ulScope : null,
    };
  });
};

/**
 * US Daily Values for adults and children 4 years and older (FDA, 21 CFR 101.9, 2016 rule),
 * used for vitamins and minerals until the profile has sex and birth year.
 */
export const DAILY_VALUES: Partial<Record<NutrientCode, number>> = {
  vit_a: 900,
  vit_c: 90,
  vit_d: 20,
  vit_e: 15,
  vit_k: 120,
  thiamin: 1.2,
  riboflavin: 1.3,
  niacin: 16,
  vit_b6: 1.7,
  folate: 400,
  vit_b12: 2.4,
  choline: 550,
  calcium: 1300,
  iron: 18,
  magnesium: 420,
  phosphorus: 1250,
  zinc: 11,
  copper: 0.9,
  selenium: 55,
  potassium: 4700,
};
