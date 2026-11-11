// CONTRACT: Body (boards 11 and 12). Measurements by date (scale values and tape measurements,
// custom parts with their own unit), the merged weight history, changes judged against the
// person's goal, and the private health profile. Plain data, safe for client components.
//
// Every measurement has a source (manual, opengym, import; health_connect is reserved for the
// Android helper) and, from elsewhere, an external id, so imports and syncs update instead of
// copying. Values are stored metric (kg, cm, %); the screens convert for imperial units.
//
// Server functions (lib/body/service.ts), scoped by user id:
//   logMeasurements(userId, NewMeasurements)       -> MeasurementDto[]
//   deleteMeasurement(userId, id)                  -> "deleted" | "not-found" | "synced"
//   importMeasurements(userId, ImportedMeasurement[]) -> ImportResult
//   getBodySummary(userId, today, since?)          -> BodySummaryDto
//   getHealthProfile / saveHealthProfile           (lib/body/health.ts)
// HTTP: POST /api/body/measurements, DELETE /api/body/measurements/:id,
// POST /api/imports/measurements, PUT /api/body/health.
import type { ActivitySource } from "./activities";
import type { WeightPointDto } from "./integrations";
import type { Goal } from "./targets";

/**
 * How a change of a measure is judged: fat (down is better), muscle (up is better), mass (weight
 * and BMI: by the goal), size (tape measurements: by the goal, waist always down), water (up is
 * better), neutral (Kal does not judge it).
 */
export type MeasureJudge = "fat" | "muscle" | "mass" | "size" | "water" | "neutral";

export type MeasureInfo = {
  code: string;
  label: string;
  unit: string;
  group: "scale" | "tape" | "ratio";
  judge: MeasureJudge;
  /** A change smaller than this is "steady". */
  steady: number;
  decimals: number;
  /** How to measure it (board 12). */
  hint?: string;
};

const tape = (code: string, label: string, hint: string, judge: MeasureJudge = "size") =>
  ({ code, label, unit: "cm", group: "tape", judge, steady: 1, decimals: 1, hint }) as const;

export const MEASURES: MeasureInfo[] = [
  {
    code: "weight",
    label: "Weight",
    unit: "kg",
    group: "scale",
    judge: "mass",
    steady: 0.5,
    decimals: 1,
  },
  {
    code: "body_fat",
    label: "Body fat",
    unit: "%",
    group: "scale",
    judge: "fat",
    steady: 0.5,
    decimals: 1,
  },
  {
    code: "muscle",
    label: "Muscle",
    unit: "kg",
    group: "scale",
    judge: "muscle",
    steady: 0.5,
    decimals: 1,
  },
  {
    code: "skeletal_muscle",
    label: "Skeletal muscle",
    unit: "%",
    group: "scale",
    judge: "muscle",
    steady: 0.5,
    decimals: 1,
  },
  {
    code: "water",
    label: "Body water",
    unit: "%",
    group: "scale",
    judge: "water",
    steady: 0.5,
    decimals: 1,
  },
  {
    code: "visceral_fat",
    label: "Visceral fat",
    unit: "",
    group: "scale",
    judge: "fat",
    steady: 0.5,
    decimals: 0,
  },
  {
    code: "subcutaneous_fat",
    label: "Subcutaneous fat",
    unit: "%",
    group: "scale",
    judge: "fat",
    steady: 0.5,
    decimals: 1,
  },
  {
    code: "fat_free",
    label: "Fat-free mass",
    unit: "kg",
    group: "scale",
    judge: "muscle",
    steady: 0.5,
    decimals: 1,
  },
  {
    code: "bone",
    label: "Bone mass",
    unit: "kg",
    group: "scale",
    judge: "neutral",
    steady: 0.1,
    decimals: 1,
  },
  {
    code: "protein",
    label: "Protein",
    unit: "%",
    group: "scale",
    judge: "muscle",
    steady: 0.5,
    decimals: 1,
  },
  {
    code: "bmr",
    label: "BMR",
    unit: "kcal",
    group: "scale",
    judge: "neutral",
    steady: 20,
    decimals: 0,
  },
  {
    code: "metabolic_age",
    label: "Metabolic age",
    unit: "years",
    group: "scale",
    judge: "fat",
    steady: 1,
    decimals: 0,
  },
  { code: "bmi", label: "BMI", unit: "", group: "scale", judge: "mass", steady: 0.2, decimals: 1 },
  tape("neck", "Neck", "below the Adam's apple"),
  tape("shoulders", "Shoulders", "around the widest part, arms down"),
  tape("chest", "Chest", "across the nipples, breathing out"),
  tape("waist", "Waist", "at the navel, relaxed, breathing out", "fat"),
  tape("hips", "Hips", "at the widest point of the buttocks"),
  tape("upper_arm_l", "Upper arm (left)", "halfway between shoulder and elbow, relaxed"),
  tape("upper_arm_r", "Upper arm (right)", "halfway between shoulder and elbow, relaxed"),
  tape("forearm_l", "Forearm (left)", "at the widest part, relaxed"),
  tape("forearm_r", "Forearm (right)", "at the widest part, relaxed"),
  tape("wrist", "Wrist", "just above the wrist bone"),
  tape("thigh_l", "Thigh (left)", "just below the buttock, standing"),
  tape("thigh_r", "Thigh (right)", "just below the buttock, standing"),
  tape("calf_l", "Calf (left)", "at the widest part, standing"),
  tape("calf_r", "Calf (right)", "at the widest part, standing"),
];

