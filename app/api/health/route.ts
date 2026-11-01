import { sql } from "drizzle-orm";

import { db } from "@/db";

export const dynamic = "force-dynamic";

// For the container health check: the app answers and reaches the database.
export const GET = async () => {
  try {
    await db.execute(sql`select 1`);
    return Response.json({ ok: true }, { headers: { "cache-control": "no-store" } });
  } catch {
    return Response.json({ ok: false }, { status: 503, headers: { "cache-control": "no-store" } });
  }
};
