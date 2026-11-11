"use client";

import { useEffect, useState } from "react";

import { api } from "@/lib/client/api";
import type { MedicineReading, MedicineScanDto } from "@/lib/contracts/medicines";

/** How long a label is waited for before the fields are offered for typing. */
export const READ_TIMEOUT_MS = 45_000;
const POLL_MS = 1000;

const wait = (ms: number) => new Promise<void>((resolve) => window.setTimeout(resolve, ms));

export type LabelPhase =
  | { step: "reading" }
  | {
      step: "sheet";
      /** What the label says; null opens the fields empty for typing. */
      reading: MedicineReading | null;
      /** The label photo, kept with the log. */
      scanId: string | null;
      /** Why there is no reading (no AI key, not a medicine, a failure, offline...). */
      notice: string | null;
    };

/**
 * Reads a medicine label: `start` stores the photo and queues the reading (the camera's photo, or
 * a meal's photos for "Log as a medicine"); then the scan is asked about every second until it is
 * read, failed, or READ_TIMEOUT_MS have passed. Without `start` (offline, no photo) the sheet is
 * there at once with `notice`. Whether to read is decided once, on mount: mount it with a key.
 */
export const useLabelReading = (
  start: (() => Promise<MedicineScanDto>) | null,
  notice: string | null,
): LabelPhase => {
  const [read] = useState(() => start);
  const [phase, setPhase] = useState<LabelPhase>(() =>
    read ? { step: "reading" } : { step: "sheet", reading: null, scanId: null, notice },
  );

  useEffect(() => {
    if (!read) return;
    const controller = new AbortController();
    let cancelled = false;
    const done = (scan: MedicineScanDto | null, reason: string | null) => {
      if (cancelled) return;
      setPhase({
        step: "sheet",
        reading: scan?.status === "done" ? scan.reading : null,
        scanId: scan?.id ?? null,
        notice: scan?.status === "done" ? null : reason,
      });
    };
    const run = async () => {
      try {
        let scan = await read();
        const started = Date.now();
        while (scan.status === "queued" || scan.status === "reading") {
          if (cancelled) return;
          if (Date.now() - started > READ_TIMEOUT_MS)
            return done(scan, "Kal could not read the label in time. Type the name instead.");
          await wait(POLL_MS);
          scan = await api.medicineScan(scan.id, controller.signal);
        }
        done(scan, scan.error?.message ?? "Kal could not read the label. Type the name instead.");
      } catch (error) {
        if ((error as Error)?.name === "AbortError") return;
        const message = (error as Error).message;
        done(
          null,
          /Type the (name|medicine) instead\.$/.test(message)
            ? message
            : `${message} Type the name instead.`,
        );
      }
    };
    void run();
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [read]);

  return phase;
};
