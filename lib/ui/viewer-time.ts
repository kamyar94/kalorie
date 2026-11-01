import "server-only";

import { cookies } from "next/headers";

import { isValidTimeZone, localParts } from "@/lib/meals/time";

/** Cookie with the device's IANA time zone, set by components/app/device-time-zone.tsx. */
export const TZ_COOKIE = "cal_tz";

/** The time zone "today" is counted in: the device's when known, else the profile's. */
export const viewerTimeZone = async (profileTimeZone: string) => {
  const fromDevice = (await cookies()).get(TZ_COOKIE)?.value;
  return fromDevice && isValidTimeZone(fromDevice) ? fromDevice : profileTimeZone;
};

export const viewerToday = async (profileTimeZone: string) =>
  localParts(new Date(), await viewerTimeZone(profileTimeZone)).date;
