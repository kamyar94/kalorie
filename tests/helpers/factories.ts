// Rows for tests, written straight into the test database.
import crypto from "node:crypto";

import { db } from "@/db";
import { foods, mealItems, meals, users } from "@/db/schema";
import type { NutrientMap } from "@/lib/contracts/nutrients";

let counter = 0;
const unique = () => `${Date.now().toString(36)}${(counter++).toString(36)}`;

/** A user with a known password hash format (not a usable password). */
export const createUser = async (overrides: Partial<typeof users.$inferInsert> = {}) => {
  const [user] = await db
    .insert(users)
    .values({
      username: `user_${unique()}`,
      displayName: "Test Person",
      passwordHash: "scrypt$1$1$1$x$x",
      ...overrides,
    })
    .returning();
  return user!;
};

export const createFood = async (
  overrides: Partial<typeof foods.$inferInsert> & { nameEn: string; nutrients?: NutrientMap },
) => {
  const [food] = await db
    .insert(foods)
    .values({
      source: "user",
      searchText: overrides.nameEn.toLowerCase(),
      ...overrides,
    })
    .returning();
  return food!;
};

export const createMeal = async (
  userId: string,
  overrides: Partial<typeof meals.$inferInsert> = {},
) => {
  const [meal] = await db
    .insert(meals)
    .values({
      userId,
      eatenAt: new Date("2026-10-31T12:30:00Z"),
      tz: "UTC",
      localDate: "2026-10-31",
      slot: "lunch",
      status: "ready",
      ...overrides,
    })
    .returning();
  return meal!;
};

export const createItem = async (
  userId: string,
  mealId: string,
  overrides: Partial<typeof mealItems.$inferInsert> = {},
) => {
  const [item] = await db
    .insert(mealItems)
    .values({ userId, mealId, name: "Rice", grams: 200, ...overrides })
    .returning();
  return item!;
};

export const randomId = () => crypto.randomUUID();
