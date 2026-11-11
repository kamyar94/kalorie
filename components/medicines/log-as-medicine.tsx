"use client";

import { Loader2, Pill } from "lucide-react";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import { useCapture } from "@/components/capture/capture-provider";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { api } from "@/lib/client/api";
import type { MealSummaryDto } from "@/lib/contracts/meals";
import { formatDose, medicineTitle, type LoggedMedicine } from "@/lib/contracts/medicines";
import { localParts } from "@/lib/meals/time";
import { deviceTimeZone } from "@/lib/photos/client";
import { useOnline } from "@/lib/ui/hooks";

import { MedicineSheet } from "./medicine-sheet";
import { useLabelReading } from "./use-label-reading";

type Meal = Pick<MealSummaryDto, "id" | "eatenAt" | "tz" | "photos" | "note" | "source">;

const chipClass =
  "text-label bg-primary-soft text-on-primary-soft inline-flex min-h-11 items-center gap-1.5 rounded-full px-3.5 aria-busy:cursor-progress";

/** Today's Medicines card: scrolls to a log and moves focus to it. */
export const showMedicineLog = (logId: string) => {
  const row = document.getElementById(`medicine-log-${logId}`);
  if (!row) return;
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  row.scrollIntoView({ block: "center", behavior: reduce ? "auto" : "smooth" });
  row.focus({ preventScroll: true });
};

/**
 * One go at "Log as a medicine": reads the label from the meal's photos (as the camera's Medicine
 * mode does with its photo), then the medicine sheet of board 7, taken at the meal's time. Without
 * a photo, a connection or an AI key the sheet opens empty for typing. Mounted with a key per go.
 */
const MealMedicine = ({
  meal,
  online,
  onReading,
  onSaved,
  onClose,
}: {
  meal: Meal;
  online: boolean;
  onReading: (reading: { skip: () => void } | null) => void;
  onSaved: (logged: LoggedMedicine) => void;
  onClose: () => void;
}) => {
  const typed = meal.source === "text" && !meal.photos.length;
  const phase = useLabelReading(
    online && meal.photos.length ? () => api.mealMedicineScan(meal.id) : null,
    !online
      ? "You are offline, so Kal cannot read the label now. Type the name, and save once you are back online."
      : typed && meal.note
        ? `You wrote: “${meal.note}”. Type the name of the medicine.`
        : "This meal has no photo to read. Type the name of the medicine.",
  );
  const [skipped, setSkipped] = useState(false);
  const reading = phase.step === "reading" && !skipped;

  // The button shows the reading; "Type it instead" skips the wait.
  useEffect(() => {
    onReading(reading ? { skip: () => setSkipped(true) } : null);
  }, [reading, onReading]);
  if (reading) return null;

  // Typed instead of waiting: a reading that arrives later does not fill the fields, but the label
  // photo still goes with the log.
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
      onOpenChange={(open) => !open && onClose()}
      reading={sheet.reading}
      scanId={sheet.scanId}
      notice={sheet.notice}
      takenAt={new Date(meal.eatenAt)}
      timeZone={meal.tz}
      submit={(input) => api.logMealAsMedicine(meal.id, input)}
      onSaved={onSaved}
    />
  );
};

/**
 * "Log as a medicine" for a meal that failed because it shows a medicine or a supplement (the meal
 * page's error box: a primary button; Today's card: a chip next to Try again). Saving logs the
 * medicine, removes the meal and opens that day's Today, with a toast that shows the medicine in
 * the Medicines card.
 */
export const LogAsMedicine = ({ meal, variant }: { meal: Meal; variant: "button" | "chip" }) => {
  const router = useRouter();
  const pathname = usePathname();
  const { show } = useToast();
  const { forgetMeal } = useCapture();
  const online = useOnline();
  const button = useRef<HTMLButtonElement>(null);
  const [go, setGo] = useState<number | null>(null);
  const [reading, setReading] = useState<{ skip: () => void } | null>(null);

  const start = () => {
    if (go === null) setGo(Date.now());
  };
  const close = () => {
    setGo(null);
    setReading(null);
  };

  const saved = ({ log }: LoggedMedicine) => {
    close();
    // Uploaded in this page view: the timeline must not show it from the device's copy.
    forgetMeal(meal.id);
    show({
      title: `${medicineTitle(log)} logged as a medicine`,
      body: `${formatDose(log.amount, log.unit)} at ${log.localTime}. The meal is removed.`,
      tone: "success",
      duration: 8000,
      action: { label: "Show it", onClick: () => showMedicineLog(log.id) },
    });
    // The meal is gone: its day on Today, where the Medicines card has the log.
    const today = localParts(new Date(), deviceTimeZone()).date;
    const target = log.localDate === today ? "/today" : `/today?date=${log.localDate}`;
    if (`${pathname}${window.location.search}` === target) router.refresh();
    else router.replace(target);
  };

  const label = reading ? "Reading the label…" : "Log as a medicine";
  const icon = reading ? (
    <Loader2 aria-hidden className="size-4 animate-spin motion-reduce:animate-none" />
  ) : (
    <Pill aria-hidden className="size-4" />
  );
  return (
    <>
      {variant === "button" ? (
        <Button ref={button} aria-busy={reading ? true : undefined} onClick={start}>
          {icon} {label}
        </Button>
      ) : (
        <button
          ref={button}
          type="button"
          className={chipClass}
          aria-busy={reading ? true : undefined}
          onClick={start}
        >
          {icon} {label}
        </button>
      )}
      {reading && (
        <>
          <span role="status" className="sr-only">
            Reading the label from the meal&apos;s photos.
          </span>
          {variant === "button" ? (
            <Button variant="secondary" onClick={reading.skip}>
              Type it instead
            </Button>
          ) : (
            <button
              type="button"
              className="text-label bg-surface-2 hover:bg-surface-3 inline-flex min-h-11 items-center rounded-full px-3.5"
              onClick={reading.skip}
            >
              Type it instead
            </button>
          )}
        </>
      )}
      {go !== null && (
        <MealMedicine
          key={go}
          meal={meal}
          online={online}
          onReading={setReading}
          onSaved={saved}
          onClose={() => {
            close();
            button.current?.focus();
          }}
        />
      )}
    </>
  );
};
