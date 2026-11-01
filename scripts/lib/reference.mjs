// Reference rows every food command makes sure of: the nutrient catalogue (nutrients) from
// lib/contracts/nutrients.ts and the US DRI table (dri_targets) from lib/targets/dri.ts. Both
// are upserts, so running them again changes nothing.
import { NUTRIENT_CATALOGUE } from "../../lib/contracts/nutrients.ts";
import { DRI_SOURCE, driRows } from "../../lib/targets/dri.ts";

/** pg Pool or client -> the QueryRows shape used by lib/food/dish-core.ts. */
export const queryRows = (pool) => async (text, params) => (await pool.query(text, params)).rows;

export const seedNutrientCatalogue = async (pool) => {
  const rows = NUTRIENT_CATALOGUE.map((info) => ({
    code: info.code,
    name: info.name,
    unit: info.unit,
    group: info.group,
    display_order: info.order,
    fdc_ids: info.fdcIds,
  }));
  await pool.query(
    `insert into nutrients (code, name, unit, "group", display_order, fdc_ids, shown)
     select code, name, unit, "group", display_order,
            array(select jsonb_array_elements_text(fdc_ids)::int), true
       from jsonb_to_recordset($1::jsonb)
         as r(code text, name text, unit text, "group" text, display_order int, fdc_ids jsonb)
     on conflict (code) do update set
       name = excluded.name, unit = excluded.unit, "group" = excluded."group",
       display_order = excluded.display_order, fdc_ids = excluded.fdc_ids, shown = true`,
    [JSON.stringify(rows)],
  );
  return rows.length;
};

export const seedDriTable = async (pool) => {
  const rows = driRows().map((row) => ({
    sex: row.sex,
    age_min: row.ageMin,
    age_max: row.ageMax,
    nutrient_code: row.code,
    rda: row.rda,
    ai: row.ai,
    ul: row.ul,
    source:
      row.ulScope && row.ulScope !== "total"
        ? `${DRI_SOURCE} (upper limit: ${row.ulScope} only)`
        : DRI_SOURCE,
  }));
  await pool.query(
    `insert into dri_targets (sex, age_min, age_max, life_stage, nutrient_code, rda, ai, ul, source)
     select sex, age_min, age_max, '', nutrient_code, rda, ai, ul, source
       from jsonb_to_recordset($1::jsonb)
         as r(sex text, age_min int, age_max int, nutrient_code text, rda real, ai real, ul real, source text)
     on conflict (sex, age_min, age_max, life_stage, nutrient_code) do update set
       rda = excluded.rda, ai = excluded.ai, ul = excluded.ul, source = excluded.source`,
    [JSON.stringify(rows)],
  );
  return rows.length;
};

/** Both reference tables. */
export const seedReference = async (pool) => ({
  nutrients: await seedNutrientCatalogue(pool),
  dri: await seedDriTable(pool),
});
