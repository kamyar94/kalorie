// The accuracy check behind scripts/eval.mjs (docs/DESIGN.md section 13): runs a folder of weighed
// meals through one provider and model with the same photo sizes, prompt, schema and parsing as the
// worker, and reports calorie and macro error, bias and latency.
//
// Folder format (one sub-folder per weighed meal, any names):
//   meals/
//     2026-10-30-lunch/
//       1.jpg  2.jpg       one to three photos (.jpg, .jpeg, .png or .webp), sent in name order
//       truth.json         what the scale said, for example:
//         { "kcal": 642, "protein": 38, "carbs": 70, "fat": 21, "grams": 515,
//           "note": "fried in olive oil", "time": "13:10", "cuisines": ["Persian home cooking"] }
//       Only kcal is required. note and time are given to the model like a note typed at capture
//       (time defaults to 12:30); protein, carbs, fat and grams are compared when present.
//
// Two numbers per meal: "model" is the sum of the model's own estimates; "database" (with --db
// and DATABASE_URL pointing at a Cal database with food data) matches the items to the food tables
// by trigram score and counts them as the worker would. The key is read from an environment
// variable and never printed.
import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { createAdapter } from "@/lib/ai/adapters";
import { DEFAULT_MODELS, isValidModelName } from "@/lib/ai/config";
import { describeAiError, isAiError } from "@/lib/ai/errors";
import {
  AI_PROVIDERS,
  isAiProvider,
  isReasoningEffort,
  type AiProvider,
  type AiUsage,
  type ReasoningEffort,
} from "@/lib/ai/types";
import type { AnalysisOutput } from "@/lib/contracts/analysis";
import { estimateToNutrients, sumNutrients, type NutrientMap } from "@/lib/contracts/nutrients";
import type { MealSlot } from "@/lib/contracts/meals";
import { slotForMinutes } from "@/lib/meals/time";
import { processPhoto } from "@/lib/photos/intake";

import { parseAnalysis } from "./parse";
import { analysisTokenLimit, resolveItems } from "./pipeline";
import { ANALYSIS_SYSTEM, buildAnalysisPrompt } from "./prompt";
import { ANALYSIS_SCHEMA } from "./schema";

export const METRICS = ["kcal", "protein", "carbs", "fat", "grams"] as const;
export type Metric = (typeof METRICS)[number];

export type EvalTruth = Partial<Record<Metric, number>> & {
  kcal: number;
  note?: string;
  time?: string;
  cuisines?: string[];
};

export type EvalMeal = { name: string; photos: Buffer[]; truth: EvalTruth };

export type EvalMealResult = {
  name: string;
  truth: EvalTruth;
  /** The model's own estimates, summed. */
  model: Partial<Record<Metric, number>> | null;
  /** Counted from the food tables (--db). */
  database: Partial<Record<Metric, number>> | null;
  latencyMs: number;
  usage: AiUsage | null;
  items: number;
  error: string | null;
};

export type MetricSummary = {
  n: number;
  /** Mean absolute error, in the metric's unit. */
  mae: number;
  /** Mean absolute error relative to the true value, percent. */
  mape: number;
  /** Mean signed error (positive: overestimates), in the unit and in percent. */
  bias: number;
  biasPercent: number;
};

export type EvalSummary = {
  meals: number;
  failed: number;
  model: Partial<Record<Metric, MetricSummary>>;
  database: Partial<Record<Metric, MetricSummary>>;
  latency: { mean: number; p50: number; p90: number; max: number };
  tokens: AiUsage;
};

const PHOTO = /\.(jpe?g|png|webp)$/i;

const isNumber = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);

