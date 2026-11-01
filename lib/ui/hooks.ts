"use client";

// Small hooks for browser state, read without effects so server and first client render agree.
import { useSyncExternalStore } from "react";

import { deviceTimeZone } from "@/lib/photos/client";

const noSubscribe = () => () => undefined;

/** False during the server render and hydration, true afterwards. */
export const useIsClient = () =>
  useSyncExternalStore(
    noSubscribe,
    () => true,
    () => false,
  );

const subscribeOnline = (change: () => void) => {
  window.addEventListener("online", change);
  window.addEventListener("offline", change);
  return () => {
    window.removeEventListener("online", change);
    window.removeEventListener("offline", change);
  };
};

/** Whether the browser thinks it is online (true on the server). */
export const useOnline = () =>
  useSyncExternalStore(
    subscribeOnline,
    () => navigator.onLine,
    () => true,
  );

/** The device's IANA time zone, or null during the server render. */
export const useDeviceTimeZone = () =>
  useSyncExternalStore(noSubscribe, deviceTimeZone, () => null);
