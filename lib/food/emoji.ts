// One emoji per food, for the item tiles, the timeline line ("🍳 Egg · 🍞 Toast") and the plate
// icon of meals without a photo. The analysis model suggests one (checked with cleanEmoji); every
// other item, and older rows without one, get emojiFor: keywords in English and in the Persian
// dishes Kal seeds (scripts/data/persian-dishes.json), in the Latin spelling and in Persian
// script. Rows that already store an emoji keep it. Plain functions, safe for client components.
//
// The emoji shows the food the name is about (its head), not the first food word in it: "grape
// tomatoes" are tomatoes, "chocolate milk" is milk, "rice cakes" are rice crackers. The head is
// found like this:
//   1. The part before "with", "in", "on", "over", "&"... is the food; the rest goes with it
//      ("tea with sugar" is tea, "sardines in oil" are sardines). In Persian: before "با".
//   2. Every rule is matched everywhere in that part, on word boundaries ("pineapple" is not an
//      apple, "butternut" is not butter, "watermelon" is not a melon). Rules also name compounds
//      ("peanut butter", "sweet potato", "hot chocolate", "rice cake", "fish sauce" is a sauce).
//   3. English puts the head last, so the match that ends last wins; of two that end at the same
//      place, the longer one ("sweet potato" over "potato", "peanut butter" over "butter").
//      Persian dish words written in Latin letters name the dish first ("khoresh bademjan" is a
//      stew, "kuku sabzi" a frittata): their rule is marked lead and wins wherever it matches.
//   4. Persian puts the head first ("گوجه گیلاسی", cherry tomatoes, is a tomato), so in Persian
//      script the match that starts first wins (of two, the longer one), except the rice dishes
//      named after what is in the rice ("زرشک پلو", "سبزی‌پلو"): that rule is marked tail and wins
//      wherever it matches.
//   5. Nothing found: the whole name again (without step 1), then the other names given (the
//      matched food's name, the local name); otherwise 🥤 for a drink and 🍽️ for anything else.
import type { ItemKind } from "@/lib/contracts/meals";

/** Drinks without a better match. */
export const DRINK_EMOJI = "🥤";
/** Foods without a better match. */
export const FOOD_EMOJI = "🍽️";

/** lead: names the dish wherever it stands (Latin letters); tail: the same in Persian script. */
type Mark = "lead" | "tail";
type Rule = [RegExp, string] | [RegExp, string, Mark];

/**
 * Keyword rules. Their order only settles two matches of exactly the same words (the earlier
 * rule wins). Inside a pattern, compounds come before their parts.
 */
