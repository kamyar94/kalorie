// Body as plain logic: better / steady / worse from the goal, units, input checks for a day's
// measurements and imported values, a Renpho scale's CSV (units in the headers, day or month
// first), Samsung Health's weight file, the mapping step for measurements, and the health notes in
// the analysis prompt only when allowed.
import { describe, expect, it } from "vitest";

import { buildAnalysisPrompt, type AnalysisContext } from "@/lib/analysis/prompt";
import { parseImportedMeasurement, parseNewMeasurements } from "@/lib/body/parse";
import {
  customCode,
  formatChange,
  fromDisplay,
  judgeChange,
  measureInfo,
  toDisplay,
} from "@/lib/contracts/body";
import { parseCsv } from "@/lib/imports/csv";
import { applyMapping, guessMapping } from "@/lib/imports/mapping";
import { readCsv, type MeasurementDataset } from "@/lib/imports/read";
import { isRenphoHeader, renphoColumns, renphoMeasurements } from "@/lib/imports/renpho";
import { samsungTable, samsungWeights } from "@/lib/imports/samsung";

const info = (code: string) => measureInfo(code)!;

describe("better, steady or worse", () => {
  it("judges fat and waist down as better, muscle down as worse, whatever the goal", () => {
    for (const goal of ["lose", "keep", "gain", null] as const) {
      expect(judgeChange(info("waist"), -3, goal)).toBe("better");
      expect(judgeChange(info("body_fat"), -0.8, goal)).toBe("better");
      expect(judgeChange(info("visceral_fat"), 1, goal)).toBe("worse");
      expect(judgeChange(info("muscle"), -1.2, goal)).toBe("worse");
      expect(judgeChange(info("muscle"), -0.2, goal)).toBe("steady");
    }
  });

  it("judges weight and other sizes from the goal", () => {
    expect(judgeChange(info("weight"), -2.4, "lose")).toBe("better");
    expect(judgeChange(info("weight"), 2.4, "lose")).toBe("worse");
    expect(judgeChange(info("weight"), 2.4, "gain")).toBe("better");
    expect(judgeChange(info("weight"), -1, "keep")).toBe("worse");
    expect(judgeChange(info("weight"), 0.3, "keep")).toBe("steady");
    expect(judgeChange(info("weight"), -1, null)).toBe("changed");
    expect(judgeChange(info("hips"), -2, "lose")).toBe("better");
    expect(judgeChange(info("upper_arm_r"), 2, "gain")).toBe("better");
    expect(judgeChange(info("upper_arm_r"), 0.5, "lose")).toBe("steady");
    expect(judgeChange(info("chest"), 2, "keep")).toBe("changed");
    expect(judgeChange(info("bmr"), 50, "lose")).toBe("changed");
    expect(judgeChange(measureInfo("waist_to_height")!, -0.02, "lose")).toBe("better");
  });

  it("formats changes with a real minus sign and converts imperial units", () => {
    expect(formatChange(-3, 1)).toBe("−3");
    expect(formatChange(0.5, 1)).toBe("+0.5");
    expect(formatChange(0.04, 1)).toBe("0");
    expect(toDisplay(100, "kg", "imperial").unit).toBe("lb");
    expect(toDisplay(100, "kg", "imperial").value).toBeCloseTo(220.46, 1);
    expect(toDisplay(2.54, "cm", "imperial")).toEqual({ value: 1, unit: "in" });
    expect(toDisplay(31.2, "%", "imperial")).toEqual({ value: 31.2, unit: "%" });
    expect(fromDisplay(220.462, "kg", "imperial")).toBeCloseTo(100, 2);
    expect(customCode("Arm span (left)")).toBe("custom:arm-span-left");
  });
});