/** Ratios Kal works out (never stored): waist to height, waist to hip. */
export const RATIOS: MeasureInfo[] = [
  {
    code: "waist_to_height",
    label: "Waist to height",
    unit: "",
    group: "ratio",
    judge: "fat",
    steady: 0.01,
    decimals: 2,
  },
  {
    code: "waist_to_hip",
    label: "Waist to hip",
    unit: "",
    group: "ratio",
    judge: "fat",
    steady: 0.01,
    decimals: 2,
  },
];

export const CUSTOM_PREFIX = "custom:";
export const CUSTOM_UNITS = ["cm", "mm", "in", "kg", "%"] as const;

export const measureInfo = (code: string, label?: string | null, unit?: string | null) =>
  MEASURES.find((m) => m.code === code) ??
  RATIOS.find((m) => m.code === code) ??
  (code.startsWith(CUSTOM_PREFIX)
    ? ({
        code,
        label: label || code.slice(CUSTOM_PREFIX.length),
        unit: unit ?? "cm",
        group: "tape",
        judge: "neutral",
        steady: unit === "mm" ? 5 : unit === "in" ? 0.25 : 1,
        decimals: 1,
      } satisfies MeasureInfo)
    : null);

export const isKnownMeasure = (code: string) => MEASURES.some((m) => m.code === code);

/** "Left calf" -> "custom:left-calf". */
export const customCode = (label: string) =>
  `${CUSTOM_PREFIX}${label
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40)}`;

/** Lowest and highest value accepted per unit (anything else is a typing mistake). */
export const VALUE_LIMITS: Record<string, [number, number]> = {
  kg: [0.1, 400],
  "%": [0.1, 100],
  cm: [1, 300],
  mm: [1, 3000],
  in: [0.5, 120],
  kcal: [300, 6000],
  years: [5, 120],
  "": [0.1, 100],
};

export type Verdict = "better" | "steady" | "worse" | "changed";

/**
 * better / steady / worse for a change of a measure, from the person's goal: waist, fat and
 * visceral fat down are better; muscle down is worse; weight and other sizes follow the goal
 * (lose: down is better; gain: up is better; keep: moving away is worse). "changed" when Kal does
 * not judge it (bone mass, BMR, a size without a goal).
 */
export const judgeChange = (info: MeasureInfo, change: number, goal: Goal | null): Verdict => {
  if (Math.abs(change) < info.steady - 1e-9) return "steady";
  const down = change < 0;
  switch (info.judge) {
    case "fat":
      return down ? "better" : "worse";
    case "muscle":
    case "water":
      return down ? "worse" : "better";
    case "mass":
      if (goal === "lose") return down ? "better" : "worse";
      if (goal === "gain") return down ? "worse" : "better";
      return goal === "keep" ? "worse" : "changed";
    case "size":
      if (goal === "lose") return down ? "better" : "worse";
      if (goal === "gain") return down ? "worse" : "better";
      return "changed";
    default:
      return "changed";
  }
};

