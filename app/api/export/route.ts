// GET /api/export?format=json|csv -> a download of everything Kal keeps about the person
// (lib/account/data.ts): JSON with meals, items, personal foods, targets and preferences, or CSV
// with one row per item.
import type { NextRequest } from "next/server";

import { exportUserData, mealsToCsv } from "@/lib/account/data";
import { audit } from "@/lib/audit";
import { apiUser, errorJson } from "@/lib/http/route";

export const dynamic = "force-dynamic";

export const GET = async (req: NextRequest) => {
  const { user, error } = await apiUser(req);
  if (error) return error;
  const format = req.nextUrl.searchParams.get("format") === "csv" ? "csv" : "json";
  const data = await exportUserData(user.id);
  if (!data) return errorJson(404, "Not found.");
  await audit({ userId: user.id, action: "data.export", details: { format } });
  const day = new Date().toISOString().slice(0, 10);
  const body = format === "csv" ? mealsToCsv(data) : JSON.stringify(data, null, 2);
  return new Response(body, {
    headers: {
      "content-type": format === "csv" ? "text/csv; charset=utf-8" : "application/json",
      "content-disposition": `attachment; filename="cal-export-${day}.${format}"`,
      "cache-control": "no-store",
    },
  });
};