describe("a day's measurements", () => {
  const today = "2026-11-10";
  const base = { localDate: today, tz: "Europe/Berlin" };

  it("keeps known measures and named parts, refuses odd values and future days", () => {
    expect(
      parseNewMeasurements(
        {
          ...base,
          values: [
            { code: "weight", value: 80.43 },
            { code: "waist", value: 92 },
            { code: "custom:", label: " Arm span ", unit: "cm", value: 180 },
            { code: "shoe_size", value: 44 },
            { code: "waist", value: 93 },
          ],
        },
        today,
      ),
    ).toEqual({
      ...base,
      values: [
        { code: "weight", value: 80.43, label: null, unit: null },
        { code: "waist", value: 92, label: null, unit: null },
        { code: "custom:arm-span", value: 180, label: "Arm span", unit: "cm" },
      ],
    });
    expect(
      parseNewMeasurements({ ...base, values: [{ code: "weight", value: 900 }] }, today),
    ).toEqual({
      error: "Weight: that value looks wrong.",
    });
    expect(
      parseNewMeasurements({ ...base, values: [{ code: "custom:", value: 3 }] }, today),
    ).toEqual({
      error: "Give each extra part a name and a unit.",
    });
    expect(parseNewMeasurements({ ...base, values: [] }, today)).toEqual({
      error: "Fill in at least one measurement.",
    });
    expect(
      parseNewMeasurements(
        { ...base, localDate: "2026-11-11", values: [{ code: "weight", value: 80 }] },
        today,
      ),
    ).toEqual({ error: "Choose a day that is not in the future." });
  });

  it("checks imported values: a known measure, a usable value, a time", () => {
    const now = Date.parse("2026-11-10T12:00:00Z");
    const record = {
      externalId: "renpho:2026-11-09T07:00:00.000Z:weight",
      sourceApp: "renpho",
      code: "weight",
      value: 80.4,
      measuredAt: "2026-11-09T07:00:00.000Z",
      tz: "UTC",
    };
    expect(parseImportedMeasurement(record, now)).toEqual(record);
    expect(parseImportedMeasurement({ ...record, code: "custom:x" }, now)).toBeNull();
    expect(parseImportedMeasurement({ ...record, value: -1 }, now)).toBeNull();
    expect(
      parseImportedMeasurement({ ...record, measuredAt: "2027-01-01T00:00:00Z" }, now),
    ).toBeNull();
  });
});

describe("a Renpho export", () => {
  const csv = [
    "Time of Measurement,Weight(lb),BMI,Body Fat(%),Fat-free Body Weight(lb),Subcutaneous Fat(%),Visceral Fat,Body Water(%),Skeletal Muscle(%),Muscle Mass(lb),Bone Mass(lb),Protein (%),BMR(kcal),Metabolic Age,Optimal weight(lb),Remarks",
    '"11/14/2023, 7:59:12 AM",250.4,33.2,31.2,172.3,27.4,14,49.1,48.2,165.1,8.6,16.1,2140,52,180.0,',
    '"11/20/2023, 8:01:00 AM",249.0,33.0,30.9,--,--,14,49.3,--,165.0,--,--,--,--,,',
  ].join("\n");

  it("finds the columns by keyword, with their units", () => {
    const headers = parseCsv(csv)[0]!;
    expect(isRenphoHeader(headers)).toBe(true);
    expect(renphoColumns(headers).map((c) => [c.code, c.unit])).toEqual([
      ["weight", "lb"],
      ["bmi", null],
      ["body_fat", null],
      ["fat_free", "lb"],
      ["subcutaneous_fat", null],
      ["visceral_fat", null],
      ["water", null],
      ["skeletal_muscle", null],
      ["muscle", "lb"],
      ["bone", "lb"],
      ["protein", null],
      ["bmr", null],
      ["metabolic_age", null],
    ]);
    expect(isRenphoHeader(["Date", "Steps"])).toBe(false);
  });

  it("reads every value of every weigh-in, masses in kg, dashes skipped", () => {
    const read = renphoMeasurements(parseCsv(csv), "America/New_York");
    expect(read.weighIns).toBe(2);
    const first = read.records.filter((r) => r.measuredAt === "2023-11-14T12:59:00.000Z");
    expect(first).toHaveLength(13);
    expect(first.find((r) => r.code === "weight")).toMatchObject({
      value: 113.58,
      externalId: "renpho:2023-11-14T12:59:00.000Z:weight",
      sourceApp: "renpho",
    });
    expect(first.find((r) => r.code === "body_fat")!.value).toBe(31.2);
    expect(read.records.filter((r) => r.measuredAt.startsWith("2023-11-20"))).toHaveLength(6);
    // Read through the picker: one dataset of weigh-ins.
    const result = readCsv("renpho.csv", csv, "America/New_York");
    const dataset = result.datasets[0] as MeasurementDataset;
    expect(dataset).toMatchObject({
      kind: "measurements",
      app: "renpho",
      label: "Weight and body composition: 2 weigh-ins",
      first: "2023-11-14",
      last: "2023-11-20",
    });
  });

  it("reads day-first dates and separate date and time columns", () => {
    const read = renphoMeasurements(
      parseCsv("Date,Time,Weight(kg),Body Fat(%)\n14/11/2023,07:59,113.6,31.2\n"),
      "UTC",
    );
    expect(read.records.map((r) => [r.code, r.value, r.measuredAt])).toEqual([
      ["weight", 113.6, "2023-11-14T07:59:00.000Z"],
      ["body_fat", 31.2, "2023-11-14T07:59:00.000Z"],
    ]);
  });
});

