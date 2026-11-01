// Food search (CONTRACT: lib/contracts/food-search.ts): pg_trgm + full text over the English and
// Persian names and synonyms in foods.search_text, typo tolerant, with the person's own foods and
// their recent and frequent foods (food_memory, logged items) first.
//
// Candidates: every query word as a word prefix (full text, simple dictionary); words no food has
// as a prefix ("chiken", "قرمه") may match by trigram word similarity of 0.45 or more instead.
// One or two words must all match, longer queries 60 % of their words. At most 300 shared foods
// (by matched words, then shorter names) are scored, plus all of the person's own and remembered
// foods. Shared FDC foods without an energy value (some Foundation entries hold minerals only)
// are left out.
//
// Ranking, one SQL statement (higher is better):
//   match      each word: 1 as a prefix, else its trigram word similarity (0.45 or more); averaged
//   + 0.25 x   share of the words found in the name itself rather than only in synonyms
//   + head     the name's first part (before the first comma, FDC style "Rice, white, cooked")
//              is the whole query (0.3) or the first word (0.2, plurals too); the second part is
//              ("Fish, salmon") 0.15; the first part starts with it 0.1; Persian first word 0.2
//   + 0.5      the name without its note in brackets, or a dish's synonym, is the query
//   - brevity  0.03 per name word beyond the query's, at most 0.3: generic foods have short names.
//              The not-specified markers ("NFS", "NS as to fat", "no added fat") are not counted:
//              they make a name longer but not more specific ("Rice, white, cooked, no added
//              fat" is plain cooked rice, "Rice, white, cooked, glutinous" is a special kind)
//   + generic  "NFS" (not further specified) 0.08, "NS as to" 0.04; plain forms (raw, cooked,
//              plain, whole, white, regular, brewed, no added fat) 0.04 each, at most 0.08
//   - 0.15     recipe-ingredient entries, baby food, imitation and regional traditional foods,
//              unless the query asks for them
//   + source   dish 0.08, FNDDS 0.06, Foundation 0.05, Mealie 0.04, SR Legacy 0, Open Food Facts -0.02
//   + 3.0      the person's own food (more than any memory boost, so own foods lead)
//   + memory   a food the person corrected to or logged: 1.0 + up to 0.4 by count, + 0.1 if used
//              in the last 30 days; 0.8 more when remembered under a name like the query
import { and, asc, eq, inArray, isNull, or, sql, type SQL } from "drizzle-orm";

import { db as defaultDb, type DbOrTx } from "@/db";
import { foodPortions, foods } from "@/db/schema";
import type { FoodResult, FoodSearchQuery } from "@/lib/contracts/food-search";

import { normalizeFoodText } from "./normalize";

type FoodRow = typeof foods.$inferSelect;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isFoodId = (value: unknown): value is string =>
  typeof value === "string" && UUID.test(value);

const visibleTo = (userId: string) => or(isNull(foods.ownerId), eq(foods.ownerId, userId));

// ---- Query words ----

const STOPWORDS = new Set([
  "a",
  "an",
  "and",
  "the",
  "of",
  "with",
  "in",
  "on",
  "or",
  "for",
  "to",
  "some",
  "و",
  "با",
  "یک",
]);

/** Plural to a prefix that also finds the singular: eggs -> egg, berries -> berr, tomatoes -> tomato. */
export const stemWord = (word: string) => {
  if (!/^[a-z]+$/.test(word) || word.length <= 3) return word;
  if (word.endsWith("ies")) return word.slice(0, -3);
  if (/(oes|ches|shes|xes|sses)$/.test(word)) return word.slice(0, -2);
  if (word.endsWith("s") && !word.endsWith("ss") && !word.endsWith("us")) return word.slice(0, -1);
  return word;
};

export type QueryWords = {
  /** The normalised query. */
  text: string;
  words: { word: string; stem: string }[];
};

/** The words a search looks for: normalised, stop words dropped (unless that leaves none), at most 6. */
export const queryWords = (query: string): QueryWords => {
  const text = normalizeFoodText(query).slice(0, 100);
  const all = text
    .split(" ")
    .map((w) => w.replace(/%/g, ""))
    .filter(Boolean);
  const kept = all.filter((w) => !STOPWORDS.has(w));
  const unique = [...new Set(kept.length ? kept : all)].slice(0, 6);
  return { text, words: unique.map((word) => ({ word, stem: stemWord(word) })) };
};

// ---- Rows to results ----

