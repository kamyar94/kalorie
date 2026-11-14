"use client";

import { Clock, Pill, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";

import { WhenSheet } from "@/components/capture/when-sheet";
import { BottomSheet } from "@/components/ui/bottom-sheet";
import { Button } from "@/components/ui/button";
import { Stepper } from "@/components/ui/stepper";
import { useToast, type ToastInput } from "@/components/ui/toast";
import { api } from "@/lib/client/api";
import {
  doseStep,
  formatDose,
  MEDICINE_FORM_LABELS,
  MEDICINE_LIMITS,
  medicineTitle,
  type MedicineLogDto,
  type MedicineLogPatch,
  type NewMedicineLog,
} from "@/lib/contracts/medicines";
import { useOnline } from "@/lib/ui/hooks";
import { whenLabel, whenSpoken } from "@/lib/ui/when";

/** The same log again, for Undo after removing one (its label photo is gone with it). */
export const relogInput = (log: MedicineLogDto): NewMedicineLog => ({
  ...(log.medicineId ? { medicineId: log.medicineId } : {}),
  name: log.name,
  strength: log.strength,
  form: log.form,
  amount: log.amount,
  unit: log.unit,
  takenAt: log.takenAt,
  tz: log.tz,
});

/**
 * The toast after a one-tap "Log now": the dose and time, with Change time (the log's sheet) next
 * to Undo. Longer than the usual toast so there is time to reach for Change time.
 */
export const loggedNowToast = (
  log: MedicineLogDto,
  actions: { changeTime: () => void; undo: () => void },
): ToastInput => ({
  title: `${medicineTitle(log)} logged`,
  body: `${formatDose(log.amount, log.unit)} at ${log.localTime}`,
  tone: "success",
  duration: 8000,
  actions: [
    { label: "Change time", onClick: actions.changeTime },
    { label: "Undo", onClick: actions.undo },
  ],
});

/**
 * A logged medicine (board 28): when it was taken (the When sheet: a day and a time, or quick
 * picks) and how many, in the log's unit; Save changes, or Remove this log with Undo. Opened from
 * Today's Medicines card, the Medicines page history and the toast after "Log now". The time is
 * shown and chosen in the log's own time zone.
 */
export const MedicineLogSheet = ({
  log,
  open,
  onOpenChange,
  onCloseAutoFocus,
}: {
  log: MedicineLogDto | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Where focus goes when the sheet closes (default: where it was before it opened). */
  onCloseAutoFocus?: (event: Event) => void;
}) => {
  const router = useRouter();
  const { show } = useToast();
  const online = useOnline();
  const whenButton = useRef<HTMLButtonElement>(null);
  // A second tap while the first request is on its way sends nothing.
  const sending = useRef(false);
  const [amount, setAmount] = useState(1);
  const [at, setAt] = useState<Date | null>(null);
  const [whenOpen, setWhenOpen] = useState(false);
  const [busy, setBusy] = useState<"save" | "remove" | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Start from the log each time the sheet opens.
  const [shown, setShown] = useState<{ open: boolean; id: string | null }>({
    open: false,
    id: null,
  });
  if (shown.open !== open || shown.id !== (log?.id ?? null)) {
    setShown({ open, id: log?.id ?? null });
    if (open && log) {
      setAmount(log.amount);
      setAt(new Date(log.takenAt));
      setWhenOpen(false);
      setError(null);
    }
  }

  const fail = (err: unknown, fallback: string) =>
    setError(err instanceof Error ? err.message : fallback);

  const save = async () => {
    if (!log || sending.current) return;
    const patch: MedicineLogPatch = {};
    // "Now" in the When sheet is the moment Save is pressed.
    const takenAt = at ?? new Date();
    if (takenAt.getTime() !== new Date(log.takenAt).getTime()) {
      patch.takenAt = takenAt.toISOString();
      patch.tz = log.tz;
    }
    if (amount !== log.amount) patch.amount = amount;
    if (patch.takenAt === undefined && patch.amount === undefined) return onOpenChange(false);
    sending.current = true;
    setBusy("save");
    setError(null);
    try {
      const saved = await api.updateMedicineLog(log.id, patch);
      onOpenChange(false);
      router.refresh();
      show({
        title: `${medicineTitle(saved)} changed`,
        body: `${formatDose(saved.amount, saved.unit)}, taken ${whenSpoken(new Date(saved.takenAt), new Date(), saved.tz)}`,
        tone: "success",
      });
    } catch (err) {
      fail(err, "The change was not saved.");
    } finally {
      sending.current = false;
      setBusy(null);
    }
  };

  const remove = async () => {
    if (!log || sending.current) return;
    sending.current = true;
    setBusy("remove");
    setError(null);
    try {
      await api.deleteMedicineLog(log.id);
      onOpenChange(false);
      router.refresh();
      show({
        title: `${medicineTitle(log)} at ${log.localTime} removed`,
        action: {
          label: "Undo",
          onClick: () =>
            void api
              .logMedicine(relogInput(log))
              .then(() => router.refresh())
              .catch((err) =>
                show({ title: "Not undone", body: (err as Error).message, tone: "error" }),
              ),
        },
      });
    } catch (err) {
      fail(err, "The log was not removed.");
    } finally {
      sending.current = false;
      setBusy(null);
    }
  };

  const now = new Date();
  const title = log ? medicineTitle(log) : "Logged medicine";
  const step = doseStep(log?.form ?? null);
  return (
    <>
      <BottomSheet
        open={open && log !== null}
        onOpenChange={onOpenChange}
        title={title}
        showTitle={false}
        onCloseAutoFocus={onCloseAutoFocus}
        footer={
          <div className="flex flex-col gap-1.5">
            <Button
              size="lg"
              fullWidth
              className="rounded-full"
              loading={busy === "save"}
              disabled={!online || busy !== null}
              onClick={() => void save()}
            >
              Save changes
            </Button>
            <Button
              variant="ghost"
              fullWidth
              className="text-danger rounded-full"
              loading={busy === "remove"}
              disabled={!online || busy !== null}
              onClick={() => void remove()}
            >
              <Trash2 aria-hidden className="size-4.5" /> Remove this log
            </Button>
          </div>
        }
      >
        {log && (
          <div className="flex flex-col gap-3.5 py-1" data-testid="medicine-log-sheet">
            <div className="flex items-center gap-3">
              <span
                aria-hidden
                className="bg-primary-soft text-on-primary-soft grid size-12 shrink-0 place-items-center rounded-[0.875rem]"
              >
                <Pill className="size-6" />
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-caption text-muted">Logged medicine</p>
                <p className="text-xl leading-tight font-bold wrap-break-word" dir="auto">
                  {title}
                </p>
                {log.form && (
                  <p className="text-label text-muted font-normal">
                    {MEDICINE_FORM_LABELS[log.form]}
                  </p>
                )}
              </div>
            </div>

            <div className="flex items-center justify-between gap-2">
              <span className="text-[0.9375rem] font-semibold">Taken</span>
              <button
                ref={whenButton}
                type="button"
                aria-haspopup="dialog"
                aria-label={`Taken: ${whenSpoken(at, now, log.tz)}. Change the day and time`}
                onClick={() => setWhenOpen(true)}
                className="text-label border-primary bg-surface-2 hover:bg-surface-3 inline-flex min-h-11 items-center gap-1.5 rounded-full border px-3.5"
              >
                <Clock aria-hidden className="size-4" />
                <span className="tabular">{whenLabel(at, now, log.tz)}</span>
              </button>
            </div>

            <div className="bg-bg border-border flex items-center justify-between gap-2 rounded-2xl border py-2 pr-2 pl-3.5">
              <span aria-hidden className="text-[0.9375rem] font-semibold">
                How many
              </span>
              <Stepper
                label="How many"
                value={amount}
                onChange={setAmount}
                min={Math.min(step, log.amount)}
                max={MEDICINE_LIMITS.maxAmount}
                step={step}
                format={(value) => (log.unit ? formatDose(value, log.unit) : String(value))}
                className="shrink-0"
              />
            </div>

            {!online && (
              <p role="status" className="text-caption text-danger">
                You are offline. Changes can be saved once you are back online.
              </p>
            )}
            {error && (
              <p role="alert" className="text-body text-danger">
                {error}
              </p>
            )}
          </div>
        )}
      </BottomSheet>
      {log && (
        <WhenSheet
          open={whenOpen}
          onOpenChange={setWhenOpen}
          value={at}
          tz={log.tz}
          title="When did you take it?"
          description="Pick the day and time you took it."
          returnFocus={whenButton}
          onDone={(chosen) => {
            setAt(chosen);
            setWhenOpen(false);
          }}
        />
      )}
    </>
  );
};