/** Reads the meal folders; folders without photos or a valid truth.json are reported and skipped. */
export const loadEvalFolder = async (
  dir: string,
  log: (line: string) => void = () => undefined,
) => {
  const meals: EvalMeal[] = [];
  const entries = (await readdir(dir, { withFileTypes: true }))
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .sort();
  for (const name of entries) {
    const folder = path.join(dir, name);
    const files = (await readdir(folder))
      .filter((f) => PHOTO.test(f))
      .sort()
      .slice(0, 3);
    let truth: EvalTruth | null = null;
    try {
      const raw = JSON.parse(await readFile(path.join(folder, "truth.json"), "utf8")) as unknown;
      if (raw && typeof raw === "object" && isNumber((raw as EvalTruth).kcal))
        truth = raw as EvalTruth;
    } catch {
      truth = null;
    }
    if (!files.length || !truth) {
      log(`skipped ${name}: needs one to three photos and a truth.json with kcal`);
      continue;
    }
    meals.push({
      name,
      truth,
      photos: await Promise.all(files.map((f) => readFile(path.join(folder, f)))),
    });
  }
  return meals;
};

const metricsOf = (map: NutrientMap, grams: number): Partial<Record<Metric, number>> => ({
  kcal: map.energy ?? 0,
  protein: map.protein ?? 0,
  carbs: map.carbs ?? 0,
  fat: map.fat ?? 0,
  grams,
});

const slotOf = (time: string): MealSlot => {
  const m = /^(\d{1,2}):(\d{2})$/.exec(time);
  return slotForMinutes(m ? Number(m[1]) * 60 + Number(m[2]) : 750);
};

export type EvalOptions = {
  provider: AiProvider;
  model: string;
  apiKey: string;
  reasoning?: ReasoningEffort;
  /** Also count from the food tables (needs DATABASE_URL). */
  useDb?: boolean;
  log?: (line: string) => void;
};

/** Runs one meal; never throws (errors are part of the result). */
export const evalMeal = async (meal: EvalMeal, options: EvalOptions): Promise<EvalMealResult> => {
  const result: EvalMealResult = {
    name: meal.name,
    truth: meal.truth,
    model: null,
    database: null,
    latencyMs: 0,
    usage: null,
    items: 0,
    error: null,
  };
  try {
    const images = [];
    for (const photo of meal.photos)
      images.push({
        mediaType: "image/jpeg" as const,
        data: (await processPhoto(photo)).analysis.toString("base64"),
      });
    const time =
      meal.truth.time && /^\d{1,2}:\d{2}$/.test(meal.truth.time) ? meal.truth.time : "12:30";
    const { prompt, refs } = buildAnalysisPrompt({
      photoCount: images.length,
      note: meal.truth.note?.slice(0, 500) || null,
      localTime: time,
      weekday: "weekday",
      slot: slotOf(time),
      units: "metric",
      cuisines: Array.isArray(meal.truth.cuisines) ? meal.truth.cuisines.map(String) : [],
      usual: [],
      planned: [],
      answers: [],
      corrections: [],
      current: [],
    });
    const adapter = createAdapter(options.provider, { apiKey: options.apiKey });
    const started = performance.now();
    const response = await adapter.send({
      model: options.model,
      system: ANALYSIS_SYSTEM,
      prompt,
      images,
      json: { name: "meal_analysis", schema: ANALYSIS_SCHEMA },
      maxOutputTokens: analysisTokenLimit(1),
      reasoning: options.reasoning,
    });
    result.latencyMs = Math.round(performance.now() - started);
    result.usage = response.usage;
    const { output } = parseAnalysis(response.json, refs, response);
    result.items = output.items.length;
    result.model = modelTotals(output);
    if (options.useDb && output.is_food) {
      const { computed } = await resolveItems(
        "00000000-0000-0000-0000-000000000000",
        output.items,
        { usual: [], planned: [] },
        { aiMatching: false, saveLabels: false },
      );
      result.database = metricsOf(
        sumNutrients(computed.map((c) => c.nutrients)),
        computed.reduce((sum, c) => sum + c.grams, 0),
      );
    }
  } catch (error) {
    result.error = isAiError(error)
      ? `${error.kind}: ${describeAiError(error)}`
      : error instanceof Error
        ? error.message
        : String(error);
  }
  return result;
};

/** The model's own estimate of a meal: its items' estimates and grams, summed. */
export const modelTotals = (output: AnalysisOutput) =>
  metricsOf(
    sumNutrients(output.items.map((item) => estimateToNutrients(item.estimate))),
    output.items.reduce((sum, item) => sum + (item.grams ?? 0), 0),
  );