const withPortions = async (
  rows: (FoodRow & { score?: number })[],
  userId: string,
  dbx: DbOrTx,
): Promise<FoodResult[]> => {
  if (!rows.length) return [];
  const portions = await dbx
    .select()
    .from(foodPortions)
    .where(
      inArray(
        foodPortions.foodId,
        rows.map((r) => r.id),
      ),
    )
    .orderBy(asc(foodPortions.position), asc(foodPortions.id));
  return rows.map((row) => ({
    id: row.id,
    source: row.source,
    kind: row.kind,
    nameEn: row.nameEn,
    nameFa: row.nameFa,
    brand: row.brand,
    category: row.category,
    barcode: row.barcode,
    per100g: row.nutrients,
    densityGPerMl: row.densityGPerMl,
    servingGrams: row.servingGrams,
    portions: portions
      .filter((p) => p.foodId === row.id)
      .map((p) => ({
        id: p.id,
        label: p.label,
        labelFa: p.labelFa,
        amount: p.amount,
        unit: p.unit,
        grams: p.grams,
      })),
    sourceNote: row.sourceNote,
    personal: row.ownerId === userId,
    score: row.score ?? 0,
  }));
};

/** Full results for food rows, in the order given. */
export const toFoodResults = (rows: FoodRow[], userId: string, dbx: DbOrTx = defaultDb) =>
  withPortions(rows, userId, dbx);

// ---- Search ----

/** Names that rarely mean what a person ate: demoted unless the query asks for them. */
const SPECIALISED =
  "\\m(as ingredient|baby food|babyfood|infant formula|toddler|alaska native|navajo|apache|hopi|northern plains indians|shoshone|industrial|usda commodity|school lunch|meatless|imitation)\\M";
const SPECIALISED_QUERY =
  /\b(ingredient|baby|babyfood|infant|toddler|alaska|navajo|apache|hopi|plains|shoshone|industrial|commodity|school|meatless|vegetarian|vegan|imitation)\b/;

/**
 * FoodData Central's not-specified markers, as a Postgres regular expression: "NFS" (not further
 * specified), "NS as to ..." up to the next comma, and "no added fat".
 */
const GENERIC_MARKERS = "\\m(nfs|ns as to [^,]*|no added fat)\\M";

/** Shared foods scored per search (the best by a cheap order); own and remembered foods always. */
const SHARED_CANDIDATES = 300;

const avg = (parts: SQL[]) => sql`((${sql.join(parts, sql` + `)})::float8 / ${parts.length})`;

const prefix = (stem: string) => sql`f.search_vector @@ to_tsquery('simple', ${`${stem}:*`})`;

/**
 * Words that some food has as a word prefix: typo matching (trigrams, slow on broad words such
 * as "cooked") is used only for the others ("chiken", "قرمه").
 */
const knownWords = async (words: QueryWords, dbx: DbOrTx) => {
  const counts = words.words.map(
    ({ stem }, i) =>
      sql`(select count(*) from (select 1 from foods f where ${prefix(stem)} limit 3) s)::int as ${sql.raw(`c${i}`)}`,
  );
  const result = await dbx.execute(sql`select ${sql.join(counts, sql`, `)}`);
  const row = (result.rows[0] ?? {}) as Record<string, unknown>;
  return words.words.map((_, i) => Number(row[`c${i}`]) >= 3);
};