describe("Samsung Health weight and the mapping step", () => {
  it("reads weight and composition, body water as a share of the weight", () => {
    const rows = parseCsv(
      [
        "com.samsung.health.weight,6315012,12",
        "com.samsung.health.weight.start_time,com.samsung.health.weight.weight,com.samsung.health.weight.body_fat,com.samsung.health.weight.skeletal_muscle_mass,com.samsung.health.weight.total_body_water,com.samsung.health.weight.basal_metabolic_rate,com.samsung.health.weight.time_offset,com.samsung.health.weight.datauuid",
        "2024-05-01 05:30:00.000,80.0,24.5,35.1,44.0,1750,UTC+0200,w-1",
        "2024-05-02 05:30:00.000,12,,,,,UTC+0200,w-2",
      ].join("\n"),
    );
    const values = samsungWeights(
      samsungTable(rows, "com.samsung.health.weight.20240501.csv")!,
      "UTC",
    );
    expect(values.map((v) => [v.code, v.value])).toEqual([
      ["weight", 80],
      ["body_fat", 24.5],
      ["muscle", 35.1],
      ["water", 55],
      ["bmr", 1750],
    ]);
    expect(values[0]).toMatchObject({
      externalId: "samsung:weight:w-1:weight",
      tz: "Etc/GMT-2",
      measuredAt: "2024-05-01T05:30:00.000Z",
    });
  });

  it("maps a file of weigh-ins in pounds and a waist column", () => {
    const [headers, ...body] = parseCsv("When,Weight lbs,Fat %,Waist\n2024-05-01,176,22,90\n");
    const mapping = guessMapping(headers!, body);
    expect(mapping).toMatchObject({
      kind: "measurements",
      massUnit: "lb",
      fields: { weight: 1, body_fat: 2, waist: 3 },
    });
    const read = applyMapping(body, mapping, "UTC");
    expect(read.measurements.map((m) => [m.code, m.value])).toEqual([
      ["weight", 79.83],
      ["body_fat", 22],
      ["waist", 90],
    ]);
  });
});

describe("the health notes in the analysis prompt", () => {
  const context: AnalysisContext = {
    photoCount: 1,
    note: null,
    localTime: "12:30",
    weekday: "Tuesday",
    slot: "lunch",
    units: "metric",
    cuisines: [],
    usual: [],
    planned: [],
    answers: [],
    corrections: [],
    current: [],
  };

  it("are only in the prompt when given (the person turned them on)", () => {
    expect(buildAnalysisPrompt(context).prompt).not.toMatch(/health profile/);
    const prompt = buildAnalysisPrompt({
      ...context,
      health: { allergies: "peanuts", conditions: "" },
    }).prompt;
    expect(prompt).toContain('allergies: "peanuts"');
    expect(prompt).toContain("give no medical advice");
    expect(prompt).not.toContain("health conditions");
  });
});
