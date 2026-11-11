// GET /api/medicine-scans/:id -> MedicineScanDto: whether the label was read, and what it says.
// Another person's scan answers 404.
import type { NextRequest } from "next/server";

import { apiUser, errorJson, json } from "@/lib/http/route";
import { getMedicineScan } from "@/lib/medicines/scans";

export const dynamic = "force-dynamic";

export const GET = async (req: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
  const { user, error } = await apiUser(req);
  if (error) return error;
  const scan = await getMedicineScan(user.id, (await params).id);
  if (!scan) return errorJson(404, "Not found.");
  return json(scan, { headers: { "cache-control": "no-store" } });
};
