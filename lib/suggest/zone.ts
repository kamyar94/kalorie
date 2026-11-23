// The time zone of a "What should I eat?" request: the one the device sent, else the device's
// cookie (components/app/device-time-zone.tsx), else the profile's.
import type { NextRequest } from "next/server";

import { isValidTimeZone } from "@/lib/meals/time";
import { TZ_COOKIE } from "@/lib/ui/viewer-time";

export const requestZone = (req: NextRequest, asked: unknown, profileZone: string) => {
  if (isValidTimeZone(asked)) return asked;
  const device = req.cookies.get(TZ_COOKIE)?.value;
  return device && isValidTimeZone(device) ? device : profileZone;
};