const percentile = (sorted: number[], p: number) =>
  sorted.length
    ? sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)]!
    : 0;

const round = (value: number, digits = 1) => Math.round(value * 10 ** digits) / 10 ** digits;

const summariseMetric = (
  pairs: { predicted: number; truth: number }[],
): MetricSummary | undefined => {
  const valid = pairs.filter((p) => isNumber(p.predicted) && isNumber(p.truth) && p.truth > 0);
  if (!valid.length) return undefined;
  const n = valid.length;
  const errors = valid.map((p) => p.predicted - p.truth);
  const relative = valid.map((p) => (p.predicted - p.truth) / p.truth);
  return {
    n,
    mae: round(errors.reduce((s, e) => s + Math.abs(e), 0) / n),
    mape: round((100 * relative.reduce((s, e) => s + Math.abs(e), 0)) / n),
    bias: round(errors.reduce((s, e) => s + e, 0) / n),
    biasPercent: round((100 * relative.reduce((s, e) => s + e, 0)) / n),
  };
};

export const summarise = (results: EvalMealResult[]): EvalSummary => {
  const ok = results.filter((r) => !r.error);
  const table = (key: "model" | "database") => {
    const out: Partial<Record<Metric, MetricSummary>> = {};
    for (const metric of METRICS) {
      const summary = summariseMetric(
        ok
          .filter((r) => r[key] && isNumber(r.truth[metric]))
          .map((r) => ({ predicted: r[key]![metric] ?? NaN, truth: r.truth[metric]! })),
      );
      if (summary) out[metric] = summary;
    }
    return out;
  };
  const latencies = ok.map((r) => r.latencyMs).sort((a, b) => a - b);
  return {
    meals: results.length,
    failed: results.length - ok.length,
    model: table("model"),
    database: table("database"),
    latency: {
      mean: latencies.length
        ? Math.round(latencies.reduce((s, v) => s + v, 0) / latencies.length)
        : 0,
      p50: percentile(latencies, 50),
      p90: percentile(latencies, 90),
      max: latencies.at(-1) ?? 0,
    },
    tokens: {
      inputTokens: ok.reduce((s, r) => s + (r.usage?.inputTokens ?? 0), 0),
      outputTokens: ok.reduce((s, r) => s + (r.usage?.outputTokens ?? 0), 0),
    },
  };
};

const UNITS: Record<Metric, string> = {
  kcal: "kcal",
  protein: "g",
  carbs: "g",
  fat: "g",
  grams: "g",
};

export const formatReport = (
  results: EvalMealResult[],
  summary: EvalSummary,
  options: EvalOptions,
) => {
  const lines = [
    `Cal accuracy check: ${options.provider} ${options.model}${options.reasoning ? ` (effort ${options.reasoning})` : ""}`,
    "",
    "meal                          true kcal   model kcal   error   database kcal   seconds",
  ];
  for (const r of results) {
    const name = r.name.slice(0, 28).padEnd(28);
    if (r.error) {
      lines.push(`${name}  ${String(r.truth.kcal).padStart(9)}   failed: ${r.error}`);
      continue;
    }
    const model = r.model?.kcal ?? 0;
    const error = model - r.truth.kcal;
    lines.push(
      `${name}  ${String(Math.round(r.truth.kcal)).padStart(9)}   ${String(Math.round(model)).padStart(10)}   ${`${error >= 0 ? "+" : ""}${Math.round(error)}`.padStart(5)}   ${(r.database ? String(Math.round(r.database.kcal ?? 0)) : "-").padStart(13)}   ${(r.latencyMs / 1000).toFixed(1).padStart(7)}`,
    );
  }
  const block = (title: string, table: EvalSummary["model"]) => {
    const metrics = METRICS.filter((m) => table[m]);
    if (!metrics.length) return;
    lines.push("", title, "metric     n    mean abs error   mean abs % error   bias   bias %");
    for (const m of metrics) {
      const s = table[m]!;
      lines.push(
        `${m.padEnd(8)} ${String(s.n).padStart(3)}    ${`${s.mae} ${UNITS[m]}`.padStart(14)}   ${`${s.mape} %`.padStart(16)}   ${`${s.bias >= 0 ? "+" : ""}${s.bias}`.padStart(5)}   ${`${s.biasPercent >= 0 ? "+" : ""}${s.biasPercent} %`.padStart(6)}`,
      );
    }
  };
  block("The model's own estimates:", summary.model);
  block("Counted from the food tables:", summary.database);
  lines.push(
    "",
    `Meals: ${summary.meals}, failed: ${summary.failed}. Latency of the vision call: mean ${(summary.latency.mean / 1000).toFixed(1)} s, median ${(summary.latency.p50 / 1000).toFixed(1)} s, 90th percentile ${(summary.latency.p90 / 1000).toFixed(1)} s.`,
    `Tokens: ${summary.tokens.inputTokens} in, ${summary.tokens.outputTokens} out.`,
  );
  return lines.join("\n");
};

