// Writes the small FoodData Central extracts in this folder from the pinned releases (public
// domain). Run after "cal import-fdc" has cached the files:
//
//   FDC_CACHE_DIR=<cache> node tests/fixtures/fdc/extract.mjs
//
// Each extract keeps the foods listed below (and, for Foundation, one sample row that the
// importer must skip), the catalogue's nutrient values plus three others, and the columns the
// importer reads.
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { NUTRIENT_CATALOGUE } from "../../../lib/contracts/nutrients.ts";
import { FDC_RELEASES } from "../../../scripts/fdc-import.mjs";
import { csvRecords } from "../../../scripts/lib/csv.mjs";
import { findEntry, listZip, openZipEntry } from "../../../scripts/lib/zip.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const cache = process.env.FDC_CACHE_DIR;
if (!cache) throw new Error("Set FDC_CACHE_DIR to the folder with the downloaded releases.");

const dishes = JSON.parse(
  await readFile(path.join(here, "../../../scripts/data/persian-dishes.json"), "utf8"),
);
const dishComponents = dishes.dishes.flatMap((d) => d.components.map((c) => String(c.fdc)));

const PICK = {
  foundation: ["2646170", "1104962", "1750354", "2758997", "335442"],
  sr_legacy: [
    ...new Set([
      ...dishComponents,
      "169704", // Rice, brown, long-grain, cooked
      "170969", // Babyfood, cereal, rice, dry fortified
      "169904", // Eggs, scrambled, frozen mixture
      "167627", // Mush, blue corn with ash (Navajo)
      "170050", // Tomatoes, red, ripe, cooked
      "171077", // Chicken breast, raw
    ]),
  ],
  fndds: [
    "2705956", // Chicken breast, baked, broiled, or roasted, skin not eaten, from raw
    "2707468", // Chicken, meatless, NFS
    "2707179", // Egg, creamed
    "2707152", // Egg, whole, raw
    "2705385", // Milk, whole
    "2710789", // Rice, brown, cooked, as ingredient
    "2708414", // Rice, brown, cooked, no added fat
    "2708402", // Rice, cooked, NFS
    "2708952", // Rice, fried, NFS
    "2708422", // Rice, white, cooked, glutinous
    "2708408", // Rice, white, cooked, no added fat
    "2709719", // Tomatoes, raw
    "2705414", // Yogurt, NFS
  ],
};

const KEEP_NUTRIENTS = new Set([
  ...NUTRIENT_CATALOGUE.flatMap((info) => info.fdcIds.map(String)),
  "1062", // energy in kJ
  "1007", // ash
  "1104", // vitamin A, IU
]);

const COLUMNS = {
  "food.csv": ["fdc_id", "data_type", "description", "food_category_id"],
  "foundation_food.csv": ["fdc_id", "NDB_number"],
  "sr_legacy_food.csv": ["fdc_id", "NDB_number"],
  "survey_fndds_food.csv": ["fdc_id", "food_code", "wweia_category_number"],
  "food_category.csv": ["id", "code", "description"],
  "wweia_food_category.csv": ["wweia_food_category", "wweia_food_category_description"],
  "nutrient.csv": ["id", "name", "unit_name", "nutrient_nbr"],
  "food_nutrient.csv": ["id", "fdc_id", "nutrient_id", "amount"],
  "food_portion.csv": [
    "id",
    "fdc_id",
    "seq_num",
    "amount",
    "measure_unit_id",
    "portion_description",
    "modifier",
    "gram_weight",
  ],
  "measure_unit.csv": ["id", "name"],
  "food_attribute.csv": ["id", "fdc_id", "food_attribute_type_id", "name", "value"],
};

const quote = (value) => `"${String(value ?? "").replace(/"/g, '""')}"`;

const read = async (zip, entries, name, keep) => {
  const entry = findEntry(entries, name);
  if (!entry) return null;
  const rows = [];
  for await (const row of csvRecords(await openZipEntry(zip, entry))) if (keep(row)) rows.push(row);
  return rows;
};

for (const [key, ids] of Object.entries(PICK)) {
  const release = FDC_RELEASES[key];
  const zip = path.join(cache, release.file);
  const entries = await listZip(zip);
  const pick = new Set(ids);
  const out = path.join(here, key);
  await mkdir(out, { recursive: true });

  const nutrients = await read(zip, entries, "nutrient.csv", () => true);
  const nbrToId = new Map(nutrients.map((n) => [String(Number(n.nutrient_nbr)), n.id]));
  const keptNutrients = nutrients.filter((n) => KEEP_NUTRIENTS.has(n.id));

  let sampleTaken = false;
  const foods = await read(zip, entries, "food.csv", (row) => {
    if (pick.has(row.fdc_id)) return true;
    if (key === "foundation" && row.data_type === "sample_food" && !sampleTaken) {
      sampleTaken = true;
      return true;
    }
    return false;
  });
  const foodIds = new Set(foods.map((f) => f.fdc_id));
  const ofFood = (row) => foodIds.has(row.fdc_id);
  const tables = {
    "food.csv": foods,
    "nutrient.csv": keptNutrients,
    "food_nutrient.csv": await read(zip, entries, "food_nutrient.csv", (row) => {
      if (!ofFood(row)) return false;
      const id = nutrients.some((n) => n.id === row.nutrient_id)
        ? row.nutrient_id
        : nbrToId.get(row.nutrient_id);
      return KEEP_NUTRIENTS.has(id);
    }),
    "food_portion.csv": await read(zip, entries, "food_portion.csv", ofFood),
    "measure_unit.csv": await read(zip, entries, "measure_unit.csv", () => true),
  };
  if (key === "fndds") {
    tables["survey_fndds_food.csv"] = await read(zip, entries, "survey_fndds_food.csv", ofFood);
    const categories = new Set(foods.map((f) => f.food_category_id));
    tables["wweia_food_category.csv"] = await read(zip, entries, "wweia_food_category.csv", (r) =>
      categories.has(r.wweia_food_category),
    );
    tables["food_attribute.csv"] = await read(
      zip,
      entries,
      "food_attribute.csv",
      (r) => ofFood(r) && r.food_attribute_type_id === "1001",
    );
  } else {
    tables["food_category.csv"] = await read(zip, entries, "food_category.csv", () => true);
    const extra = key === "foundation" ? "foundation_food.csv" : "sr_legacy_food.csv";
    tables[extra] = await read(zip, entries, extra, ofFood);
  }
  for (const [name, rows] of Object.entries(tables)) {
    const columns = COLUMNS[name];
    const text = [
      columns.map(quote).join(","),
      ...rows.map((r) => columns.map((c) => quote(r[c])).join(",")),
    ].join("\n");
    await writeFile(path.join(out, name), `${text}\n`);
  }
  console.log(
    `${key}: ${foods.length} foods, ${tables["food_nutrient.csv"].length} nutrient values`,
  );
}
