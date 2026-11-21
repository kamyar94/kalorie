"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { readAppContext } from "@/lib/client/android-app";
import { statusIntentUrl } from "@/lib/contracts/devices";

/**
 * Board 39: the phone last sent more than two hours ago, so Samsung Health may already show more
 * than Move. Inside the Kal app the link opens the app's Health Connect screen (Send now is there);
 * in a browser it leads to Kal for Android's set-up steps.
 */
export const StaleNote = ({
  sent,
  today,
  appId,
}: {
  /** When the phone last sent: "10:56", "yesterday 21:05". */
  sent: string;
  /** The shown day is today. */
  today: boolean;
  /** The app's package, for the intent that opens its screen; null when not set up. */
  appId: string | null;
}) => {
  const [inApp, setInApp] = useState(false);
  useEffect(() => {
    const context = readAppContext();
    const timer = window.setTimeout(() => setInApp(context.inApp && context.healthConnect));
    return () => window.clearTimeout(timer);
  }, []);
  const at = /^\d/.test(sent) ? `at ${sent}` : sent;
  const intent =
    inApp && appId ? statusIntentUrl(appId, `${window.location.origin}/more/android`) : null;
  return (
    <div
      role="note"
      aria-labelledby="stale-note-title"
      className="bg-info-soft border-on-info-soft/40 text-on-info-soft rounded-2xl border px-3.5 py-3 text-sm leading-[1.45]"
      data-testid="move-stale-note"
    >
      <b id="stale-note-title">
        {today ? "Not today's latest yet." : "Not this day's latest yet."}
      </b>{" "}
      The phone last sent {at}.{" "}
      {intent
        ? "Tap Send now on Kal's Health Connect screen, or allow background updates so it sends every hour."
        : "Open Kal on the phone and tap Send now, or allow background updates so it sends every hour."}{" "}
      {intent ? (
        <a href={intent} className="font-semibold underline underline-offset-2">
          Open Kal&apos;s Health Connect screen
        </a>
      ) : (
        <Link href="/more/android" className="font-semibold underline underline-offset-2">
          How to set it up
        </Link>
      )}
    </div>
  );
};
