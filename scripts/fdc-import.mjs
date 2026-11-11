// USDA FoodData Central importer (docs/DESIGN.md section 5): Foundation Foods, SR Legacy and
// FNDDS (survey foods) from their official CSV releases into foods, food_portions and the
// per-100 g nutrient maps. Branded Foods are not imported (packaged products come from Open Food
// Facts). Run through the server tool:
//
//   cal import-fdc                              all three pinned releases
//   cal import-fdc --only sr_legacy,fndds       some of them
//   cal import-fdc --zip fndds=/path/file.zip   a copy of the pinned file (checked by SHA-256)
//   cal import-fdc --dir fndds=/path/folder     an unpacked CSV folder (not checked; tests, trials)
//   cal import-fdc --prune                      also delete foods the release no longer has
//
// Downloads are cached in FDC_CACHE_DIR (or --cache; required), never in the repository, and must match
// the SHA-256 recorded below. Outbound requests go through EGRESS_PROXY_URL when it is set.
// Upserts are keyed by (source, FDC ID), so running it again updates rows in place. Values are
// per 100 g as FDC publishes them. Every FDC value is kept: the catalogue's nutrients under their
// codes (lib/contracts/nutrients.ts), all others as "fdc:<nutrient id>".
import crypto from "node:crypto";
import { createReadStream, createWriteStream, existsSync } from "node:fs";
import { mkdir, rename, rm, stat } from "node:fs/promises";
import path from "node:path";
import { Transform } from "node:stream";
import { pipeline } from "node:stream/promises";

import { fetch as undiciFetch, ProxyAgent } from "undici";

import { NUTRIENT_CATALOGUE } from "../lib/contracts/nutrients.ts";
import { recomputeDishes, tidy } from "../lib/food/dish-core.ts";
import { foodSearchText } from "../lib/food/normalize.ts";

import { csvRecords } from "./lib/csv.mjs";
import { queryRows, seedReference } from "./lib/reference.mjs";
import { findEntry, listZip, openZipEntry } from "./lib/zip.mjs";

const FDC_DOWNLOADS = "https://fdc.nal.usda.gov/fdc-datasets";

// Pinned releases, checked 31 Oct 2026 on the FDC download page. The October 2026 Foundation
// Foods file published then had no food, food_nutrient or food_portion tables, so the April 2026
// release is pinned. FNDDS 2021-2023 (October 2024) is the latest survey release.
export const FDC_RELEASES = {
  foundation: {
    key: "foundation",
    source: "fdc_foundation",
    dataType: "foundation_food",
    title: "Foundation Foods",
    release: "2026-04-30",
    file: "FoodData_Central_foundation_food_csv_2026-04-30.zip",
    sha256: "70457ee9d9342f43bda2010318c85f04210c689fdeb9cd2da4c513b0e8dbc655",
    bytes: 3_825_741,
    categories: "food_category",
  },
  sr_legacy: {
    key: "sr_legacy",
    source: "fdc_sr_legacy",
    dataType: "sr_legacy_food",
    title: "SR Legacy",
    release: "2018-04",
    file: "FoodData_Central_sr_legacy_food_csv_2018-04.zip",
    sha256: "b80817294b8850530aaedf2e515c02593b1824f763a0ff356e5c2081643e6fd0",
    bytes: 6_074_592,
    categories: "food_category",
  },
  fndds: {
    key: "fndds",
    source: "fdc_fndds",
    dataType: "survey_fndds_food",
    title: "FNDDS 2021-2023 (survey foods)",
    release: "2024-10-31",
    file: "FoodData_Central_survey_food_csv_2024-10-31.zip",
    sha256: "5ccc25ec2777a8982fbb61378a42f415316173eb11e48c9a8ba4cb19f5a4f29c",
    bytes: 3_325_692,
    categories: "wweia",
  },
};

export const releaseUrl = (release) => `${FDC_DOWNLOADS}/${release.file}`;

class ImportError extends Error {}

// ---- Arguments ----

