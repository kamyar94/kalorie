// The JSON schemas sent to the models: the photo analysis (docs/DESIGN.md section 4 step 2) and the
// food matching choice (step 3). They follow the strictest rules of the three providers, as the
// Lingo AI layer documents them: every object closed (additionalProperties false), every property
// required, no null types, no length, range, format or pattern keywords. "Nothing" is therefore an
// empty string, 0 or an empty array, and lib/analysis/parse.ts turns those into nulls.
// Plain data, no imports from the server.
import type { JsonSchema } from "@/lib/ai/types";
import { NOT_FOOD_KINDS } from "@/lib/contracts/analysis";
import { MEAL_SLOTS } from "@/lib/contracts/meals";

export const ANALYSIS_ITEM_KINDS = ["dish", "ingredient", "drink", "packaged"] as const;

/** The nutrients a label line or an estimate can name. */
export const LABEL_NUTRIENTS = [
  "kcal",
  "protein",
  "carbs",
  "fat",
  "fiber",
  "sugar",
  "sodium",
] as const;
export type LabelNutrient = (typeof LABEL_NUTRIENTS)[number];

export const LABEL_BASES = ["per_100g", "per_100ml", "per_serving"] as const;
export type LabelBasis = (typeof LABEL_BASES)[number];

const str = (description: string) => ({ type: "string", description });
const num = (description: string) => ({ type: "number", description });
const strings = (description: string) => ({
  type: "array",
  description,
  items: { type: "string" },
});

const object = (properties: Record<string, unknown>, description?: string): JsonSchema => ({
  type: "object",
  ...(description ? { description } : {}),
  additionalProperties: false,
  required: Object.keys(properties),
  properties,
});

const ESTIMATE = object(
  {
    kcal: num("Energy in kcal for the whole item as eaten, cooking fat included."),
    protein: num("Grams of protein."),
    carbs: num("Grams of carbohydrate."),
    fat: num("Grams of fat."),
    fiber: num("Grams of fiber."),
    sugar: num("Grams of total sugars."),
    sodium: num("Milligrams of sodium."),
  },
  "Your own nutrient estimate for the whole item at its grams, used only when the database has no match.",
);

const LABEL = object(
  {
    barcode: str(
      "The barcode digits exactly as printed under the bars (EAN-13, UPC-A, EAN-8), empty when they are not fully readable. Never guess digits.",
    ),
    serving_grams: num("Grams (or ml) of one serving as printed on the label, 0 when not printed."),
    facts: {
      type: "array",
      description: "Each nutrition fact you can read on the label, exactly as printed.",
      items: object({
        nutrient: { type: "string", enum: [...LABEL_NUTRIENTS] },
        basis: { type: "string", enum: [...LABEL_BASES] },
        amount: num("The printed amount (sodium in mg, energy in kcal, others in g)."),
      }),
    },
  },
  "What a readable package or nutrition label shows.",
);

