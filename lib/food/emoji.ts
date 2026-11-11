// One emoji per food, for the item tiles, the timeline line ("🍳 Egg · 🍞 Toast") and the plate
// icon of meals without a photo. The analysis model suggests one (checked with cleanEmoji); every
// other item, and older rows without one, get emojiFor: keywords in English and in the Persian
// dishes Kal seeds (scripts/data/persian-dishes.json), in the Latin spelling and in Persian
// script. Plain functions, safe for client components.
import type { ItemKind } from "@/lib/contracts/meals";

/** Drinks without a better match. */
export const DRINK_EMOJI = "🥤";
/** Foods without a better match. */
export const FOOD_EMOJI = "🍽️";

/**
 * Keyword rules, most specific first: the first rule whose pattern matches wins. Persian dishes
 * come before the plain foods they contain ("sabzi polo" is rice, "khoresh bademjan" a stew).
 */
const RULES: [RegExp, string][] = [
  // Sweets that contain other foods' names.
  [
    /sholeh ?zard|shole ?zard|sholezard|pudding|custard|flan|creme caramel|crème caramel|fereni|firni|شله[\s‌]?زرد|فرنی/,
    "🍮",
  ],
  [/ice ?cream|gelato|sorbet|frozen yog|bastani|بستنی/, "🍨"],
  [/pancake|crepe|crêpe/, "🥞"],
  [/cupcake|muffin/, "🧁"],
  [/cheesecake|\bcakes?\b|brownie|کیک/, "🍰"],
  [/\bcookies?\b|biscuit|shortbread|koloocheh|nan-?e berenji|شیرینی|بیسکویت/, "🍪"],
  [/chocolate|cocoa|nutella|شکلات/, "🍫"],
  [/donut|doughnut/, "🍩"],
  [/croissant/, "🥐"],
  [/baklava|pastry|\bpie\b|\btart\b|strudel|زولبیا|بامیه/, "🥧"],
  [/\bcandy|candies|gummy|lollipop|toffee|nougat|\bgaz\b|sohan|گز|سوهان/, "🍬"],
  [/\bhoney\b|عسل/, "🍯"],
  [/\bjam\b|marmalade|preserve|مربا/, "🫙"],

  // Persian dishes (the seeded ones and their relatives).
  [
    /kabab|kebab|kabob|koobideh|kubideh|joojeh|jujeh|\bbarg\b|shishlik|skewer|satay|souvlaki|کباب|جوجه/,
    "🍢",
  ],
  [
    /\bash(-?e)?\b|khoresh|khoresht|ghormeh|qormeh|gheymeh|qeymeh|fesenjan|fesenjoon|abgoosht|abgusht|dizi|\bstew\b|\bsoup\b|broth|chowder|bisque|halim|haleem|آش|خورش|قورمه|قیمه|فسنجان|آبگوشت|دیزی|سوپ|حلیم/,
    "🍲",
  ],
  [/ramen|\bpho\b|noodle soup|udon/, "🍜"],
  [/\bdoogh\b|ayran|kefir|lassi|buttermilk|دوغ/, "🥛"],
  [/kuku|kookoo|kuku sabzi|frittata|omelet|omelette|shakshuka|کوکو|املت/, "🍳"],
  [/olivieh|olivier|shirazi|\bsalad\b|slaw|tabbouleh|fattoush|سالاد|الویه/, "🥗"],
  [/sushi|maki|nigiri/, "🍣"],
  [/biryani|biriyani|curry|daal|dal\b|dhal|کاری/, "🍛"],
  [
    /tahdig|tahchin|chelow|chelo|\bpolo\b|polow|pilaf|pilau|pulao|risotto|paella|\brice\b|چلو|پلو|ته[\s‌]?دیگ|ته[\s‌]?چین|برنج/,
    "🍚",
  ],
  [
    /kashk|bademjan|badenjan|eggplant|aubergine|mirza ?ghasemi|baba ?ganoush|بادمجان|میرزا ?قاسمی/,
    "🍆",
  ],
  [/kotlet|cutlet|meatball|kofta|kufteh|کتلت|کوفته/, "🧆"],
  [/falafel|felafel|فلافل/, "🧆"],
  [/\bmast\b|mast-?o|yogh?urt|skyr|labneh|ماست/, "🥣"],

  // Drinks.
  [/coffee|espresso|latte|cappuccino|americano|macchiato|mocha|flat white|قهوه/, "☕"],
  [/\btea\b|\bchai\b|matcha|infusion|herbal|چای/, "🍵"],
  [/watermelon|هندوانه/, "🍉"],
  [/coconut water/, "🥥"],
  [/juice|smoothie|nectar|آبمیوه|آب میوه/, "🧃"],
  [/\bbeer\b|lager|\bale\b|stout|\bipa\b|pilsner|آبجو/, "🍺"],
  [/\bwine\b|champagne|prosecco|cava|sangria|شراب/, "🍷"],
  [
    /whisky|whiskey|vodka|\bgin\b|\brum\b|tequila|\barak\b|araq|brandy|cognac|liqueur|liquor|cocktail|spirits?\b|عرق|ودکا/,
    "🥃",
  ],
  [/\bsoda\b|cola|\bcoke\b|pepsi|sprite|fanta|lemonade|soft drink|energy drink|tonic|نوشابه/, "🥤"],
  [/milkshake|shake\b/, "🥤"],
  [/\bmilk\b|(^|\s)شیر($|\s)/, "🥛"],
  [/\bwater\b|^آب$|آب معدنی/, "💧"],

  // Dishes and staples.
  [/pizza|پیتزا/, "🍕"],
  [/burger|hamburger|همبرگر/, "🍔"],
  [/hot ?dog|sausage|frankfurter|bratwurst|sosis|سوسیس/, "🌭"],
  [/burrito|\bwrap\b|shawarma|doner|döner|gyro|لقمه/, "🌯"],
  [/taco|quesadilla/, "🌮"],
  [/sandwich|panini|\bsub\b|toastie|ساندویچ/, "🥪"],
  [/dumpling|gyoza|momo|mantu|ravioli/, "🥟"],
  [
    /pasta|spaghetti|macaroni|lasagn|penne|fusilli|linguine|tagliatelle|noodle|ماکارونی|پاستا|رشته/,
    "🍝",
  ],
  [/\bfries\b|french fries|chips\b|crisps|سیب زمینی سرخ/, "🍟"],
  [/potato|potatoes|mash\b|سیب[\s‌]?زمینی/, "🥔"],
  [/waffle/, "🧇"],
  [/cereal|cornflakes|oatmeal|\boats?\b|porridge|granola|muesli|bran flakes|حلیم/, "🥣"],
  [/bagel/, "🥯"],
  [/baguette/, "🥖"],
  [
    /pita|pitta|flatbread|lavash|lavaash|barbari|sangak|taftoon|taftun|naan|\bnan\b|tortilla|لواش|بربری|سنگک|تافتون|نان/,
    "🫓",
  ],
  [/bread|toast|\broll\b|\bbun\b|brioche|sourdough|rye|نان تست/, "🍞"],
  [/pretzel/, "🥨"],
  [/popcorn|پاپ ?کورن/, "🍿"],

  // Proteins.
  [/\beggs?\b|egg white|egg yolk|تخم[\s‌]?مرغ/, "🍳"],
  [/cheese|feta|paneer|mozzarella|cheddar|parmesan|halloumi|ricotta|brie|gouda|پنیر/, "🧀"],
  [/shrimp|prawn|میگو/, "🍤"],
  [/crab|lobster|crayfish/, "🦀"],
  [
    /fish|salmon|tuna|\bcod\b|trout|sardine|mackerel|tilapia|haddock|halibut|anchov|seafood|ماهی/,
    "🐟",
  ],
  [/chicken|poultry|turkey|\bduck\b|drumstick|\bwings?\b|nugget|مرغ|بوقلمون/, "🍗"],
  [/bacon/, "🥓"],
  [
    /beef|steak|lamb|mutton|veal|\bpork\b|\bham\b|\bmeat\b|goat|liver|jerky|minced|ground meat|گوشت|استیک|جگر/,
    "🥩",
  ],

  // Nuts (peanut butter too), then fats and spreads.
  [
    /peanut|almond|walnut|pistachio|cashew|hazelnut|pecan|\bnuts?\b|trail mix|بادام|گردو|پسته|فندق|آجیل/,
    "🥜",
  ],
  [/olive oil|\bolives?\b|زیتون/, "🫒"],
  [/butter|ghee|margarine|کره/, "🧈"],
  [/\boil\b|\bdressing\b|روغن/, "🫒"],

  // Beans and seeds.
  [/hummus|chickpea|lentil|\bbeans?\b|kidney bean|black bean|\bdal\b|لوبیا|عدس|نخود/, "🫘"],
  [/\bpeas\b|edamame/, "🫛"],

  // Fruit.
  [/apple|سیب/, "🍎"],
  [/banana|موز/, "🍌"],
  [/orange|tangerine|mandarin|clementine|پرتقال|نارنگی/, "🍊"],
  [/lemon|lime|لیمو/, "🍋"],
  [/grape|raisin|kishmish|انگور|کشمش/, "🍇"],
  [/strawberr|توت ?فرنگی/, "🍓"],
  [/blueberr|berries|raspberr|blackberr|cranberr/, "🫐"],
  [/cherr|گیلاس|آلبالو/, "🍒"],
  [/peach|apricot|nectarine|plum|هلو|زردآلو|آلو/, "🍑"],
  [/\bpears?\b|گلابی/, "🍐"],
  [/pineapple|آناناس/, "🍍"],
  [/mango|انبه/, "🥭"],
  [/kiwi|کیوی/, "🥝"],
  [/melon|cantaloupe|طالبی|خربزه/, "🍈"],
  [/coconut|نارگیل/, "🥥"],
  [/avocado|آووکادو/, "🥑"],
  [/\bfruits?\b|pomegranate|\bdates?\b|\bfigs?\b|persimmon|انار|خرما|انجیر|میوه/, "🍎"],

  // Vegetables.
  [/tomato|گوجه/, "🍅"],
  [/cucumber|pickle|gherkin|خیار/, "🥒"],
  [/carrot|هویج/, "🥕"],
  [/\bcorn\b|sweetcorn|maize|ذرت/, "🌽"],
  [/broccoli|cauliflower|کلم ?بروکلی|گل ?کلم/, "🥦"],
  [/chil+i|jalape|chilli/, "🌶️"],
  [/bell pepper|capsicum|\bpeppers?\b|فلفل/, "🫑"],
  [/onion|shallot|پیاز/, "🧅"],
  [/garlic|(^|\s)سیر($|\s)/, "🧄"],
  [/mushroom|قارچ/, "🍄"],
  [/lettuce|spinach|kale|greens|herbs?\b|sabzi|cabbage|arugula|rocket|اسفناج|کاهو|سبزی|کلم/, "🥬"],
  [/vegetables?|veggies|vegetable mix|zucchini|courgette|squash|کدو|سبزیجات/, "🥦"],
  // Last: what is usually only added to something else ("tea with sugar" is tea).
  [/\bsugar\b|syrup|قند|شکر/, "🍬"],
  [/\bsalt\b|نمک/, "🧂"],
];

/** The part of a food name before its first detail: "Rice, white, cooked" -> "Rice". */
export const shortFoodName = (name: string) => {
  const main = name.split(/[(,;]/)[0]!.replace(/\s+/g, " ").trim();
  return main || name.trim();
};

const matchRules = (text: string) => {
  const lower = text.toLowerCase();
  for (const [pattern, emoji] of RULES) if (pattern.test(lower)) return emoji;
  return null;
};

const nameEmoji = (name: string | null | undefined) => {
  const full = (name ?? "").trim();
  return full ? (matchRules(shortFoodName(full)) ?? matchRules(full)) : null;
};

/**
 * The emoji for a food: keywords of the main name first ("Lubia polo (green bean rice with
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
