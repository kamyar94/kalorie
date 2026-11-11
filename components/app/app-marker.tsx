"use client";

import { useEffect } from "react";

import { rememberAppContext } from "@/lib/client/android-app";

/** Notes on every page whether it runs inside the Kal Android app (lib/client/android-app.ts). */
export const AppMarker = () => {
  useEffect(() => {
    rememberAppContext();
  }, []);
  return null;
};
