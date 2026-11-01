"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

const COOKIE = "cal_tz";

/**
 * Tells the server the device's time zone through a cookie, so "today" is the person's own day.
 * Refreshes the page once when it changed (first visit, travel).
 */
export const DeviceTimeZone = () => {
  const router = useRouter();
  useEffect(() => {
    let zone = "";
    try {
      zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    } catch {
      return;
    }
    if (!zone) return;
    const current = document.cookie
      .split("; ")
      .find((part) => part.startsWith(`${COOKIE}=`))
      ?.slice(COOKIE.length + 1);
    if (current && decodeURIComponent(current) === zone) return;
    document.cookie = `${COOKIE}=${encodeURIComponent(zone)}; path=/; max-age=31536000; samesite=lax${location.protocol === "https:" ? "; secure" : ""}`;
    router.refresh();
  }, [router]);
  return null;
};
