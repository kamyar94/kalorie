"use client";

import { Clock, Pill } from "lucide-react";
import { useRef, useState } from "react";

import { WhenSheet } from "@/components/capture/when-sheet";
import { BottomSheet } from "@/components/ui/bottom-sheet";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { SelectField } from "@/components/ui/select-field";
import { Stepper } from "@/components/ui/stepper";
import { api } from "@/lib/client/api";
import {
  formatDose,
  MEDICINE_DISCLAIMER,
  MEDICINE_FORM_LABELS,
  MEDICINE_FORMS,
  MEDICINE_LIMITS,
  medicineTitle,
  unitFor,
  type LoggedMedicine,
  type MedicineForm,
  type MedicineReading,
} from "@/lib/contracts/medicines";
import { deviceTimeZone } from "@/lib/photos/client";
import { useOnline } from "@/lib/ui/hooks";
import { whenLabel, whenSpoken } from "@/lib/ui/when";

const FORM_OPTIONS = [
  { value: "", label: "Not sure" },
  ...MEDICINE_FORMS.map((form) => ({ value: form, label: MEDICINE_FORM_LABELS[form] })),
];

/** Liquids are counted in whole millilitres; tablets and the rest in halves. */
const stepFor = (form: MedicineForm | null) => (form === "liquid" ? 1 : 0.5);

/**
 * The medicine taken (board 7): what the label says (or empty fields to type it), "How many did
 * you take?", when, "Keep it in my medicines for one-tap logging" and the line that Cal does not
 * check doses. Save logs it. Used over the camera (Medicine mode) and on the Medicines page.
 */
