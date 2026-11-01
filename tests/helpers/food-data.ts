// Loads the FoodData Central fixture extracts (tests/fixtures/fdc) and the seeded dishes into the
// test database, through the same commands the server tool runs.
import path from "node:path";

import { getPool } from "@/db";
import { run as importFdc } from "@/scripts/fdc-import.mjs";
import { run as seedDishes } from "@/scripts/seed-dishes.mjs";

export const FDC_FIXTURES = path.resolve(import.meta.dirname, "../fixtures/fdc");

export const fixtureArgs = (extra: string[] = []) => [
  "--dir",
  `foundation=${path.join(FDC_FIXTURES, "foundation")}`,
  "--dir",
  `sr_legacy=${path.join(FDC_FIXTURES, "sr_legacy")}`,
  "--dir",
  `fndds=${path.join(FDC_FIXTURES, "fndds")}`,
  ...extra,
];

/** Imports the three fixture extracts; returns the command's result and its output lines. */
export const importFdcFixtures = async (extra: string[] = []) => {
  const lines: string[] = [];
  const result = await importFdc(getPool(), fixtureArgs(extra), (line: string) => lines.push(line));
  return { result, lines };
};

/** Seeds the Persian dishes (needs the SR Legacy fixture). */
export const seedDishFixtures = async () => {
  const lines: string[] = [];
  const result = await seedDishes(getPool(), [], (line: string) => lines.push(line));
  return { result, lines };
};
