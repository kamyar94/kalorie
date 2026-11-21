// GET /api/move/days?month=YYYY-MM -> EveryDayMonthDto
// A month of Move's "Every day" (board 40) for "Earlier days": the signed-in person's days with
// the phone's steps, active time and activity calories (lib/move/service.ts getEveryDayMonth).
// "Today" is counted in the device's time zone (the cal_tz cookie), else the profile's.
import type { NextRequest } from "next/server";

import { apiUser, errorJson, json } from "@/lib/http/route";
import { isValidTimeZone, localParts } from "@/lib/meals/time";
import { getEveryDayMonth } from "@/lib/move/service";
import { TZ_COOKIE } from "@/lib/ui/viewer-time";

export const dynamic = "force-dynamic";

const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;

export const GET = async (req: NextRequest) => {
  const { user, error } = await apiUser(req);
  if (error) return error;
  const month = req.nextUrl.searchParams.get("month") ?? "";
  if (!MONTH.test(month)) return errorJson(400, "Give the month as YYYY-MM.");
  const device = req.cookies.get(TZ_COOKIE)?.value;
  const zone = device && isValidTimeZone(device) ? device : user.timeZone;
  const today = localParts(new Date(), zone).date;
  return json(await getEveryDayMonth(user.id, month, today), {
    headers: { "cache-control": "no-store" },
  });
};