const RULES: Rule[] = [
  // Persian dish words that name the dish first, in Latin letters.
  [
    /\b(?:khoresh|khoresht|ghormeh|qormeh|gheymeh|qeymeh|ash(?:-?e)?|abgoosht|abgusht|dizi|halim|haleem)\b/,
    "🍲",
    "lead",
  ],
  [/\b(?:kuku|kookoo)\b/, "🍳", "lead"],
  // Persian rice dishes named after what is in the rice, in Persian script.
  [/پلو|چلو/, "🍚", "tail"],

  // Sweets.
  [
    /sholeh ?zard|shole ?zard|sholezard|pudding|custard|flan|creme caramel|crème caramel|fereni|firni|شله[\s‌]?زرد|شیر[\s‌]?برنج|فرنی/,
    "🍮",
  ],
  [
    /ice ?cream (?:sandwich(?:es)?|cones?|bars?)|ice ?cream|gelato|sorbet|frozen yogh?urt|frozen yog|bastani|بستنی/,
    "🍨",
  ],
  [/pancakes?|crepes?|crêpes?/, "🥞"],
  [/cupcakes?|muffins?/, "🧁"],
  [/cheesecake|shortcake|\bcakes?\b|brownies?|کیک/, "🍰"],
  [/\bcookies?\b|\bbiscuits?\b|shortbread|koloocheh|nan-?e berenji|شیرینی|بیسکویت/, "🍪"],
  [/chocolate chips?|chocolate|\bcocoa\b|nutella|شکلات|کاکائو/, "🍫"],
  [/donuts?|doughnuts?/, "🍩"],
  [/croissants?|pain au chocolat/, "🥐"],
  [/baklava|pastry|pastries|\bpies?\b|\btarts?\b|strudel|زولبیا|بامیه/, "🥧"],
  [
    /jelly ?beans?|\bcandy|candies|gummy|gummies|lollipops?|toffee|butterscotch|nougat|\bgaz\b|sohan|گز|سوهان/,
    "🍬",
  ],
  [/\bhoney\b|عسل/, "🍯"],
  [/\bjams?\b|marmalade|preserves?\b|مربا/, "🫙"],

  // Dishes, Persian and others.
  [
    /kabab|kebab|kabob|koobideh|kubideh|joojeh|jujeh|\bbarg\b|shishlik|skewers?|satay|souvlaki|کباب|جوجه/,
    "🍢",
  ],
  [
    /\bstews?\b|\bsoups?\b|broth|chowder|bisque|fesenjan|fesenjoon|آش|خورش|قورمه|قیمه|فسنجان|آبگوشت|دیزی|سوپ|حلیم/,
    "🍲",
  ],
  [/ramen|\bpho\b|noodle soup|udon/, "🍜"],
  [/\bdoogh\b|ayran|kefir|lassi|buttermilk|دوغ/, "🥛"],
  [/frittata|omelets?|omelettes?|shakshuka|کوکو|املت/, "🍳"],
  [/olivieh|olivier|shirazi|\bsalads?\b|slaw|tabbouleh|fattoush|سالاد|الویه/, "🥗"],
  [/(?:sushi|maki|california) rolls?|sushi|\bmaki\b|nigiri/, "🍣"],
  [/biryani|biriyani|curry|curries|\bdaal\b|\bdal\b|\bdhal\b|کاری/, "🍛"],
  [/rice ?cakes?|rice crackers?|senbei/, "🍘"],
  [
    /tahdig|tahchin|chelow|chelo|\bpolo\b|polow|pilaf|pilau|pulao|risotto|paella|\brice\b|ته[\s‌]?دیگ|ته[\s‌]?چین|برنج/,
    "🍚",
  ],
  [
    /kashk(?:-?e)? bademjan|\bkashk\b|mirza ?ghasemi|baba ?ganoush|eggplants?|aubergines?|bademjan|badenjan|بادمجان|میرزا ?قاسمی/,
    "🍆",
  ],
  [/kotlet|cutlets?|meatballs?|kofta|kufteh|کتلت|کوفته/, "🧆"],
  [/falafel|felafel|فلافل/, "🧆"],
  [/\bmast\b|mast-?o|yogh?urt|skyr|labneh|ماست/, "🥣"],
  [/dolma|dolmeh|grape leaves|vine leaves|دلمه/, "🥬"],

  // Drinks.
  [
    /hot chocolate|hot cocoa|coffee|espresso|latte|cappuccino|americano|macchiato|mocha|flat white|قهوه/,
    "☕",
  ],
  [/\btea\b|\bchai\b|matcha|infusion|herbal|چای/, "🍵"],
  [
    /juices?|smoothies?|nectar|آبمیوه|آب[\s‌]?(?:میوه|سیب|پرتقال|انار|انگور|هویج|آلبالو|هندوانه|لیمو|طالبی|آناناس)/,
    "🧃",
  ],
  [/\bbeers?\b|lager|\bales?\b|stout|\bipa\b|pilsner|آبجو/, "🍺"],
  [/\bwines?\b|champagne|prosecco|\bcava\b|sangria|شراب/, "🍷"],
  [
    /whisky|whiskey|vodka|\bgin\b|\brum\b|tequila|\barak\b|araq|brandy|cognac|liqueur|liquor|cocktails?|spirits?\b|عرق|ودکا/,
    "🥃",
  ],
  [
    /root beer|ginger ale|\bsodas?\b|\b(?:coca-?)?colas?\b|\bcoke\b|pepsi|sprite|fanta|lemonade|soft drinks?|energy drinks?|tonic|نوشابه/,
    "🥤",
  ],
  [/milkshakes?|\bshakes?\b/, "🥤"],
  [/\bmilk\b|(?:^|\s)شیر(?:$|\s)/, "🥛"],
  [/\bwater\b|^آب$|آب معدنی/, "💧"],

  // Dishes and staples.
  [/pizzas?|پیتزا/, "🍕"],
  [/burgers?|hamburgers?|همبرگر/, "🍔"],
  [
    /hot ?dogs?|corn ?dogs?|chili dogs?|sausage rolls?|sausages?|frankfurters?|bratwurst|sosis|سوسیس/,
    "🌭",
  ],
  [/burritos?|\bwraps?\b|shawarma|doner|döner|gyros?|لقمه/, "🌯"],
  [/tacos?|quesadillas?/, "🌮"],
  [/sandwich(?:es)?|panini|\bsubs?\b|toastie|ساندویچ/, "🥪"],
  [/spring rolls?|egg rolls?|summer rolls?|dumplings?|gyoza|momo|mantu|ravioli|samosas?/, "🥟"],
  [
    /pasta|spaghetti|macaroni|lasagn|penne|fusilli|linguine|tagliatelle|noodles?|ماکارونی|پاستا|رشته/,
    "🍝",
  ],
  [/\bfries\b|french fries|\bchips\b|crisps|سیب[\s‌]?زمینی سرخ/, "🍟"],
  [/sweet ?potato(?:es)?|\byams?\b|سیب[\s‌]?زمینی شیرین/, "🍠"],
  [/potato(?:es)?|\bmash\b|سیب[\s‌]?زمینی/, "🥔"],
  [/waffles?/, "🧇"],
  [/cereal|cornflakes|corn flakes|oatmeal|\boats?\b|porridge|granola|muesli|bran flakes/, "🥣"],
  [/bagels?/, "🥯"],
  [/baguettes?/, "🥖"],
  [
    /(?:pitt?a|naan|\bnan|lavash|barbari|sangak|taftoon|flat) ?breads?|\bpitt?as?\b|flatbreads?|lavash|lavaash|barbari|sangak|taftoon|taftun|naan|\bnan\b|tortillas?|لواش|بربری|سنگک|تافتون|نان/,
    "🫓",
  ],
  [/bread|toast|\brolls?\b|\bbuns?\b|brioche|sourdough|\brye\b|نان تست/, "🍞"],
  [/pretzels?/, "🥨"],
  [/popcorn|پاپ ?کورن/, "🍿"],

  // Proteins.
  [/\beggs?\b|egg whites?|egg yolks?|تخم[\s‌]?مرغ/, "🍳"],
  [/cheese|feta|paneer|mozzarella|cheddar|parmesan|halloumi|ricotta|\bbrie\b|gouda|پنیر/, "🧀"],
  [/shrimps?|prawns?|میگو/, "🍤"],
  [/crab ?cakes?|lobster rolls?|\bcrabs?\b|lobsters?|crayfish/, "🦀"],
  [
    /fish ?cakes?|fish ?fingers?|fish ?sticks?|(?:tuna|salmon|swordfish|fish) steaks?|fish|salmon|tuna|\bcod\b|trout|sardines?|mackerel|tilapia|haddock|halibut|anchov|seafood|ماهی/,
    "🐟",
  ],
  [/chicken|poultry|turkey|\bduck\b|drumsticks?|\bwings?\b|nuggets?|مرغ|بوقلمون/, "🍗"],
  [/bacon/, "🥓"],
  [
    /beef|steaks?|lamb|mutton|veal|\bpork\b|\bham\b|\bmeat\b|goat|liver|jerky|minced|ground meat|گوشت|استیک|جگر/,
    "🥩",
  ],

  // Nuts and seeds (peanut butter too), then fats, spreads and sauces.
  [
    /peanut butter|almond butter|nut butter|کره[\s‌]?بادام[\s‌]?زمینی|peanuts?|almonds?|walnuts?|pistachios?|cashews?|hazelnuts?|pecans?|chestnuts?|\bnuts?\b|\bseeds?\b|trail mix|بادام|گردو|پسته|فندق|آجیل/,
    "🥜",
  ],
  [/olive oil|\bolives?\b|زیتون/, "🫒"],
  [/\bbutter(?:ed)?\b|ghee|margarine|کره/, "🧈"],
  [/\boils?\b|\bdressings?\b|روغن/, "🫒"],
  [/\bsauces?\b|ketchup|mayonnaise|\bmayo\b|mustard|vinegar|sriracha|chutney|سس/, "🫙"],

  // Beans and peas.
  [/hummus|chickpeas?|lentils?|\bbeans?\b|\bdal\b|لوبیا|عدس|نخود/, "🫘"],
  [/\bpeas?\b|edamame/, "🫛"],

  // Fruit.
  [/applesauce|apple sauce|\bapples?\b|سیب/, "🍎"],
  [/bananas?|موز/, "🍌"],
  [
    /grapefruits?|pomelos?|\boranges?\b|tangerines?|mandarins?|clementines?|پرتقال|نارنگی|گریپ ?فروت/,
    "🍊",
  ],
  [/\blemons?\b|\blimes?\b|لیمو/, "🍋"],
  [/\bgrapes?\b|raisins?|kishmish|انگور|کشمش/, "🍇"],
  [/strawberr|توت ?فرنگی/, "🍓"],
  [/blueberr|berries|raspberr|blackberr|cranberr/, "🫐"],
  [/cherr|گیلاس|آلبالو/, "🍒"],
  [/peach|apricots?|nectarines?|\bplums?\b|هلو|زردآلو|آلو/, "🍑"],
  [/\bpears?\b|گلابی/, "🍐"],
  [/pineapples?|آناناس/, "🍍"],
  [/mangos?\b|mangoes|انبه/, "🥭"],
  [/kiwis?|کیوی/, "🥝"],
  [/watermelons?|هندوانه/, "🍉"],
  [/\bmelons?\b|cantaloupe|honeydew|طالبی|خربزه/, "🍈"],
  [/coconut (?:milk|water|cream|oil)|coconuts?|نارگیل/, "🥥"],
  [/avocados?|آووکادو/, "🥑"],
  [/\bfruits?\b|pomegranates?|\bdates?\b|\bfigs?\b|persimmons?|انار|خرما|انجیر|میوه/, "🍎"],

  // Vegetables.
  [/grape tomato(?:es)?|cherry tomato(?:es)?|plum tomato(?:es)?|tomato(?:es)?|گوجه/, "🍅"],
  [/cucumbers?|pickles?|gherkins?|خیار/, "🥒"],
  [/carrots?|هویج/, "🥕"],
  [/\bcorn\b|sweetcorn|maize|ذرت/, "🌽"],
  [/broccoli|cauliflower|کلم ?بروکلی|گل ?کلم/, "🥦"],
  [/chil+i|jalape|chilli/, "🌶️"],
  [/bell peppers?|capsicum|\bpeppers?\b|فلفل/, "🫑"],
  [/onions?|shallots?|پیاز/, "🧅"],
  [/garlic|(?:^|\s)سیر(?:$|\s)/, "🧄"],
  [/mushrooms?|قارچ/, "🍄"],
  [/butternut(?: squash)?|pumpkins?|کدو ?حلوایی|کدو تنبل/, "🎃"],
  [
    /lettuce|spinach|\bkale\b|greens|herbs?\b|sabzi|cabbage|arugula|rocket|اسفناج|کاهو|سبزی|کلم/,
    "🥬",
  ],
  [/vegetables?|veggies|vegetable mix|zucchini|courgettes?|squash|کدو|سبزیجات/, "🥦"],
  [/\bsugar\b|syrup|قند|شکر/, "🍬"],
  [/\bsalt\b|نمک/, "🧂"],
];

