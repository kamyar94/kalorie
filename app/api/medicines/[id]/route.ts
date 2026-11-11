// PATCH /api/medicines/:id { name?, strength?, form?, usualAmount?, unit?, notes?, archived? }
//   -> MedicineDto; another person's medicine answers 404.
import type { NextRequest } from "next/server";

import { readJsonObject } from "@/lib/http/body";
import { apiUser, errorJson, json } from "@/lib/http/route";
import { parseMedicinePatch } from "@/lib/medicines/parse";
import { updateMedicine } from "@/lib/medicines/service";

export const dynamic = "force-dynamic";

export const PATCH = async (req: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
  const { user, error } = await apiUser(req);
  if (error) return error;
  const body = await readJsonObject(req, 8192);
  if (!body) return errorJson(400, "Send the changes as JSON.");
  const medicine = await updateMedicine(user.id, (await params).id, parseMedicinePatch(body));
  if (!medicine) return errorJson(404, "Not found.");
  return json(medicine);
};
