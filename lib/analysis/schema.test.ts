// The schemas must pass the strictest of the three providers: closed objects, every property
// required, no null types or unions, no length, range, format or pattern keywords.
import { describe, expect, it } from "vitest";

import { ANALYSIS_SCHEMA, MATCHING_SCHEMA } from "./schema";

const FORBIDDEN = [
  "minimum",
  "maximum",
  "exclusiveMinimum",
  "exclusiveMaximum",
  "minLength",
  "maxLength",
  "minItems",
  "maxItems",
  "pattern",
  "format",
  "nullable",
  "anyOf",
  "oneOf",
  "allOf",
  "$ref",
  "default",
];

const problems = (node: unknown, at = "$"): string[] => {
  if (typeof node !== "object" || node === null) return [];
  const schema = node as Record<string, unknown>;
  const found: string[] = [];
  for (const key of FORBIDDEN) if (key in schema) found.push(`${at}: ${key}`);
  if (Array.isArray(schema.type)) found.push(`${at}: type list`);
  if (schema.type === "object") {
    const properties = (schema.properties ?? {}) as Record<string, unknown>;
    if (schema.additionalProperties !== false) found.push(`${at}: open object`);
    const required = (schema.required ?? []) as string[];
    if ([...required].sort().join() !== Object.keys(properties).sort().join())
      found.push(`${at}: not all required`);
    for (const [name, child] of Object.entries(properties))
      found.push(...problems(child, `${at}.${name}`));
  }
  if (schema.type === "array") {
    if (!schema.items) found.push(`${at}: array without items`);
    found.push(...problems(schema.items, `${at}[]`));
  }
  return found;
};

describe("analysis schemas", () => {
  it("follow the strict rules every provider accepts", () => {
    expect(problems(ANALYSIS_SCHEMA)).toEqual([]);
    expect(problems(MATCHING_SCHEMA)).toEqual([]);
  });

  it("carry every field of the design's model output", () => {
    const top = ANALYSIS_SCHEMA.properties as Record<string, { items?: { properties?: object } }>;
    expect(Object.keys(top)).toEqual(
      expect.arrayContaining([
        "is_food",
        "title",
        "meal_type",
        "cuisine",
        "overall_confidence",
        "questions",
        "items",
      ]),
    );
    expect(Object.keys(top.items!.items!.properties!)).toEqual(
      expect.arrayContaining([
        "name",
        "local_name",
        "kind",
        "emoji",
        "preparation",
        "grams",
        "ml",
        "grams_low",
        "grams_high",
        "portion_text",
        "confidence",
        "photo_indexes",
        "search_terms",
        "matches_usual",
        "matches_planned",
        "components",
        "label",
        "estimate",
      ]),
    );
  });

  it("stays small enough to send with every photo", () => {
    expect(JSON.stringify(ANALYSIS_SCHEMA).length).toBeLessThan(6000);
  });
});
