// POST /api/imports/activities { records: ImportedActivity[] } -> { added, updated, skipped }
// Steps and exercise sessions the browser read from an export file (lib/imports). A record seen
// before (same app and external id) is updated, not added again.
import type { NextRequest } from "next/server";

import { parseImportedActivity } from "@/lib/activities/parse";
import { importActivities } from "@/lib/activities/service";
import type { ImportedActivity } from "@/lib/contracts/activities";
import { readImportBatch, takeImport } from "@/lib/http/imports";
import { apiUser, json } from "@/lib/http/route";

export const dynamic = "force-dynamic";

export const POST = async (req: NextRequest) => {
  const { user, error } = await apiUser(req);
  if (error) return error;
  const batch = await readImportBatch(req);
  if (batch.error) return batch.error;
  const limited = await takeImport(user.id);
  if (limited) return limited;
  const records = batch.records
    .map((raw) => parseImportedActivity(raw))
    .filter((r): r is ImportedActivity => r !== null);
  const result = await importActivities(user.id, records);
  return json(
    { ...result, skipped: batch.records.length - records.length },
    { headers: { "cache-control": "no-store" } },
  );
};
