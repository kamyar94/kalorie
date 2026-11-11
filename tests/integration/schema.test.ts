// The migrations build the whole schema: the first one every phase's tables, later ones the
// medicines (0004), the activities (0005) and Move's badges (0006).
import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { db } from "@/db";
import { createFood } from "@/tests/helpers/factories";

const TABLES = [
  "activities",
  "ai_keys",
  "ai_settings",
  "ai_usage",
  "audit_log",
  "dish_components",
  "dri_targets",
  "food_memory",
  "food_portions",
  "foods",
  "integrations",
  "invites",
  "jobs",
  "meal_items",
  "meal_photos",
  "meals",
  "medicine_logs",
  "medicine_scans",
  "medicines",
  "nutrients",
  "push_subscriptions",
  "rate_limits",
  "reset_codes",
  "sessions",
  "user_badges",
  "user_targets",
  "users",
];

describe("database schema", () => {
  it("has every table and the trigram extension", async () => {
    const tables = await db.execute<{ table_name: string }>(
      sql`select table_name from information_schema.tables where table_schema = 'public' order by 1`,
    );
    expect(tables.rows.map((r) => r.table_name)).toEqual(TABLES);
    const ext = await db.execute<{ extname: string }>(sql`select extname from pg_extension`);
    expect(ext.rows.map((r) => r.extname)).toContain("pg_trgm");
  });

  it("fills the full-text column and uses the trigram index operator", async () => {
    await createFood({ nameEn: "Ghormeh sabzi", searchText: "ghormeh sabzi قورمه سبزی" });
    const rows = await db.execute<{ v: string; s: number }>(
      sql`select search_vector::text as v, similarity(search_text, 'ghorme sabzi') as s from foods`,
    );
    expect(rows.rows[0]!.v).toContain("'ghormeh'");
    expect(Number(rows.rows[0]!.s)).toBeGreaterThan(0.4);
  });

  it("refuses usernames with capitals", async () => {
    await expect(
      db.execute(
        sql`insert into users (username, display_name, password_hash) values ('Ann', 'Ann', 'x')`,
      ),
    ).rejects.toThrow();
  });
});