const parseArgs = (argv) => {
  const options = { only: null, cache: null, zips: {}, dirs: {}, prune: false, download: true };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const value = () => {
      const next = argv[++i];
      if (next === undefined) throw new ImportError(`${arg} needs a value.`);
      return next;
    };
    const pair = (text) => {
      const at = text.indexOf("=");
      if (at < 1) throw new ImportError(`${arg} expects DATASET=PATH.`);
      const key = text.slice(0, at);
      if (!FDC_RELEASES[key]) throw new ImportError(`Unknown dataset "${key}".`);
      return [key, text.slice(at + 1)];
    };
    if (arg === "--only")
      options.only = value()
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
    else if (arg === "--cache") options.cache = value();
    else if (arg === "--zip") {
      const [key, file] = pair(value());
      options.zips[key] = file;
    } else if (arg === "--dir") {
      const [key, dir] = pair(value());
      options.dirs[key] = dir;
    } else if (arg === "--prune") options.prune = true;
    else if (arg === "--no-download") options.download = false;
    else
      throw new ImportError(
        `Unknown option ${arg}. Options: --only, --cache, --zip, --dir, --prune, --no-download`,
      );
  }
  for (const key of options.only ?? [])
    if (!FDC_RELEASES[key])
      throw new ImportError(`Unknown dataset "${key}" (foundation, sr_legacy, fndds).`);
  return options;
};

// ---- Files ----

const sha256File = async (file) => {
  const hash = crypto.createHash("sha256");
  await pipeline(createReadStream(file), hash);
  return hash.digest("hex");
};

const proxyAgent = () => {
  const url = (process.env.EGRESS_PROXY_URL || process.env.AI_PROXY_URL || "").trim();
  return url ? new ProxyAgent(url) : undefined;
};

/** Downloads a pinned release into the cache (or reuses it), checking its SHA-256. */
export const ensureReleaseFile = async (release, cacheDir, out, { download = true } = {}) => {
  await mkdir(cacheDir, { recursive: true });
  const file = path.join(cacheDir, release.file);
  if (existsSync(file)) {
    if ((await sha256File(file)) === release.sha256) return file;
    out(`${release.file}: cached copy does not match the recorded SHA-256; downloading again.`);
    await rm(file);
  }
  if (!download) throw new ImportError(`${release.file} is not in ${cacheDir}.`);
  const url = releaseUrl(release);
  out(`Downloading ${url}`);
  const dispatcher = proxyAgent();
  try {
    const response = await undiciFetch(url, {
      dispatcher,
      headers: { "user-agent": "Kal food log (FoodData Central importer)" },
      signal: AbortSignal.timeout(15 * 60_000),
    });
    if (!response.ok || !response.body)
      throw new ImportError(`Download failed: HTTP ${response.status} for ${url}`);
    const part = `${file}.part`;
    const hash = crypto.createHash("sha256");
    let bytes = 0;
    const limit = 600 * 1024 * 1024;
    const meter = new Transform({
      transform(chunk, _encoding, done) {
        bytes += chunk.length;
        if (bytes > limit) return done(new ImportError("Download is larger than expected."));
        hash.update(chunk);
        done(null, chunk);
      },
    });
    await pipeline(response.body, meter, createWriteStream(part));
    const digest = hash.digest("hex");
    if (digest !== release.sha256) {
      await rm(part, { force: true });
      throw new ImportError(
        `${release.file}: SHA-256 ${digest} does not match the recorded ${release.sha256}. The file on the server changed; check the release before updating the pin.`,
      );
    }
    await rename(part, file);
    return file;
  } finally {
    await dispatcher?.close();
  }
};

/** The tables of a release: from a ZIP file or an unpacked folder. */
export const openRelease = async (location) => {
  if ((await stat(location)).isDirectory()) {
    return {
      has: (name) => existsSync(path.join(location, name)),
      records: (name) => csvRecords(createReadStream(path.join(location, name))),
    };
  }
  const entries = await listZip(location);
  return {
    has: (name) => Boolean(findEntry(entries, name)),
    records: async function* (name) {
      const entry = findEntry(entries, name);
      if (!entry) throw new ImportError(`${name} is missing from ${path.basename(location)}.`);
      yield* csvRecords(await openZipEntry(location, entry));
    },
  };
};

// ---- Nutrients ----

const UNIT_OF = { kcal: "KCAL", g: "G", mg: "MG", µg: "UG" };

/**
 * One food's values (FDC nutrient id -> amount per 100 g) as a NutrientMap. The first catalogue
 * id present fills each code; every other value is kept as "fdc:<id>". Ids whose unit differs
 * from the catalogue's are kept only as "fdc:<id>". Energy missing: from kJ, else from macros.
 */
/**
 * @param {Map<number, number>} values
 * @param {Map<number, string>} [units]
 * @returns {{ map: Record<string, number>, derivedEnergy: boolean }}
 */
