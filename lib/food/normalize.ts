// Text normalisation for food names in English and Persian, used for foods.search_text, the
// search query and food_memory keys. Keep it deterministic: stored rows depend on it.

const ARABIC_TO_PERSIAN: Record<string, string> = {
  "\u064A": "\u06CC", // Arabic yeh -> Persian yeh
  "\u0649": "\u06CC", // alef maksura -> Persian yeh
  "\u0643": "\u06A9", // Arabic kaf -> Persian keheh
  "\u0629": "\u0647", // teh marbuta -> heh
};

/** Lowercase, Persian letter forms unified, diacritics and joiners removed, spaces collapsed. */
export const normalizeFoodText = (value: string) =>
  value
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[\u064A\u0649\u0643\u0629]/g, (char) => ARABIC_TO_PERSIAN[char] ?? char)
    .replace(/[\u064B-\u065F\u0670]/g, "") // Arabic diacritics
    .replace(/[\u200C\u200D\u200E\u200F]/g, " ") // zero-width joiners and marks
    .replace(/[^\p{L}\p{N}%]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();

/**
 * Persian compound words are written with a zero-width non-joiner ("ته‌دیگ"), with a space or
 * joined ("تهدیگ"). normalizeFoodText turns the joiner into a space; this adds the joined form
 * too, so a search for either spelling finds the name.
 */
const withJoinedForms = (text: string) =>
  /[‌‍]/.test(text) ? `${text} ${text.replace(/[‌‍]/g, "")}` : text;

/** The text stored in foods.search_text for a food's names. */
export const foodSearchText = (names: {
  nameEn: string;
  nameFa?: string | null;
  synonyms?: string[];
  brand?: string | null;
}) =>
  normalizeFoodText(
    [names.nameEn, names.nameFa ?? "", ...(names.synonyms ?? []), names.brand ?? ""]
      .map(withJoinedForms)
      .join(" "),
  );
