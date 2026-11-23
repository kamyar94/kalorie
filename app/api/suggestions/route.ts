// GET /api/suggestions?tz=Area/City -> SuggestionsDto: "What should I eat?" for now (board 42),
// from the signed-in person's own meals (lib/suggest/service.ts). "Now" and "today" are counted in
// the zone given, else the device's (the cal_tz cookie), else the profile's.
import type { NextRequest } from "next/server";

import { apiUser, errorJson, json } from "@/lib/http/route";
import { getSuggestions } from "@/lib/suggest/service";
import { requestZone } from "@/lib/suggest/zone";

export const dynamic = "force-dynamic";

export const GET = async (req: NextRequest) => {
  const { user, error } = await apiUser(req);
  if (error) return error;
  const tz = requestZone(req, req.nextUrl.searchParams.get("tz"), user.timeZone);
  const suggestions = await getSuggestions(user.id, { now: new Date(), tz });
  if (!suggestions) return errorJson(404, "Not found.");
  return json(suggestions, { headers: { "cache-control": "no-store" } });
};
