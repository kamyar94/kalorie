// POST /api/imports/measurements { records: ImportedMeasurement[] } -> { added, updated, skipped }
// Weight and body composition the browser read from a scale or Samsung Health export (lib/imports).
// A value seen before (same app and external id) is updated, not added again.
import type { NextRequest } from "next/server";

import { parseImportedMeasurement } from "@/lib/body/parse";
import { importMeasurements } from "@/lib/body/service";
import type { ImportedMeasurement } from "@/lib/contracts/body";
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
    .map((raw) => parseImportedMeasurement(raw))
    .filter((r): r is ImportedMeasurement => r !== null);
  const result = await importMeasurements(user.id, records);
  return json(
    { ...result, skipped: batch.records.length - records.length },
    { headers: { "cache-control": "no-store" } },
  );
};