const COMPILED = RULES.map(([pattern, emoji, mark]) => ({
  pattern: new RegExp(pattern.source, "g"),
  emoji,
  mark,
}));

/** The food comes before these words; what follows goes with it. */
const CONNECTORS = /\s(?:with|without|in|on|over|served|topped|&)\s|\sبا\s/;
const PERSIAN = /[؀-ۿ]/;
const LATIN = /[a-z]/;

type Found = { start: number; end: number; emoji: string; mark?: Mark; rule: number };

/** Every match of every rule, without the spaces some patterns take around a word. */
const findAll = (text: string): Found[] => {
  const found: Found[] = [];
  COMPILED.forEach(({ pattern, emoji, mark }, rule) => {
    for (const match of text.matchAll(pattern)) {
      const words = match[0];
      if (!words.trim()) continue;
      const start = match.index + (words.length - words.trimStart().length);
      const end = match.index + words.trimEnd().length;
      found.push({ start, end, emoji, mark, rule });
    }
  });
  return found;
};

/**
 * Whether b is a better head than a: in English the one that ends last (then the longer one), in
 * Persian the one that starts first (then the longer one); then the earlier rule.
 */
const better = (b: Found, a: Found, persian: boolean) => {
  if (persian) {
    if (b.start !== a.start) return b.start < a.start;
    if (b.end !== a.end) return b.end > a.end;
  } else {
    if (b.end !== a.end) return b.end > a.end;
    if (b.start !== a.start) return b.start < a.start;
  }
  return b.rule < a.rule;
};

