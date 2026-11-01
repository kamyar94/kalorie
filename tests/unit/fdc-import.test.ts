// The FoodData Central importer's pieces: streaming CSV, the ZIP reader, nutrient mapping and
// household portions. The import itself runs against Postgres in tests/integration.
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Readable } from "node:stream";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { buildNutrientMap, FDC_RELEASES, portionFromRow } from "@/scripts/fdc-import.mjs";
import { csvRecords, csvRows } from "@/scripts/lib/csv.mjs";
import { findEntry, listZip, openZipEntry } from "@/scripts/lib/zip.mjs";

import { makeZip } from "../helpers/zip";

const collect = async <T>(iterable: AsyncIterable<T>) => {
  const out: T[] = [];
  for await (const item of iterable) out.push(item);
  return out;
};

/** The text in chunks of n characters, to test values split across chunks. */
const chunks = (text: string, n: number) => {
  const parts: string[] = [];
  for (let i = 0; i < text.length; i += n) parts.push(text.slice(i, i + n));
  return Readable.from(parts);
};

const streamText = async (stream: NodeJS.ReadableStream) => {
  const parts: Buffer[] = [];
  for await (const part of stream) parts.push(Buffer.from(part as Buffer));
  return Buffer.concat(parts).toString("utf8");
};

describe("CSV", () => {
  const text =
    '﻿"id","name","note"\r\n"1","Rice, white, cooked","say ""hi"""\r\n2,plain,\n"3","two\nlines",""\n4,,x';

  it("reads quoted fields, doubled quotes, line breaks and empty fields in any chunking", async () => {
    const expected = [
      ["id", "name", "note"],
      ["1", "Rice, white, cooked", 'say "hi"'],
      ["2", "plain", ""],
      ["3", "two\nlines", ""],
      ["4", "", "x"],
    ];
    for (const size of [1, 2, 3, 7, 1000])
      expect(await collect(csvRows(chunks(text, size)))).toEqual(expected);
  });

  it("decodes UTF-8 split across buffers and keys rows by the header", async () => {
    const bytes = Buffer.from('"fa","en"\n"قورمه‌سبزی","herb stew"\n', "utf8");
    const pieces = [bytes.subarray(0, 13), bytes.subarray(13, 14), bytes.subarray(14)];
    expect(await collect(csvRecords(Readable.from(pieces)))).toEqual([
      { fa: "قورمه‌سبزی", en: "herb stew" },
    ]);
  });
});

describe("ZIP reader", () => {
  let dir: string;
  beforeAll(async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), "cal-zip-"));
  });
  afterAll(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("lists entries and streams stored and deflated ones", async () => {
    const big = "x,y\n".repeat(50_000);
    const file = path.join(dir, "a.zip");
    await writeFile(
      file,
      makeZip([
        { name: "release/", data: "", method: "store" },
        { name: "release/food.csv", data: big },
        { name: "release/nutrient.csv", data: "id\n1008\n", method: "store" },
      ]),
    );
    const entries = await listZip(file);
    expect(entries.map((e) => e.name)).toEqual([
      "release/",
      "release/food.csv",
      "release/nutrient.csv",
    ]);
    expect(await streamText(await openZipEntry(file, findEntry(entries, "food.csv")))).toBe(big);
    expect(await streamText(await openZipEntry(file, findEntry(entries, "nutrient.csv")))).toBe(
      "id\n1008\n",
    );
    expect(findEntry(entries, "missing.csv")).toBeNull();
  });

  it("understands ZIP64 sizes and offsets", async () => {
    const file = path.join(dir, "b.zip");
    await writeFile(file, makeZip([{ name: "x/food.csv", data: "a,b\n1,2\n" }], { zip64: true }));
    const entries = await listZip(file);
    expect(entries[0]).toMatchObject({ name: "x/food.csv", size: 8 });
    expect(await streamText(await openZipEntry(file, entries[0]))).toBe("a,b\n1,2\n");
  });

  it("refuses what is not a ZIP file", async () => {
    const file = path.join(dir, "c.zip");
    await writeFile(file, "not a zip at all");
    await expect(listZip(file)).rejects.toThrow(/not a ZIP/);
  });
});

