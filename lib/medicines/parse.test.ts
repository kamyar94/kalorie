import { describe, expect, it } from "vitest";

import { formatDose, MEDICINE_FORMS, medicineTitle, unitFor } from "@/lib/contracts/medicines";

import { MEDICINE_LABEL_SCHEMA } from "./label";
import { parseMedicineLog, parseMedicinePatch, parseMedicineReading } from "./parse";

const now = Date.now();
const iso = (msAgo: number) => new Date(now - msAgo).toISOString();

describe("doses and names", () => {
  it("counts tablets, capsules and millilitres in words", () => {
    expect(formatDose(2, "tablet")).toBe("2 tablets");
    expect(formatDose(1, "tablets")).toBe("1 tablet");
    expect(formatDose(0.5, "tablet")).toBe("0.5 tablets");
    expect(formatDose(1, "capsule")).toBe("1 capsule");
    expect(formatDose(5, "ml")).toBe("5 ml");
    expect(formatDose(3, null)).toBe("3");
    expect(formatDose(1, "scoop")).toBe("1 scoop");
    expect(unitFor("tablet", 1)).toBe("tablet");
    expect(unitFor("drops", 3)).toBe("drops");
    expect(unitFor(null, 1)).toBeNull();
    expect(medicineTitle({ name: "Ibuprofen", strength: "200 mg" })).toBe("Ibuprofen 200 mg");
    expect(medicineTitle({ name: "Omega-3", strength: null })).toBe("Omega-3");
  });
});

describe("medicine input", () => {
  it("keeps only valid fields", () => {
    expect(
      parseMedicinePatch({
        name: "  Vitamin   D ",
        strength: " 1000 IU ",
        form: "tablet",
        usualAmount: 1,
        notes: " with breakfast ",
        archived: true,
        evil: "x",
      }),
    ).toEqual({
      name: "Vitamin D",
      strength: "1000 IU",
      form: "tablet",
      usualAmount: 1,
      notes: "with breakfast",
      archived: true,
    });
    expect(parseMedicinePatch({ form: "pill", usualAmount: -1, strength: 5 })).toEqual({});
    expect(parseMedicinePatch({ strength: null, form: null, notes: "" })).toEqual({
      strength: null,
      form: null,
      notes: null,
    });
    expect(parseMedicinePatch({ usualAmount: 101 })).toEqual({});
  });

  it("needs a name or a medicine of the list, and a time in the past year", () => {
    expect(parseMedicineLog({ name: "Ibuprofen", takenAt: iso(0), tz: "UTC" })).toMatchObject({
      name: "Ibuprofen",
      tz: "UTC",
    });
    const id = "6f1c7d1e-6b39-4c1e-9b0b-2d1f6e7f8a90";
    expect(parseMedicineLog({ medicineId: id, takenAt: iso(60_000) })).toMatchObject({
      medicineId: id,
    });
    expect(parseMedicineLog({ takenAt: iso(0) })).toEqual({ error: "Write the medicine's name." });
    expect(parseMedicineLog({ name: "X", takenAt: iso(-3_600_000) })).toEqual({
      error: "Pick a time in the past year.",
    });
    expect(parseMedicineLog({ name: "X", takenAt: iso(400 * 86_400_000) })).toHaveProperty("error");
    expect(parseMedicineLog({ name: "X", takenAt: iso(0), amount: 0 })).toHaveProperty("error");
    expect(
      parseMedicineLog({
        name: "X",
        takenAt: iso(0),
        amount: 1.5,
        form: "capsule",
        scanId: "not-an-id",
        keep: true,
      }),
    ).toMatchObject({ amount: 1.5, form: "capsule", keep: true });
    expect(
      parseMedicineLog({ name: "X", takenAt: iso(0), scanId: "not-an-id" }),
    ).not.toHaveProperty("scanId");
  });
});

describe("reading a label", () => {
  it("asks for strict JSON that every provider accepts", () => {
    const schema = MEDICINE_LABEL_SCHEMA as {
      additionalProperties: boolean;
      required: string[];
      properties: Record<string, { enum?: string[]; items?: { required: string[] } }>;
    };
    expect(schema.additionalProperties).toBe(false);
    expect(schema.required.sort()).toEqual(Object.keys(schema.properties).sort());
    expect(schema.properties.form!.enum).toEqual([...MEDICINE_FORMS, "unknown"]);
    expect(schema.properties.active_ingredients!.items!.required).toEqual(["name", "strength"]);
    expect(JSON.stringify(schema)).not.toMatch(/"(format|pattern|minLength|maxLength)"/);
  });

  it("keeps a medicine with a name, and nothing else", () => {
    expect(
      parseMedicineReading({
        is_medicine: true,
        name: " Ibuprofen ",
        strength: "200 mg",
        form: "tablet",
        active_ingredients: [
          { name: "Ibuprofen", strength: "200 mg" },
          { name: "", strength: "1 mg" },
        ],
      }),
    ).toEqual({
      name: "Ibuprofen",
      strength: "200 mg",
      form: "tablet",
      ingredients: [{ name: "Ibuprofen", strength: "200 mg" }],
    });
    expect(
      parseMedicineReading({
        is_medicine: true,
        name: "Omega-3",
        strength: "",
        form: "unknown",
        active_ingredients: [],
      }),
    ).toEqual({ name: "Omega-3", strength: null, form: null, ingredients: [] });
    expect(parseMedicineReading({ is_medicine: false, name: "Shampoo" })).toBeNull();
    expect(parseMedicineReading({ is_medicine: true, name: "  " })).toBeNull();
    expect(parseMedicineReading("Ibuprofen")).toBeNull();
  });
});