export const MedicineSheet = ({
  open,
  onOpenChange,
  reading,
  scanId,
  notice,
  elevated = false,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** What the AI read on the label; null opens the fields empty for typing. */
  reading: MedicineReading | null;
  /** The label photo the reading came from, kept with the log. */
  scanId: string | null;
  /** Why the fields are empty (no AI key, not a medicine, offline...). */
  notice: string | null;
  elevated?: boolean;
  onSaved: (logged: LoggedMedicine) => void;
}) => {
  const online = useOnline();
  const whenButton = useRef<HTMLButtonElement>(null);
  const [editing, setEditing] = useState(!reading);
  const [name, setName] = useState(reading?.name ?? "");
  const [strength, setStrength] = useState(reading?.strength ?? "");
  const [form, setForm] = useState<MedicineForm | null>(reading?.form ?? null);
  const [amount, setAmount] = useState(1);
  const [at, setAt] = useState<Date | null>(null);
  const [whenOpen, setWhenOpen] = useState(false);
  const [keep, setKeep] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Start from the reading each time the sheet opens.
  const [wasOpen, setWasOpen] = useState(false);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) {
      setEditing(!reading);
      setName(reading?.name ?? "");
      setStrength(reading?.strength ?? "");
      setForm(reading?.form ?? null);
      setAmount(1);
      setAt(null);
      setKeep(true);
      setError(null);
    }
  }

  const tz = deviceTimeZone();
  const unit = unitFor(form, 1);
  const save = async () => {
    const cleanName = name.trim();
    if (!cleanName) {
      setEditing(true);
      return setError("Write the medicine's name.");
    }
    setBusy(true);
    setError(null);
    try {
      const logged = await api.logMedicine({
        name: cleanName,
        strength: strength.trim() || null,
        form,
        amount,
        unit,
        ingredients: reading?.ingredients ?? [],
        takenAt: (at ?? new Date()).toISOString(),
        tz,
        ...(scanId ? { scanId } : {}),
        keep,
      });
      onSaved(logged);
    } catch (err) {
      setError(err instanceof Error ? err.message : "The medicine was not saved.");
    } finally {
      setBusy(false);
    }
  };

  const title = medicineTitle({ name: name.trim(), strength: strength.trim() || null });
  return (
    <>
      <BottomSheet
        open={open}
        onOpenChange={onOpenChange}
        title={reading ? "Medicine found on the label" : "What did you take?"}
        showTitle={!reading}
        elevated={elevated}
        footer={
          <Button
            size="lg"
            fullWidth
            className="rounded-full"
            loading={busy}
            disabled={!online}
            onClick={() => void save()}
          >
            Save
          </Button>
        }
      >
        <div className="flex flex-col gap-3.5 py-1" data-testid="medicine-sheet">
          {reading && !editing ? (
            <div className="flex items-center gap-3">
              <span
                aria-hidden
                className="bg-primary-soft text-on-primary-soft grid size-12 shrink-0 place-items-center rounded-[0.875rem]"
              >
                <Pill className="size-6" />
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-caption text-muted">Read from the label</p>
                <p
                  className="text-xl leading-tight font-bold"
                  dir="auto"
                  data-testid="medicine-name"
                >
                  {title}
                </p>
                {form && (
                  <p className="text-label text-muted font-normal">{MEDICINE_FORM_LABELS[form]}</p>
                )}
              </div>
              <Button variant="secondary" className="rounded-full" onClick={() => setEditing(true)}>
                Edit
              </Button>
            </div>
          ) : (
            <>
              {notice && (
                <p
                  role="status"
                  className="text-body bg-warning-soft text-on-warning-soft rounded-2xl px-3.5 py-2.5"
                >
                  {notice}
                </p>
              )}
              <Field
                label="Name"
                dir="auto"
                autoComplete="off"
                maxLength={MEDICINE_LIMITS.nameChars}
                value={name}
                aria-invalid={error && !name.trim() ? true : undefined}
                onChange={(event) => setName(event.target.value)}
              />
              <div className="grid grid-cols-2 gap-2.5">
                <Field
                  label="Strength"
                  hint="For example 200 mg"
                  autoComplete="off"
                  maxLength={MEDICINE_LIMITS.strengthChars}
                  value={strength}
                  onChange={(event) => setStrength(event.target.value)}
                />
                <SelectField
                  label="Form"
                  options={FORM_OPTIONS}
                  value={form ?? ""}
                  onChange={(event) => {
                    const next = (event.target.value || null) as MedicineForm | null;
                    setForm(next);
                    setAmount((current) => Math.max(current, stepFor(next)));
                  }}
                />
              </div>
            </>
          )}
          {reading && reading.ingredients.length > 0 && (
            <p className="text-caption text-muted" dir="auto">
              Active ingredients:{" "}
              {reading.ingredients
                .map((i) => (i.strength ? `${i.name} ${i.strength}` : i.name))
                .join(", ")}
            </p>
          )}

          <div className="bg-bg border-border flex items-center justify-between gap-2 rounded-2xl border py-2 pr-2 pl-3.5">
            <span aria-hidden className="text-[0.9375rem] font-semibold">
              How many did you take?
            </span>
            <Stepper
              label="How many did you take?"
              value={amount}
              onChange={setAmount}
              min={stepFor(form)}
              max={MEDICINE_LIMITS.maxAmount}
              step={stepFor(form)}
              format={(value) => (unit ? formatDose(value, unit) : String(value))}
              className="shrink-0"
            />
          </div>

          <div className="flex items-center justify-between gap-2">
            <span className="text-[0.9375rem] font-semibold">Taken</span>
            <button
              ref={whenButton}
              type="button"
              aria-haspopup="dialog"
              aria-label={`Taken: ${whenSpoken(at, new Date(), tz)}. Change the time`}
              onClick={() => setWhenOpen(true)}
              className="text-label bg-surface-2 hover:bg-surface-3 inline-flex min-h-11 items-center gap-1.5 rounded-full px-3.5"
            >
              <Clock aria-hidden className="size-4" />
              {whenLabel(at, new Date(), tz)}
            </button>
          </div>

          {/* The whole label is the 44 px target. */}
          <label className="-ml-1 flex min-h-11 cursor-pointer items-center gap-3 pl-1">
            <input
              type="checkbox"
              checked={keep}
              onChange={(event) => setKeep(event.target.checked)}
              className="size-5.5 shrink-0 cursor-pointer accent-[var(--primary)]"
            />
            <span className="text-[0.9375rem]">Keep it in my medicines for one-tap logging</span>
          </label>

          <p className="text-caption text-muted leading-[1.4]">{MEDICINE_DISCLAIMER}</p>
          {!online && (
            <p role="status" className="text-caption text-danger">
              You are offline. The medicine can be saved once you are back online.
            </p>
          )}
          {error && (
            <p role="alert" className="text-body text-danger">
              {error}
            </p>
          )}
        </div>
      </BottomSheet>
      <WhenSheet
        open={whenOpen}
        onOpenChange={setWhenOpen}
        value={at}
        tz={tz}
        title="When did you take it?"
        description="Pick the day and time you took it."
        elevated={elevated}
        returnFocus={whenButton}
        onDone={(chosen) => {
          setAt(chosen);
          setWhenOpen(false);
        }}
      />
    </>
  );
};