export type MeasurementSource = ActivitySource;

export type MeasurementDto = {
  id: string;
  code: string;
  label: string;
  unit: string;
  value: number;
  measuredAt: string;
  localDate: string;
  source: MeasurementSource;
  sourceApp: string | null;
};

/** "+ Log" (board 12): what was measured on one day. */
export type NewMeasurements = {
  localDate: string;
  tz: string;
  values: { code: string; value: number; label?: string | null; unit?: string | null }[];
};

/** One value read from an export file on the device (lib/imports). */
export type ImportedMeasurement = {
  externalId: string;
  sourceApp: string;
  code: string;
  value: number;
  measuredAt: string;
  tz: string;
};

/** A measure now and at the compared date, with the change judged. */
export type MeasureStatDto = {
  code: string;
  label: string;
  unit: string;
  decimals: number;
  group: MeasureInfo["group"];
  value: number;
  date: string;
  /** The value on or before the compared date (or the first after it), null without one. */
  then: number | null;
  thenDate: string | null;
  change: number | null;
  verdict: Verdict | null;
};

export type WeightEntryDto = {
  id: string;
  date: string;
  kg: number;
  source: MeasurementSource;
  sourceApp: string | null;
};

export type BodySummaryDto = {
  goal: Goal | null;
  goalRateKgPerWeek: number | null;
  heightCm: number | null;
  /** Latest of every measure with data, with its change since `since`. */
  stats: MeasureStatDto[];
  /** The weight change over the last 30 days. */
  weight30: { change: number; verdict: Verdict; days: number } | null;
  /** One weight a day for the chart (the last 90 days), oldest first. */
  weights: WeightPointDto[];
  /** Every weigh-in, newest first (one a day per source). */
  weightHistory: WeightEntryDto[];
  /** Where the weigh-ins came from ("Renpho", "openGym", "Kal"). */
  weightSources: string[];
  since: string | null;
  /** Days with measurements, newest first: the choices for "Compare with". */
  sinceOptions: string[];
};

export type HealthProfileDto = {
  conditions: string;
  allergies: string;
  notes: string;
  /** Allergies and conditions go with meal analyses (off unless the person turns it on). */
  useInAnalysis: boolean;
  heightCm: number | null;
  birthYear: number | null;
  goal: Goal | null;
  goalRateKgPerWeek: number | null;
};

export const HEALTH_LIMITS = { textChars: 2000 } as const;

export const KG_PER_LB = 0.45359237;
export const CM_PER_IN = 2.54;

/** A metric value in the person's units: lb for kg, in for cm (other units as they are). */
export const toDisplay = (value: number, unit: string, units: "metric" | "imperial") =>
  units === "imperial" && unit === "kg"
    ? { value: value / KG_PER_LB, unit: "lb" }
    : units === "imperial" && unit === "cm"
      ? { value: value / CM_PER_IN, unit: "in" }
      : { value, unit };

/** What the person typed in their units, back to the stored metric unit. */
export const fromDisplay = (value: number, unit: string, units: "metric" | "imperial") =>
  units === "imperial" && unit === "kg"
    ? value * KG_PER_LB
    : units === "imperial" && unit === "cm"
      ? value * CM_PER_IN
      : value;

/** "113.6", "0.65", "14". */
export const formatMeasure = (value: number, decimals: number) =>
  value.toLocaleString("en-US", { maximumFractionDigits: decimals, minimumFractionDigits: 0 });

/** "−0.8", "+0.3", "0" (a real minus sign). */
export const formatChange = (change: number, decimals: number) => {
  const rounded = Number(change.toFixed(decimals));
  if (rounded === 0) return "0";
  return `${rounded > 0 ? "+" : "−"}${formatMeasure(Math.abs(rounded), decimals)}`;
};