export const buildNutrientMap = (values, units = new Map()) => {
  /** @type {Record<string, number>} */
  const map = {};
  const used = new Set();
  for (const info of NUTRIENT_CATALOGUE) {
    for (const id of info.fdcIds) {
      if (!values.has(id)) continue;
      const unit = units.get(id);
      if (unit && unit.toUpperCase() !== UNIT_OF[info.unit]) continue;
      map[info.code] = tidy(values.get(id));
      used.add(id);
      break;
    }
  }
  for (const [id, amount] of values) if (!used.has(id)) map[`fdc:${id}`] = tidy(amount);
  let derivedEnergy = false;
  if (map.energy === undefined) {
    if (values.has(1062)) map.energy = tidy(values.get(1062) / 4.184);
    else if (map.protein !== undefined || map.fat !== undefined || map.carbs !== undefined)
      map.energy = tidy(
        4 * (map.protein ?? 0) + 4 * (map.carbs ?? 0) + 9 * (map.fat ?? 0) + 7 * (map.alcohol ?? 0),
      );
    derivedEnergy = map.energy !== undefined;
  }
  return { map, derivedEnergy };
};

// ---- Portions ----

const formatAmount = (n) => (Number.isInteger(n) ? String(n) : String(Math.round(n * 1000) / 1000));

// A leading amount: "1 1/2", "1/2", "0.5" or "2" (mixed numbers first).
const LEADING_AMOUNT = /^(\d+\s+\d+\s*\/\s*\d+|\d+(?:\.\d+)?(?:\s*\/\s*\d+)?)\s+(.+)$/;

const parseAmount = (text) => {
  const parts = text.trim().split(/\s+/);
  let total = 0;
  for (const part of parts) {
    const [a, b] = part.split("/").map(Number);
    if (!Number.isFinite(a)) return NaN;
    total += b ? a / b : a;
  }
  return total;
};

/**
 * A household portion from an FDC food_portion row: { label, amount, unit, grams } or null.
 * SR Legacy keeps the unit in modifier ("cup, chopped"), Foundation in measure_unit, FNDDS in
 * portion_description ("1 cup"; its modifier is a code).
 */
