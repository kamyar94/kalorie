"use client";

import { Camera, Pencil, Pill, Plus, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { useCapture } from "@/components/capture/capture-provider";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { useToast } from "@/components/ui/toast";
import { api } from "@/lib/client/api";
import {
  formatDose,
  MEDICINE_DISCLAIMER,
  MEDICINE_FORM_LABELS,
  medicineTitle,
  type MedicineDto,
  type MedicineHistoryDay,
  type MedicineLogDto,
} from "@/lib/contracts/medicines";
import { deviceTimeZone } from "@/lib/photos/client";
import { dayTitle } from "@/lib/ui/format";

import { MedicineEditSheet } from "./medicine-edit-sheet";

const ingredientsLine = (medicine: MedicineDto) =>
  medicine.ingredients.map((i) => (i.strength ? `${i.name} ${i.strength}` : i.name)).join(", ");

/**
 * The Medicines page: the person's list (log one now, edit, archive), a label photo or a new
 * medicine by hand, and what was taken, by day.
 */
export const MedicinesView = ({
  medicines: initialMedicines,
  history,
  today,
}: {
  medicines: MedicineDto[];
  history: MedicineHistoryDay[];
  today: string;
}) => {
  const router = useRouter();
  const { show } = useToast();
  const { openCamera } = useCapture();
  const [medicines, setMedicines] = useState(initialMedicines);
  const [editing, setEditing] = useState<{ medicine: MedicineDto | null } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const [shown, setShown] = useState(initialMedicines);
  if (initialMedicines !== shown) {
    setShown(initialMedicines);
    setMedicines(initialMedicines);
  }

  const fail = (title: string, error: unknown) =>
    show({ title, body: error instanceof Error ? error.message : undefined, tone: "error" });

  const undoLog = (log: MedicineLogDto) => ({
    label: "Undo",
    onClick: () =>
      void api
        .deleteMedicineLog(log.id)
        .then(() => router.refresh())
        .catch((error) => fail("Not undone", error)),
  });

  const logNow = async (medicine: MedicineDto) => {
    setBusy(`log:${medicine.id}`);
    try {
      const { log } = await api.logMedicine({
        medicineId: medicine.id,
        takenAt: new Date().toISOString(),
        tz: deviceTimeZone(),
      });
      show({
        title: `${medicineTitle(log)} logged`,
        body: `${formatDose(log.amount, log.unit)} at ${log.localTime}`,
        tone: "success",
        action: undoLog(log),
      });
      router.refresh();
    } catch (error) {
      fail("Not logged", error);
    } finally {
      setBusy(null);
    }
  };

  const removeLog = async (log: MedicineLogDto) => {
    setBusy(`remove:${log.id}`);
    try {
      await api.deleteMedicineLog(log.id);
      router.refresh();
      show({
        title: `${medicineTitle(log)} at ${log.localTime} removed`,
        action: {
          label: "Undo",
          onClick: () =>
            void api
              .logMedicine({
                ...(log.medicineId ? { medicineId: log.medicineId } : {}),
                name: log.name,
                strength: log.strength,
                form: log.form,
                amount: log.amount,
                unit: log.unit,
                takenAt: log.takenAt,
                tz: log.tz,
              })
              .then(() => router.refresh())
              .catch((error) => fail("Not undone", error)),
        },
      });
    } catch (error) {
      fail("Not removed", error);
    } finally {
      setBusy(null);
    }
  };

  const inUse = medicines.filter((m) => !m.archived);
  const archived = medicines.filter((m) => m.archived);

  const row = (medicine: MedicineDto) => (
    <li
      key={medicine.id}
      className="border-border flex flex-col gap-2 border-t py-3 first:border-t-0"
      data-testid="medicine-row"
    >
      <div className="flex items-start gap-3">
        <span
          aria-hidden
          className="bg-primary-soft text-on-primary-soft grid size-11 shrink-0 place-items-center rounded-xl"
        >
          <Pill className="size-5" />
        </span>
        <div className="min-w-0 flex-1">
          <h3 className="text-body font-semibold wrap-break-word" dir="auto">
            {medicineTitle(medicine)}
          </h3>
          <p className="text-caption text-muted">
            {[
              medicine.form ? MEDICINE_FORM_LABELS[medicine.form] : null,
              `usually ${formatDose(medicine.usualAmount, medicine.unit)}`,
            ]
              .filter(Boolean)
              .join(" · ")}
          </p>
          {medicine.ingredients.length > 0 && (
            <p className="text-caption text-muted wrap-break-word" dir="auto">
              Active ingredients: {ingredientsLine(medicine)}
            </p>
          )}
          {medicine.notes && (
            <p className="text-caption text-muted wrap-break-word" dir="auto">
              {medicine.notes}
            </p>
          )}
        </div>
      </div>
      <div className="flex flex-wrap gap-2 pl-14">
        {!medicine.archived && (
          <Button
            variant="secondary"
            className="bg-primary-soft text-on-primary-soft hover:bg-primary-soft rounded-full"
            aria-label={`Log now: ${medicineTitle(medicine)}`}
            loading={busy === `log:${medicine.id}`}
            disabled={busy !== null}
            onClick={() => void logNow(medicine)}
          >
            Log now
          </Button>
        )}
        <Button
          variant="secondary"
          className="rounded-full"
          aria-label={`Edit: ${medicineTitle(medicine)}`}
          onClick={() => setEditing({ medicine })}
        >
          <Pencil aria-hidden className="size-4" /> Edit
        </Button>
      </div>
    </li>
  );

  return (
    <>
      <h1 className="text-title">Medicines</h1>
      <p className="text-caption text-muted mt-0.5">{MEDICINE_DISCLAIMER}</p>
      <div className="mt-4 flex flex-wrap gap-2">
        <Button onClick={() => openCamera("medicine")}>
          <Camera aria-hidden className="size-4" /> Photograph a label
        </Button>
        <Button variant="secondary" onClick={() => setEditing({ medicine: null })}>
          <Plus aria-hidden className="size-4" /> Add a medicine
        </Button>
      </div>

      <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2 md:items-start">
        <Card as="section" aria-labelledby="my-medicines-heading">
          <h2 id="my-medicines-heading" className="text-headline">
            Your medicines
          </h2>
          {inUse.length ? (
            <ul className="mt-1" data-testid="medicine-list">
              {inUse.map(row)}
            </ul>
          ) : (
            <p className="text-body text-muted mt-2">
              None yet. Photograph a label with the camera&apos;s Medicine tab, or add one by hand.
            </p>
          )}
          {archived.length > 0 && (
            <details className="mt-2">
              <summary className="text-label text-primary min-h-11 cursor-pointer py-2.5">
                Archived ({archived.length})
              </summary>
              <ul data-testid="archived-medicines">{archived.map(row)}</ul>
            </details>
          )}
        </Card>

        <Card as="section" aria-labelledby="history-heading">
          <h2 id="history-heading" className="text-headline">
            History
          </h2>
          {history.length ? (
            <div className="mt-2 flex flex-col gap-4" data-testid="medicine-history">
              {history.map((day) => (
                <section key={day.localDate} aria-labelledby={`day-${day.localDate}`}>
                  <h3 id={`day-${day.localDate}`} className="text-label text-muted">
                    {dayTitle(day.localDate, today)}
                  </h3>
                  <ul className="mt-1 flex flex-col">
                    {day.logs.map((log) => (
                      <li key={log.id} className="flex min-h-12 items-center gap-3">
                        {log.photo ? (
                          // eslint-disable-next-line @next/next/no-img-element -- authenticated same-origin photo
                          <img
                            src={log.photo.thumb}
                            alt=""
                            className="bg-surface-2 size-10 shrink-0 rounded-lg object-cover"
                            loading="lazy"
                          />
                        ) : (
                          <span
                            aria-hidden
                            className="bg-surface-2 grid size-10 shrink-0 place-items-center rounded-lg"
                          >
                            <Pill className="text-muted size-4" />
                          </span>
                        )}
                        <span className="tabular text-label shrink-0">{log.localTime}</span>
                        <span className="text-body min-w-0 flex-1 wrap-break-word" dir="auto">
                          {medicineTitle(log)} · {formatDose(log.amount, log.unit)}
                        </span>
                        <button
                          type="button"
                          aria-label={`Remove ${medicineTitle(log)} at ${log.localTime}`}
                          disabled={busy !== null}
                          onClick={() => void removeLog(log)}
                          className="text-muted hover:bg-surface-2 grid size-11 shrink-0 place-items-center rounded-full disabled:opacity-50"
                        >
                          <Trash2 aria-hidden className="size-4.5" />
                        </button>
                      </li>
                    ))}
                  </ul>
                </section>
              ))}
            </div>
          ) : (
            <p className="text-body text-muted mt-2">
              Nothing taken in the last 90 days. Logs show here by day.
            </p>
          )}
        </Card>
      </div>

      <MedicineEditSheet
        open={editing !== null}
        onOpenChange={(open) => !open && setEditing(null)}
        medicine={editing?.medicine ?? null}
        onSaved={(saved, change) => {
          setMedicines((list) =>
            list.some((m) => m.id === saved.id)
              ? list.map((m) => (m.id === saved.id ? saved : m))
              : [...list, saved],
          );
          setEditing(null);
          show({
            title: {
              added: `${medicineTitle(saved)} added`,
              saved: "Saved",
              archived: `${medicineTitle(saved)} archived`,
              restored: `${medicineTitle(saved)} is back in your medicines`,
            }[change],
            tone: "success",
          });
          router.refresh();
        }}
      />
    </>
  );
};