/** The emoji of the head food of a (lowercase) text, or null when no rule matches. */
const headEmoji = (text: string) => {
  const found = findAll(text);
  if (!found.length) return null;
  const persian = PERSIAN.test(text) && !LATIN.test(text);
  const marked = found.filter((f) => f.mark === (persian ? "tail" : "lead"));
  const pool = marked.length ? marked : found;
  return pool.reduce((best, next) => (better(next, best, persian) ? next : best)).emoji;
};

/** The part of a food name before its first detail: "Rice, white, cooked" -> "Rice". */
export const shortFoodName = (name: string) => {
  const main = name.split(/[(,;]/)[0]!.replace(/\s+/g, " ").trim();
  return main || name.trim();
};

const matchRules = (text: string) => {
  const lower = text.toLowerCase().replace(/\s+/g, " ").trim();
  if (!lower) return null;
  const head = lower.split(CONNECTORS)[0]!.trim();
  return (head ? headEmoji(head) : null) ?? (head !== lower ? headEmoji(lower) : null);
};

const nameEmoji = (name: string | null | undefined) => {
  const full = (name ?? "").trim();
  return full ? (matchRules(shortFoodName(full)) ?? matchRules(full)) : null;
};

/**
 * The emoji for a food: the head food of the main name first ("Lubia polo (green bean rice with
 * beef)" is a rice dish), then of the whole name, then of the other names given (the matched
 * food's name, the local name); otherwise 🥤 for a drink and 🍽️ for anything else.
 */
export const emojiFor = (
  name: string | null | undefined,
  kind: ItemKind | string | null | undefined,
  otherNames: (string | null | undefined)[] = [],
): string => {
  for (const candidate of [name, ...otherNames]) {
    const found = nameEmoji(candidate);
    if (found) return found;
  }
  return kind === "drink" ? DRINK_EMOJI : FOOD_EMOJI;
};

const PICTOGRAPHIC = /\p{Extended_Pictographic}/u;

/**
 * The model's emoji, when it is exactly one emoji (one grapheme, which may join several code
 * points, that contains a pictograph); otherwise null.
 */
export const cleanEmoji = (value: unknown): string | null => {
  if (typeof value !== "string") return null;
  const text = value.trim();
  if (!text || text.length > 16) return null;
  const graphemes = [...new Intl.Segmenter("en", { granularity: "grapheme" }).segment(text)];
  if (graphemes.length !== 1) return null;
  return PICTOGRAPHIC.test(text) ? text : null;
};