/** The ranking statement (see the top of this file). */
const rankingStatement = (
  query: FoodSearchQuery,
  words: QueryWords,
  known: boolean[],
  limit: number,
) => {
  const { text } = words;
  const userId = query.userId;
  const list = words.words;
  const first = list[0]!;

  const fuzzy = (word: string) => sql`word_similarity(${word}, f.search_text)`;
  const tokenScore = list.map(({ word, stem }, i) =>
    known[i]
      ? sql`(case when ${prefix(stem)} then 1.0 else 0 end)`
      : sql`(case when ${prefix(stem)} then 1.0
                  when ${fuzzy(word)} >= 0.45 then ${fuzzy(word)} else 0 end)`,
  );
  const inName = list.map(
    ({ stem }) =>
      sql`(case when (nk.full || ' ' || nk.fa || ' ' || nk.fa_joined) ~ ${`\\m${stem}`} then 1 else 0 end)`,
  );
  const candidate = list.map(({ word, stem }, i) =>
    !known[i] && word.length >= 4
      ? sql`(${prefix(stem)} or ${word} <% f.search_text)`
      : prefix(stem),
  );
  // Recipe-ingredient entries, baby foods and regional traditional foods only when asked for.
  const specialised = SPECIALISED_QUERY.test(text);
  // All words must be there for one or two words (an AND the indexes can serve), at least 60 %
  // of them for longer queries.
  const matches =
    list.length <= 2
      ? sql.join(candidate, sql` and `)
      : sql`(${sql.join(candidate, sql` or `)}) and (${sql.join(
          candidate.map((c) => sql`(case when ${c} then 1 else 0 end)`),
          sql` + `,
        )}) >= ${Math.ceil(list.length * 0.6)}`;
  // Cheap order for capping the shared candidates before the full score: words found as
  // prefixes, then shorter names (generic foods have short names).
  const prefixCount = sql.join(
    list.map(({ stem }) => sql`(case when ${prefix(stem)} then 1 else 0 end)`),
    sql` + `,
  );
  const kinds = query.kinds?.length
    ? sql`and f.kind in (${sql.join(
        query.kinds.map((k) => sql`${k}`),
        sql`, `,
      )})`
    : sql``;

  return sql`
    with mem as (
      select food_id, sum(n)::float8 as n, max(last_at) as last_at
        from (
          select food_id, count as n, last_used_at as last_at
            from food_memory where user_id = ${userId} and food_id is not null
          union all
          select i.food_id, count(*) as n, max(i.created_at) as last_at
            from meal_items i join meals m on m.id = i.meal_id
           where i.user_id = ${userId} and i.food_id is not null and m.deleted_at is null
             and i.created_at > now() - interval '180 days'
           group by i.food_id
        ) s
       group by food_id
    ),
    named as (
      select distinct food_id from food_memory
       where user_id = ${userId} and food_id is not null
         and (name_key = ${text} or name_key % ${text})
    ),
    shared as (
      select f.id from foods f
       where f.owner_id is null and (f.source not like 'fdc%' or f.nutrients ? 'energy') ${kinds} and ${matches}
       order by (${prefixCount}) desc, length(f.name_en)
       limit ${SHARED_CANDIDATES}
    ),
    cand as (
      select id from shared
      union
      select f.id from foods f where f.owner_id = ${userId} ${kinds} and ${matches}
      union
      select f.id from foods f join mem on mem.food_id = f.id
       where (f.owner_id is null or f.owner_id = ${userId}) ${kinds} and ${matches}
      union
      select f.id from foods f join named on named.food_id = f.id
       where (f.owner_id is null or f.owner_id = ${userId}) ${kinds}
    )
    select f.id,
      ${avg(tokenScore)}
      + 0.25 * ${avg(inName)}
      + (case when nk.seg = ${text} then 0.3
              when nk.seg in (${first.word}, ${first.stem}, ${`${first.stem}s`}, ${`${first.stem}es`}, ${`${first.stem}ies`}) then 0.2
              when nk.seg2 in (${text}, ${first.word}, ${first.stem}) then 0.15
              when nk.seg like ${`${first.stem}%`} then 0.1
              when split_part(nk.fa, ' ', 1) = ${first.word} or nk.fa_joined = ${first.word} then 0.2 else 0 end)
      + (case when nk.en = ${text} or nk.fa = ${text} or nk.fa_joined = ${text} then 0.5
              when f.source not like 'fdc%' and exists (
                     select 1 from unnest(f.synonyms) s
                      where btrim(lower(regexp_replace(translate(s, 'يىكة', 'ییکه'), '[^[:alnum:]%]+', ' ', 'g'))) = ${text})
                   then 0.5 else 0 end)
      - least(0.3, 0.03 * greatest(0, coalesce(array_length(string_to_array(nk.brief, ' '), 1), 0) - ${list.length}))
      + (case when nk.en ~ '\\mnfs\\M' then 0.08 when nk.en like '% ns as to %' then 0.04 else 0 end)
      + least(0.08, 0.04 * ((nk.en ~ '\\mraw\\M')::int + (nk.en ~ '\\mplain\\M')::int
                            + (nk.en ~ '\\mwhole\\M')::int + (nk.en ~ '\\mwhite\\M')::int
                            + (nk.en ~ '\\mregular\\M')::int + (nk.en ~ '\\m(cooked|brewed)\\M')::int
                            + (nk.en ~ 'no added fat')::int))
      ${specialised ? sql`` : sql`- (case when nk.full ~ ${SPECIALISED} then 0.15 else 0 end)`}
      + (case f.source when 'dish' then 0.08 when 'fdc_fndds' then 0.06 when 'fdc_foundation' then 0.05
                       when 'mealie' then 0.04 when 'off' then -0.02 else 0 end)
      + (case when f.owner_id is not null then 3.0 else 0 end)
      + (case when mem.food_id is not null
              then 1.0 + least(0.4, 0.12 * ln(1 + mem.n))
                   + (case when mem.last_at > now() - interval '30 days' then 0.1 else 0 end)
              else 0 end)
      + (case when named.food_id is not null then 0.8 else 0 end)
      as score
      from cand
      join foods f on f.id = cand.id
      cross join lateral (
        -- en: the name without its parenthetical note ("Doogh (salted yogurt drink)" -> "doogh"),
        -- used for brevity and exact matches; full: the whole name, for words found in it.
        select btrim(lower(regexp_replace(regexp_replace(f.name_en, '\\s*\\([^)]*\\)', '', 'g'),
                                          '[^[:alnum:]%]+', ' ', 'g'))) as en,
               btrim(lower(regexp_replace(f.name_en, '[^[:alnum:]%]+', ' ', 'g'))) as full,
               -- brief: en without the not-specified markers, for brevity only.
               btrim(lower(regexp_replace(regexp_replace(regexp_replace(f.name_en, '\\s*\\([^)]*\\)', '', 'g'),
                                                         ${GENERIC_MARKERS}, ' ', 'gi'),
                                          '[^[:alnum:]%]+', ' ', 'g'))) as brief,
               btrim(lower(regexp_replace(translate(coalesce(f.name_fa, ''), 'يىكة', 'ییکه'),
                                          '[^[:alnum:]%]+', ' ', 'g'))) as fa,
               -- Persian written without the zero-width non-joiner: "تهدیگ" for "ته‌دیگ".
               btrim(lower(regexp_replace(translate(replace(coalesce(f.name_fa, ''), U&'\\200C', ''), 'يىكة', 'ییکه'),
                                          '[^[:alnum:]%]+', ' ', 'g'))) as fa_joined,
               btrim(lower(regexp_replace(split_part(f.name_en, ',', 1), '[^[:alnum:]%]+', ' ', 'g'))) as seg,
               btrim(lower(regexp_replace(split_part(f.name_en, ',', 2), '[^[:alnum:]%]+', ' ', 'g'))) as seg2
      ) nk
      left join mem on mem.food_id = f.id
      left join named on named.food_id = f.id
     order by score desc, length(f.name_en), f.name_en
     limit ${limit}`;
};