const ITEM = object({
  name: str(
    'Plain English name as a food database would list it, or the dish\'s real name ("White rice, cooked", "Ghormeh sabzi").',
  ),
  local_name: str(
    "The name in the cuisine's own language and script (Persian: قورمه سبزی), empty when there is none.",
  ),
  kind: { type: "string", enum: [...ANALYSIS_ITEM_KINDS] },
  emoji: str(
    "Exactly one emoji that pictures this food or drink, for example a rice bowl for rice, a poultry leg for chicken, a droplet for water. Empty when none fits.",
  ),
  preparation: str(
    "How it was prepared: raw, boiled, steamed, fried, deep-fried, grilled, roasted, baked, stewed, sauteed... Empty when it does not apply.",
  ),
  grams: num("Best estimate of the weight eaten, in grams (drinks too: their weight)."),
  ml: num("Volume in millilitres for drinks, 0 for everything else."),
  grams_low: num("Low end of a realistic range for the weight, in grams."),
  grams_high: num("High end of a realistic range for the weight, in grams."),
  portion_text: str('The household measure, for example "1 cup", "2 skewers", "1 can (330 ml)".'),
  confidence: num("How sure you are of this item's identity and amount, 0 to 1."),
  photo_indexes: {
    type: "array",
    description: "The photos (numbered from 0) this item is visible in.",
    items: { type: "integer" },
  },
  search_terms: strings(
    "Two to four short phrases to search a food database with, most specific first.",
  ),
  matches_usual: str("The id of the person's usual meal this item is (u...), else empty."),
  matches_planned: str("The id of the planned recipe this item is (p...), else empty."),
  same_as_item: str("On a re-analysis: the id of the current item this one is (i...), else empty."),
  components: {
    type: "array",
    description:
      "For a mixed dish: its main components with their grams in this portion (cooking fat included), adding up to the item's grams. Empty for simple foods.",
    items: object({
      name: str('Plain English name of the component ("Beef, stewed", "Kidney beans, cooked").'),
      grams: num("Grams of this component in the portion."),
    }),
  },
  label: {
    type: "array",
    description:
      "One entry when a package or nutrition label of this item is readable, else empty.",
    items: LABEL,
  },
  estimate: ESTIMATE,
});

/** The photo analysis reply (task "analysis"). */
export const ANALYSIS_SCHEMA: JsonSchema = object({
  is_food: { type: "boolean", description: "Whether the photos show food or drink to log." },
  // The system prompt says what each kind covers ("Is it food?").
  not_food_kind: {
    type: "string",
    enum: ["none", ...NOT_FOOD_KINDS],
    description: "What it is when not food; none for food.",
  },
  cuisine: str('The main cuisine ("Persian", "Italian"), empty when mixed or unclear.'),
  items: { type: "array", description: "Every item to log, each once.", items: ITEM },
  title: str("A short name for the meal, at most six words; when not food, what the photo shows."),
  meal_type: {
    type: "string",
    enum: [...MEAL_SLOTS],
    description: "Which meal this is, from the food, the amount and the local time.",
  },
  questions: {
    type: "array",
    description: "At most two short clarifying questions, usually none.",
    items: object({
      question: str("One short question."),
      answers: strings("Two to four short suggested answers."),
    }),
  },
  overall_confidence: num("How sure you are of the whole meal's calories, 0 to 1."),
});

/** The matching reply (task "matching"): one candidate id or "none" per numbered entry. */
export const MATCHING_SCHEMA: JsonSchema = object({
  matches: {
    type: "array",
    description: "One entry per numbered food.",
    items: object({
      entry: { type: "integer", description: "The number of the food." },
      candidate: str("The id of the chosen candidate (c...), or none."),
    }),
  },
});

// ---- Raw reply shapes (before parse.ts cleans them) ----

export type RawEstimate = Record<LabelNutrient, number>;

export type RawLabel = {
  barcode: string;
  serving_grams: number;
  facts: { nutrient: LabelNutrient; basis: LabelBasis; amount: number }[];
};

export type RawItem = {
  name: string;
  local_name: string;
  kind: (typeof ANALYSIS_ITEM_KINDS)[number];
  emoji: string;
  preparation: string;
  grams: number;
  ml: number;
  grams_low: number;
  grams_high: number;
  portion_text: string;
  confidence: number;
  photo_indexes: number[];
  search_terms: string[];
  matches_usual: string;
  matches_planned: string;
  same_as_item: string;
  components: { name: string; grams: number }[];
  label: RawLabel[];
  estimate: RawEstimate;
};

export type RawAnalysis = {
  is_food: boolean;
  not_food_kind: string;
  cuisine: string;
  items: RawItem[];
  title: string;
  meal_type: string;
  questions: { question: string; answers: string[] }[];
  overall_confidence: number;
};

export type RawMatching = { matches: { entry: number; candidate: string }[] };
