"use client";

import { Check, ChevronRight } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { loggedNowToast, MedicineLogSheet } from "@/components/medicines/medicine-log-sheet";
import { Card } from "@/components/ui/card";
import { useToast } from "@/components/ui/toast";
import { api } from "@/lib/client/api";
import {
  formatDose,
  medicineTitle,
  type MedicineDayDto,
  type MedicineDto,
  type MedicineLogDto,
} from "@/lib/contracts/medicines";
import { deviceTimeZone } from "@/lib/photos/client";
import { oneTapTime } from "@/lib/ui/log-time";

/** The row of a log on Today's card (the "Show it" of "Log as a medicine" focuses it too). */
const rowId = (logId: string) => `medicine-log-${logId}`;

/**
 * Today's Medicines card (board 9): what was taken that day, with the time, and the person's
 * medicines not logged that day yet with "Log now" (one tap, the usual amount, Undo; at 12:00 on
 * an earlier day). A logged medicine opens its sheet (board 28) to change the time or the amount,
 * or to remove it; the toast after "Log now" opens it too (Change time). Nothing shows without
 * medicines and logs.
 */
export const MedicinesCard = ({
  day,
  date,
  today,
}: {
  day: MedicineDayDto;
  date: string;
  today: string;
}) => {
  const router = useRouter();
  const { show } = useToast();
  const [busy, setBusy] = useState<string | null>(null);
  const [editing, setEditing] = useState<MedicineLogDto | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);

  const edit = (log: MedicineLogDto) => {
    setEditing(log);
    setSheetOpen(true);
  };

  const logNow = async (medicine: MedicineDto) => {
    const tz = deviceTimeZone();
    setBusy(medicine.id);
    try {
      const { log } = await api.logMedicine({
        medicineId: medicine.id,
        takenAt: oneTapTime(date, today, tz),
        tz,
      });
      router.refresh();
      show(
        loggedNowToast(log, {
          changeTime: () => edit(log),
          undo: () =>
            void api
              .deleteMedicineLog(log.id)
              .then(() => router.refresh())
              .catch((error) =>
                show({ title: "Not undone", body: (error as Error).message, tone: "error" }),
              ),
        }),
      );
    } catch (error) {
      show({ title: "Not logged", body: (error as Error).message, tone: "error" });
    } finally {
      setBusy(null);
    }
  };

  const action = date === today ? "Log now" : "Log at 12:00";
  // Nothing shows without medicines and logs; the sheet stays to close when the last log goes.
  const shown = day.logs.length > 0 || day.due.length > 0;
  return (
    <>
      {shown && (
        <Card
          as="section"
          aria-labelledby="medicines-heading"
          className="flex flex-col gap-2.5"
          data-testid="medicines-card"
        >
          <h2 id="medicines-heading" className="text-body font-semibold">
            Medicines
          </h2>
          <ul className="flex flex-col gap-2">
            {day.logs.map((log) => (
              <li key={log.id}>
                {/* "Show it" in the toast of "Log as a medicine" scrolls here and focuses the row. */}
                <button
                  type="button"
                  id={rowId(log.id)}
                  aria-haspopup="dialog"
                  onClick={() => edit(log)}
                  className="border-border hover:bg-surface-2 flex min-h-12 w-full items-center gap-2.5 rounded-[0.875rem] border py-2 pr-2 pl-3 text-left outline-offset-2 focus:outline-2 focus:outline-[var(--focus)]"
                  data-testid="medicine-taken"
                >
                  <span
                    className="min-w-0 flex-1 text-[0.9375rem] font-semibold wrap-break-word"
                    dir="auto"
                  >
                    {medicineTitle(log)} · {formatDose(log.amount, log.unit)}
                  </span>
                  <span className="text-caption text-primary inline-flex shrink-0 items-center gap-1 font-semibold">
                    <Check aria-hidden className="size-4" strokeWidth={2.5} />
                    Taken <span className="tabular">{log.localTime}</span>
                  </span>
                  <ChevronRight aria-hidden className="text-muted size-4.5 shrink-0" />
                </button>
              </li>
            ))}
            {day.due.map((medicine) => (
              <li
                key={medicine.id}
                className="border-border flex min-h-12 items-center gap-2.5 rounded-[0.875rem] border py-1 pr-1 pl-3"
                data-testid="medicine-due"
              >
                <span className="min-w-0 flex-1 text-[0.9375rem] wrap-break-word" dir="auto">
                  {medicineTitle(medicine)} · {formatDose(medicine.usualAmount, medicine.unit)}
                </span>
                <button
                  type="button"
                  aria-label={`${action}: ${medicineTitle(medicine)}`}
                  aria-busy={busy === medicine.id || undefined}
                  disabled={busy !== null}
                  onClick={() => void logNow(medicine)}
                  className="text-label bg-primary-soft text-on-primary-soft min-h-11 shrink-0 rounded-full px-3.5 disabled:opacity-60"
                >
                  {action}
                </button>
              </li>
            ))}
          </ul>
        </Card>
      )}
      <MedicineLogSheet
        log={editing}
        open={sheetOpen}
        onOpenChange={setSheetOpen}
        onCloseAutoFocus={(event) => {
          // Opened from a toast that is gone now: back to the log's row when it is still here.
          const row = editing && document.getElementById(rowId(editing.id));
          if (!row) return;
          event.preventDefault();
          row.focus();
        }}
      />
    </>
  );
};