export const USAGE = `Usage: corepack pnpm@11.11.0 eval --dir <folder> --provider <${AI_PROVIDERS.join("|")}> [options]

  --dir <folder>      the weighed meals (see lib/analysis/eval.ts for the format)
  --provider <name>   openai, anthropic or google
  --model <id>        default: Cal's analysis default for the provider
  --effort <level>    none, minimal, low, medium or high (default low)
  --key-env <name>    environment variable with the API key (default CAL_EVAL_API_KEY)
  --db                also count from the food tables of the database at DATABASE_URL
  --json <file>       also write every result to a JSON file
  --limit <n>         only the first n meals`;

type Args = Record<string, string | boolean>;

const parseArgs = (argv: string[]): Args => {
  const args: Args = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]!;
    if (!arg.startsWith("--")) continue;
    const key = arg.slice(2);
    const next = argv[i + 1];
    if (key === "db" || key === "help") args[key] = true;
    else if (next !== undefined && !next.startsWith("--")) {
      args[key] = next;
      i += 1;
    }
  }
  return args;
};

/** The command line. Returns the exit code. */
export const main = async (
  argv: string[],
  env: Record<string, string | undefined>,
  out: (line: string) => void = (line) => console.log(line),
) => {
  const args = parseArgs(argv);
  if (args.help || !args.dir || !isAiProvider(args.provider)) {
    out(USAGE);
    return args.help ? 0 : 2;
  }
  const provider = args.provider;
  const model = typeof args.model === "string" ? args.model : DEFAULT_MODELS[provider].analysis;
  if (!isValidModelName(model)) {
    out("That is not a valid model name.");
    return 2;
  }
  const reasoning = typeof args.effort === "string" ? args.effort : "low";
  if (!isReasoningEffort(reasoning)) {
    out("Unknown effort; use none, minimal, low, medium or high.");
    return 2;
  }
  const keyEnv = typeof args["key-env"] === "string" ? args["key-env"] : "CAL_EVAL_API_KEY";
  const apiKey = env[keyEnv]?.trim();
  if (!apiKey) {
    out(`Set the API key in the environment variable ${keyEnv} first.`);
    return 2;
  }
  if (args.db && !env.DATABASE_URL) {
    out("--db needs DATABASE_URL.");
    return 2;
  }

  let meals = await loadEvalFolder(String(args.dir), out);
  const limit = Number(args.limit);
  if (Number.isInteger(limit) && limit > 0) meals = meals.slice(0, limit);
  if (!meals.length) {
    out("No meals found.");
    return 1;
  }

  const options: EvalOptions = { provider, model, apiKey, reasoning, useDb: !!args.db, log: out };
  const results: EvalMealResult[] = [];
  for (const [index, meal] of meals.entries()) {
    out(`(${index + 1}/${meals.length}) ${meal.name}`);
    results.push(await evalMeal(meal, options));
  }
  const summary = summarise(results);
  out("");
  out(formatReport(results, summary, options));
  if (typeof args.json === "string") {
    await writeFile(
      args.json,
      JSON.stringify(
        { provider, model, reasoning, at: new Date().toISOString(), summary, results },
        null,
        2,
      ),
    );
    out(`Results written to ${args.json}.`);
  }
  if (args.db) await (await import("@/db")).closeDb();
  return summary.failed === summary.meals ? 1 : 0;
};