/** Ranked food ids for a query. */
const rankedIds = (
  query: FoodSearchQuery,
  words: QueryWords,
  limit: number,
  dbx: DbOrTx,
): Promise<{ id: string; score: number }[]> =>
  // Typo tolerance: "<%" finds words with a trigram word similarity of 0.45 and more ("chiken"
  // and "chicken" score 0.5); the default threshold (0.6) misses one-letter typos in short words.
  // set_config(..., true) lasts until the end of this transaction only.
  dbx.transaction(async (tx) => {
    await tx.execute(
      sql`select set_config('pg_trgm.word_similarity_threshold', '0.45', true),
                 set_config('pg_trgm.similarity_threshold', '0.45', true)`,
    );
    const known = await knownWords(words, tx);
    const result = await tx.execute(rankingStatement(query, words, known, limit));
    return (result.rows as { id: string; score: number | string }[]).map((r) => ({
      id: r.id,
      score: Math.round(Number(r.score) * 1000) / 1000,
    }));
  });

export const searchFoods = async (
  query: FoodSearchQuery,
  dbx: DbOrTx = defaultDb,
): Promise<FoodResult[]> => {
  const words = queryWords(query.query);
  if (!words.words.length) return [];
  const limit = Math.min(Math.max(1, Math.floor(query.limit ?? 20)), 50);
  const ranked = await rankedIds(query, words, limit, dbx);
  if (!ranked.length) return [];
  const rows = await dbx
    .select()
    .from(foods)
    .where(
      inArray(
        foods.id,
        ranked.map((r) => r.id),
      ),
    );
  const byId = new Map(rows.map((row) => [row.id, row]));
  const ordered = ranked.flatMap((r) => {
    const row = byId.get(r.id);
    return row ? [{ ...row, score: r.score }] : [];
  });
  return withPortions(ordered, query.userId, dbx);
};

export const getFood = async (
  foodId: string,
  userId: string,
  dbx: DbOrTx = defaultDb,
): Promise<FoodResult | null> => {
  if (!isFoodId(foodId)) return null;
  const rows = await dbx
    .select()
    .from(foods)
    .where(and(eq(foods.id, foodId), visibleTo(userId)))
    .limit(1);
  return (await withPortions(rows, userId, dbx))[0] ?? null;
};

export const getFoodsByIds = async (
  ids: string[],
  userId: string,
  dbx: DbOrTx = defaultDb,
): Promise<Map<string, FoodResult>> => {
  const valid = [...new Set(ids.filter(isFoodId))];
  if (!valid.length) return new Map();
  const rows = await dbx
    .select()
    .from(foods)
    .where(and(inArray(foods.id, valid), visibleTo(userId)));
  return new Map((await withPortions(rows, userId, dbx)).map((food) => [food.id, food]));
};
