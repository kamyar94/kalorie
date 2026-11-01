"use client";

import { useCapture } from "@/components/capture/capture-provider";

import { ShutterButton } from "./shutter-button";

/** The big shutter on the Today screen: opens the in-app camera. */
export const TodayCapture = () => {
  const { openCamera } = useCapture();
  return <ShutterButton onClick={() => openCamera("meal")} />;
};