export const portionFromRow = (row, units, datasetKey) => {
  const grams = Number(row.gram_weight);
  if (!Number.isFinite(grams) || grams <= 0) return null;
  const description = (row.portion_description ?? "").trim();
  const modifier = datasetKey === "fndds" ? "" : (row.modifier ?? "").trim();
  const unitName = units.get(row.measure_unit_id) ?? "";
  const measure = unitName && unitName !== "undetermined" ? unitName : "";
  let amount = Number(row.amount);
  let label;
  let unit;
  if (description && description !== "Quantity not specified") {
    const match = LEADING_AMOUNT.exec(description);
    label = description;
    if (match) {
      const parsed = parseAmount(match[1]);
      if (!Number.isFinite(amount) || amount <= 0) amount = parsed;
      unit = match[2].split(/[,(]/)[0].trim() || match[2];
    } else unit = description;
  } else if (description === "Quantity not specified") {
    label = "Typical portion";
    unit = "portion";
    amount = 1;
  } else {
    const count = Number.isFinite(amount) && amount > 0 ? amount : 1;
    amount = count;
    const words = [measure, modifier].filter(Boolean);
    label = `${formatAmount(count)} ${words.join(measure && modifier ? ", " : "")}`.trim();
    unit = measure || modifier.split(/[,(]/)[0].trim() || "portion";
    if (!words.length) label = `${formatAmount(count)} portion`;
  }
  if (!Number.isFinite(amount) || amount <= 0) amount = 1;
  return { label: label.slice(0, 120), amount, unit: unit.slice(0, 60), grams };
};

// ---- Import of one release ----

const SYNONYM_SKIP = /^(ns|nfs)\b/i;
const PROGRAM_NOTE = /\s*\(includes foods for usda's food distribution program\)/i;

/** Reads one release and writes it. Returns counts. */
export const importRelease = async (pool, release, location, out, { prune = false } = {}) => {
  const started = Date.now();
  const tables = await openRelease(location);

  // Nutrient ids, units and legacy numbers (FNDDS food_nutrient uses nutrient numbers).
  const units = new Map();
  const byNumber = new Map();
  for await (const row of tables.records("nutrient.csv")) {
    const id = Number(row.id);
    units.set(id, row.unit_name);
    if (row.nutrient_nbr) byNumber.set(String(Number(row.nutrient_nbr)), id);
  }

  // Categories.
  const categories = new Map();
  if (release.categories === "wweia" && tables.has("wweia_food_category.csv")) {
    for await (const row of tables.records("wweia_food_category.csv"))
      categories.set(row.wweia_food_category, row.wweia_food_category_description);
  } else if (tables.has("food_category.csv")) {
    for await (const row of tables.records("food_category.csv"))
      categories.set(row.id, row.description);
  }

  // Foods of this data type only (the Foundation file also holds its samples).
  const foods = new Map();
  for await (const row of tables.records("food.csv")) {
    if (row.data_type !== release.dataType) continue;
    // The FDC ID stays in source_note, so this administrative remark can leave the name.
    const description = row.description.replace(PROGRAM_NOTE, "").trim();
    if (!description) continue;
    foods.set(row.fdc_id, {
      description,
      category: categories.get(row.food_category_id) ?? null,
      values: new Map(),
      portions: [],
      synonyms: [],
    });
  }

  // Additional descriptions of survey foods ("basmati or jasmine rice") become synonyms.
  if (release.key === "fndds" && tables.has("food_attribute.csv")) {
    for await (const row of tables.records("food_attribute.csv")) {
      if (row.food_attribute_type_id !== "1001") continue;
      const food = foods.get(row.fdc_id);
      const value = (row.value ?? "").trim().slice(0, 80);
      if (!food || !value || SYNONYM_SKIP.test(value)) continue;
      if (
        food.synonyms.length < 12 &&
        !food.synonyms.some((s) => s.toLowerCase() === value.toLowerCase())
      )
        food.synonyms.push(value);
    }
  }

  // Nutrient values, streamed.
  let nutrientRows = 0;
  for await (const row of tables.records("food_nutrient.csv")) {
    const food = foods.get(row.fdc_id);
    if (!food || row.amount === "") continue;
    const amount = Number(row.amount);
    if (!Number.isFinite(amount)) continue;
    let id = Number(row.nutrient_id);
    if (!units.has(id) && byNumber.has(String(id))) id = byNumber.get(String(id));
    food.values.set(id, amount);
    nutrientRows++;
  }

  // Household portions.
  const measureUnits = new Map();
  if (tables.has("measure_unit.csv"))
    for await (const row of tables.records("measure_unit.csv")) measureUnits.set(row.id, row.name);
  let portionCount = 0;
  if (tables.has("food_portion.csv")) {
    for await (const row of tables.records("food_portion.csv")) {
      const food = foods.get(row.fdc_id);
      if (!food || food.portions.length >= 16) continue;
      const portion = portionFromRow(row, measureUnits, release.key);
      if (!portion) continue;
      if (food.portions.some((p) => p.label === portion.label && p.grams === portion.grams))
        continue;
      food.portions.push({
        ...portion,
        position: Number(row.seq_num) || food.portions.length + 1,
        source_id: row.id,
      });
    }
  }

  // Rows for the database.
  const releaseLabel = `${release.title} ${release.release}`;
  const rows = [];
  let derived = 0;
  for (const [fdcId, food] of foods) {
    const { map, derivedEnergy } = buildNutrientMap(food.values, units);
    if (derivedEnergy) derived++;
    const note = `USDA FoodData Central, ${release.title} (${release.release}), FDC ID ${fdcId}. Public domain.${derivedEnergy ? " Energy calculated from protein, fat and carbohydrate." : ""}`;
    rows.push({
      source_id: fdcId,
      name_en: food.description,
      category: food.category,
      synonyms: food.synonyms,
      nutrients: map,
      search_text: foodSearchText({ nameEn: food.description, synonyms: food.synonyms }),
      source_note: note,
      portions: food.portions
        .sort((a, b) => a.position - b.position)
        .map((p, index) => ({ ...p, position: index })),
    });
  }

  const client = await pool.connect();
  let inserted = 0;
  let updated = 0;
  let pruned = 0;
  let stale = 0;
  try {
    await client.query("begin");
    for (let i = 0; i < rows.length; i += 500) {
      const batch = rows.slice(i, i + 500);
      const { rows: written } = await client.query(
        `insert into foods (source, source_id, kind, name_en, synonyms, category, nutrients,
                            search_text, source_note, data_release)
         select $2, r.source_id, 'food', r.name_en,
                array(select jsonb_array_elements_text(r.synonyms)), r.category, r.nutrients,
                r.search_text, r.source_note, $3
           from jsonb_to_recordset($1::jsonb)
             as r(source_id text, name_en text, category text, synonyms jsonb, nutrients jsonb,
                  search_text text, source_note text)
         on conflict (source, source_id) where source_id is not null and owner_id is null
         do update set name_en = excluded.name_en, synonyms = excluded.synonyms,
                       category = excluded.category, nutrients = excluded.nutrients,
                       search_text = excluded.search_text, source_note = excluded.source_note,
                       data_release = excluded.data_release, updated_at = now()
         returning id, source_id, (xmax = 0) as inserted`,
        [
          JSON.stringify(batch.map(({ portions: _p, ...row }) => row)),
          release.source,
          releaseLabel,
        ],
      );
      const idBySource = new Map(written.map((w) => [w.source_id, w.id]));
      for (const w of written) {
        if (w.inserted) inserted++;
        else updated++;
      }
      const ids = written.map((w) => w.id);
      await client.query("delete from food_portions where food_id = any($1::uuid[])", [ids]);
      const portions = batch.flatMap((row) =>
        row.portions.map((p) => ({ ...p, food_id: idBySource.get(row.source_id) })),
      );
      portionCount += portions.length;
      if (portions.length)
        await client.query(
          `insert into food_portions (food_id, label, amount, unit, grams, position, source_id)
           select food_id, label, amount, unit, grams, position, source_id
             from jsonb_to_recordset($1::jsonb)
               as r(food_id uuid, label text, amount real, unit text, grams real, position int, source_id text)`,
          [JSON.stringify(portions)],
        );
    }
    // Foods of this source that the release no longer has.
    const keep = rows.map((r) => r.source_id);
    if (prune) {
      const result = await client.query(
        `delete from foods f where f.source = $1 and f.owner_id is null
            and not (f.source_id = any($2::text[]))
            and not exists (select 1 from dish_components dc where dc.component_id = f.id)`,
        [release.source, keep],
      );
      pruned = result.rowCount ?? 0;
    }
    const { rows: left } = await client.query(
      `select count(*)::int as n from foods where source = $1 and owner_id is null
          and not (source_id = any($2::text[]))`,
      [release.source, keep],
    );
    stale = left[0].n;
    await client.query("commit");
  } catch (error) {
    await client.query("rollback").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }

  const seconds = (Date.now() - started) / 1000;
  const counts = {
    dataset: release.key,
    foods: rows.length,
    inserted,
    updated,
    portions: portionCount,
    nutrientValues: nutrientRows,
    derivedEnergy: derived,
    pruned,
    stale,
    seconds,
  };
  out(
    `${release.title} ${release.release}: ${rows.length} foods (${inserted} new, ${updated} updated), ${portionCount} portions, ${nutrientRows} nutrient values${derived ? `, ${derived} with energy from macros` : ""}${pruned ? `, ${pruned} old foods removed` : ""}${stale ? `, ${stale} foods no longer in the release (kept; --prune removes unused ones)` : ""}. ${seconds.toFixed(1)} s`,
  );
  return counts;
};

/** cal import-fdc: the hook scripts/cal.mjs calls. */
export const run = async (pool, argv = [], out = console.log) => {
  const options = parseArgs(argv);
  const started = Date.now();
  const keys = options.only ?? Object.keys(FDC_RELEASES);
  const cacheDir = options.cache || process.env.FDC_CACHE_DIR || null;
  // Downloads need a place chosen on purpose (they are large and must stay out of the code).
  const needsCache = keys.some((key) => !options.dirs[key] && !options.zips[key]);
  if (needsCache && !cacheDir)
    throw new ImportError("Set FDC_CACHE_DIR (or pass --cache DIR) for the downloaded files.");
  const reference = await seedReference(pool);
  out(`Nutrient catalogue: ${reference.nutrients} nutrients; DRI table: ${reference.dri} rows.`);
  const results = [];
  for (const key of keys) {
    const release = FDC_RELEASES[key];
    let location = options.dirs[key];
    if (!location) {
      const zip = options.zips[key];
      if (zip) {
        if ((await sha256File(zip)) !== release.sha256)
          throw new ImportError(`${zip} is not the pinned ${release.file} (SHA-256 differs).`);
        location = zip;
      } else location = await ensureReleaseFile(release, cacheDir, out, options);
    }
    results.push(await importRelease(pool, release, location, out, options));
  }
  const dishes = await recomputeDishes(queryRows(pool), null);
  if (dishes) out(`Recomputed ${dishes} dishes from their components.`);
  const seconds = (Date.now() - started) / 1000;
  out(`Done in ${seconds.toFixed(1)} s.`);
  return { results, dishes, seconds };
};
