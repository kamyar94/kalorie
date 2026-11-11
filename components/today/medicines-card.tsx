"use client";

import { Check } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { Card } from "@/components/ui/card";
import { useToast } from "@/components/ui/toast";
import { api } from "@/lib/client/api";
import {
  formatDose,
  medicineTitle,
  type MedicineDayDto,
  type MedicineDto,
} from "@/lib/contracts/medicines";
import { deviceTimeZone } from "@/lib/photos/client";
import { oneTapTime } from "@/lib/ui/log-time";

/**
 * Today's Medicines card (board 9): what was taken that day, with the time, and the person's
 * medicines not logged that day yet with "Log now" (one tap, the usual amount, Undo; at 12:00 on
 * an earlier day). Nothing shows without medicines and logs.
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
  if (!day.logs.length && !day.due.length) return null;

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
      show({
        title: `${medicineTitle(log)} logged`,
        body: `${formatDose(log.amount, log.unit)} at ${log.localTime}`,
        tone: "success",
        action: {
          label: "Undo",
          onClick: () =>
            void api
              .deleteMedicineLog(log.id)
              .then(() => router.refresh())
              .catch((error) =>
                show({ title: "Not undone", body: (error as Error).message, tone: "error" }),
              ),
        },
      });
    } catch (error) {
      show({ title: "Not logged", body: (error as Error).message, tone: "error" });
    } finally {
      setBusy(null);
    }
  };

  const action = date === today ? "Log now" : "Log at 12:00";
  return (
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
          // "Show it" in the toast of "Log as a medicine" scrolls here and focuses the row.
          <li
            key={log.id}
            id={`medicine-log-${log.id}`}
            tabIndex={-1}
            className="flex min-h-10 items-center gap-2.5 rounded-lg outline-offset-4 focus:outline-2 focus:outline-[var(--focus)]"
            data-testid="medicine-taken"
          >
            <span className="min-w-0 flex-1 text-[0.9375rem] wrap-break-word" dir="auto">
              {medicineTitle(log)} · {formatDose(log.amount, log.unit)}
            </span>
            <span className="text-caption text-primary inline-flex shrink-0 items-center gap-1 font-semibold">
              <Check aria-hidden className="size-4" strokeWidth={2.5} />
              Taken <span className="tabular">{log.localTime}</span>
            </span>
          </li>
        ))}
        {day.due.map((medicine) => (
          <li key={medicine.id} className="flex items-center gap-2.5" data-testid="medicine-due">
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
  );
};
