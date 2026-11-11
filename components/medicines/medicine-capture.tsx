"use client";

import { Loader2 } from "lucide-react";
import { useEffect, useState } from "react";

import { api } from "@/lib/client/api";
import type { LoggedMedicine, MedicineReading, MedicineScanDto } from "@/lib/contracts/medicines";

import { MedicineSheet } from "./medicine-sheet";

/** How long the camera waits for the label to be read before it offers the fields to type. */
export const READ_TIMEOUT_MS = 45_000;
const POLL_MS = 1000;

const wait = (ms: number) => new Promise<void>((resolve) => window.setTimeout(resolve, ms));

type Phase =
  | { step: "reading" }
  | {
      step: "sheet";
      reading: MedicineReading | null;
      scanId: string | null;
      notice: string | null;
    };

/**
 * Medicine mode after the shutter (or "Type"): the photo goes to Cal, which asks the person's AI
 * provider to read the label; meanwhile a progress line shows over the photo. Then the medicine
 * sheet, filled in from the label, or empty for typing when there is no reading (no AI key, not a
 * medicine, a failure, offline, or no photo at all). Mount it with a key per photo.
 */
export const MedicineCapture = ({
  photo,
  online,
  onSaved,
  onCancel,
}: {
  /** The label photo; null to type the medicine without one. */
  photo: Blob | null;
  online: boolean;
  onSaved: (logged: LoggedMedicine) => void;
  /** The sheet was closed without saving: back to the camera. */
  onCancel: () => void;
}) => {
  // Whether this photo is read at all is decided once, when it is taken.
  const [read] = useState(() => photo !== null && online);
  const [phase, setPhase] = useState<Phase>(() =>
    read
      ? { step: "reading" }
      : {
          step: "sheet",
          reading: null,
          scanId: null,
          notice: photo
            ? "You are offline, so Cal cannot read the label now. Type the name, and save once you are back online."
            : null,
        },
  );
  const [skipped, setSkipped] = useState(false);

  useEffect(() => {
    if (!photo || !read) return;
    const controller = new AbortController();
    let cancelled = false;
    const done = (scan: MedicineScanDto | null, notice: string | null) => {
      if (cancelled) return;
      setPhase({
        step: "sheet",
        reading: scan?.status === "done" ? scan.reading : null,
        scanId: scan?.id ?? null,
        notice: scan?.status === "done" ? null : notice,
      });
    };
    const run = async () => {
      try {
        let scan = await api.scanMedicine(photo);
        const started = Date.now();
        while (scan.status === "queued" || scan.status === "reading") {
          if (cancelled) return;
          if (Date.now() - started > READ_TIMEOUT_MS)
            return done(scan, "Cal could not read the label in time. Type the name instead.");
          await wait(POLL_MS);
          scan = await api.medicineScan(scan.id, controller.signal);
        }
        done(scan, scan.error?.message ?? "Cal could not read the label. Type the name instead.");
      } catch (error) {
        if ((error as Error)?.name === "AbortError") return;
        done(null, `${(error as Error).message} Type the name instead.`);
      }
    };
    void run();
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [photo, read]);

  if (phase.step === "reading" && !skipped)
    return (
      <div className="absolute inset-x-0 bottom-0 z-10 flex flex-col items-center gap-3 bg-black/72 px-6 pt-5 pb-[max(env(safe-area-inset-bottom),1.5rem)] text-center">
        <p role="status" className="text-body inline-flex items-center gap-2 text-white">
          <Loader2 aria-hidden className="size-5 animate-spin motion-reduce:animate-none" />
          Reading the label…
        </p>
        <p className="text-caption text-white/80">
          Your AI provider reads the name and strength. This takes a few seconds.
        </p>
        <button
          type="button"
          onClick={() => setSkipped(true)}
          className="text-label inline-flex min-h-11 items-center rounded-full bg-white/15 px-4 text-white"
        >
          Type it instead
        </button>
      </div>
    );

  // Typed instead of waiting: a reading that arrives later does not overwrite the fields, but
  // the photo still goes with the log.
  const sheet =
    phase.step === "sheet" && !skipped
      ? phase
      : {
          reading: null,
          scanId: phase.step === "sheet" ? phase.scanId : null,
          notice: null as string | null,
        };
  return (
    <MedicineSheet
      open
      elevated
      onOpenChange={(open) => !open && onCancel()}
      reading={sheet.reading}
      scanId={sheet.scanId}
      notice={sheet.notice}
      onSaved={onSaved}
    />
  );
};
