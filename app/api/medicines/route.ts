// GET  /api/medicines -> { medicines: MedicineDto[] }: the signed-in person's list (archived too)
// POST /api/medicines { name, strength?, form?, usualAmount?, unit?, notes? } -> 201 MedicineDto
import type { NextRequest } from "next/server";

import { readJsonObject } from "@/lib/http/body";
import { apiUser, errorJson, json } from "@/lib/http/route";
import { parseMedicinePatch } from "@/lib/medicines/parse";
import { createMedicine, listMedicines } from "@/lib/medicines/service";

export const dynamic = "force-dynamic";

export const GET = async (req: NextRequest) => {
  const { user, error } = await apiUser(req);
  if (error) return error;
  return json(
    { medicines: await listMedicines(user.id) },
    { headers: { "cache-control": "no-store" } },
  );
};

export const POST = async (req: NextRequest) => {
  const { user, error } = await apiUser(req);
  if (error) return error;
  const body = await readJsonObject(req, 8192);
  if (!body) return errorJson(400, "Send the medicine as JSON.");
  const { archived: _archived, ...input } = parseMedicinePatch(body);
  const medicine = input.name
    ? await createMedicine(user.id, { ...input, name: input.name })
    : null;
  if (!medicine) return errorJson(400, "Write the medicine's name.");
  return json(medicine, 201);
};