describe("nutrient mapping", () => {
  it("fills each code from its first FDC id and keeps every other value as fdc:<id>", () => {
    const values = new Map([
      [1008, 130], // energy kcal
      [2047, 128], // Atwater general: not chosen, kept
      [1003, 2.69], // protein
      [1004, 0.28], // fat
      [1005, 28.2], // carbs by difference
      [1050, 27.9], // carbs by summation: kept
      [1062, 544], // kJ: kept
      [1093, 1], // sodium
      [1007, 0.4], // ash: not in the catalogue
    ]);
    const { map, derivedEnergy } = buildNutrientMap(values);
    expect(derivedEnergy).toBe(false);
    expect(map).toMatchObject({
      energy: 130,
      protein: 2.69,
      fat: 0.28,
      carbs: 28.2,
      sodium: 1,
      "fdc:2047": 128,
      "fdc:1050": 27.9,
      "fdc:1062": 544,
      "fdc:1007": 0.4,
    });
    expect(map["fdc:1008"]).toBeUndefined();
  });

  it("prefers Atwater energy when 1008 is missing, then kJ, then the macros", () => {
    expect(
      buildNutrientMap(
        new Map([
          [2048, 99],
          [1062, 400],
        ]),
      ).map.energy,
    ).toBe(99);
    const kj = buildNutrientMap(new Map([[1062, 418.4]]));
    expect(kj.map.energy).toBe(100);
    expect(kj.derivedEnergy).toBe(true);
    const macros = buildNutrientMap(
      new Map([
        [1003, 10],
        [1004, 10],
        [1005, 10],
      ]),
    );
    expect(macros.map.energy).toBe(170);
    expect(macros.derivedEnergy).toBe(true);
    expect(buildNutrientMap(new Map([[1093, 5]])).map.energy).toBeUndefined();
  });

  it("keeps a value in another unit only as fdc:<id>", () => {
    const units = new Map([
      [1114, "IU"],
      [1162, "MG"],
    ]);
    const { map } = buildNutrientMap(
      new Map([
        [1114, 40],
        [1162, 5],
      ]),
      units,
    );
    expect(map.vit_d).toBeUndefined();
    expect(map["fdc:1114"]).toBe(40);
    expect(map.vit_c).toBe(5);
  });
});

describe("household portions", () => {
  const units = new Map([
    ["1000", "cup"],
    ["1001", "tablespoon"],
    ["9999", "undetermined"],
  ]);

  it("reads SR Legacy portions (unit in the modifier)", () => {
    expect(
      portionFromRow(
        { amount: "1", measure_unit_id: "9999", modifier: "cup, chopped", gram_weight: "160" },
        units,
        "sr_legacy",
      ),
    ).toEqual({ label: "1 cup, chopped", amount: 1, unit: "cup", grams: 160 });
    expect(
      portionFromRow(
        { amount: "0.5", measure_unit_id: "9999", modifier: "", gram_weight: "50" },
        units,
        "sr_legacy",
      ),
    ).toEqual({ label: "0.5 portion", amount: 0.5, unit: "portion", grams: 50 });
  });

  it("reads Foundation portions (unit in measure_unit)", () => {
    expect(
      portionFromRow(
        { amount: "2.0", measure_unit_id: "1001", portion_description: "", gram_weight: "35.8" },
        units,
        "foundation",
      ),
    ).toEqual({ label: "2 tablespoon", amount: 2, unit: "tablespoon", grams: 35.8 });
  });

  it("reads FNDDS portions (description; the modifier is a code)", () => {
    expect(
      portionFromRow(
        {
          portion_description: "1 cup, cooked",
          modifier: "10205",
          measure_unit_id: "9999",
          gram_weight: "158",
        },
        units,
        "fndds",
      ),
    ).toEqual({ label: "1 cup, cooked", amount: 1, unit: "cup", grams: 158 });
    expect(
      portionFromRow(
        { portion_description: "1 1/2 cups", measure_unit_id: "9999", gram_weight: "240" },
        units,
        "fndds",
      ),
    ).toMatchObject({ amount: 1.5, unit: "cups" });
    expect(
      portionFromRow(
        {
          portion_description: "Quantity not specified",
          measure_unit_id: "9999",
          gram_weight: "118",
        },
        units,
        "fndds",
      ),
    ).toEqual({ label: "Typical portion", amount: 1, unit: "portion", grams: 118 });
    expect(
      portionFromRow(
        { portion_description: "Quantity not specified", gram_weight: "0.0" },
        units,
        "fndds",
      ),
    ).toBeNull();
  });
});

describe("pinned releases", () => {
  it("records an official URL and a SHA-256 for each release", () => {
    for (const release of Object.values(FDC_RELEASES)) {
      expect(release.file).toMatch(/^FoodData_Central_[a-z_]+_csv_[\d-]+\.zip$/);
      expect(release.sha256).toMatch(/^[0-9a-f]{64}$/);
    }
    expect(Object.keys(FDC_RELEASES)).toEqual(["foundation", "sr_legacy", "fndds"]);
  });
});
