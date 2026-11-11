"use client";

import { Archive, ArchiveRestore } from "lucide-react";
import { useId, useState } from "react";

import { BottomSheet } from "@/components/ui/bottom-sheet";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { SelectField } from "@/components/ui/select-field";
import { Stepper } from "@/components/ui/stepper";
import { api } from "@/lib/client/api";
import {
  formatDose,
  MEDICINE_FORM_LABELS,
  MEDICINE_FORMS,
  MEDICINE_LIMITS,
  unitFor,
  type MedicineDto,
  type MedicineForm,
} from "@/lib/contracts/medicines";

const FORM_OPTIONS = [
  { value: "", label: "Not sure" },
  ...MEDICINE_FORMS.map((form) => ({ value: form, label: MEDICINE_FORM_LABELS[form] })),
];

/**
 * Adds a medicine to the person's list or changes one: name, strength, form, the usual amount
 * ("Log now" logs it) and notes; an existing one can be archived (it leaves Today, its history
 * stays) or brought back.
 */
export const MedicineEditSheet = ({
  open,
  onOpenChange,
  medicine,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** null adds a new medicine. */
  medicine: MedicineDto | null;
  onSaved: (medicine: MedicineDto, change: "added" | "saved" | "archived" | "restored") => void;
}) => {
  const id = useId();
  const [name, setName] = useState("");
  const [strength, setStrength] = useState("");
  const [form, setForm] = useState<MedicineForm | null>(null);
  const [amount, setAmount] = useState(1);
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState<"save" | "archive" | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [wasOpen, setWasOpen] = useState(false);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) {
      setName(medicine?.name ?? "");
      setStrength(medicine?.strength ?? "");
      setForm(medicine?.form ?? null);
      setAmount(medicine?.usualAmount ?? 1);
      setNotes(medicine?.notes ?? "");
      setError(null);
    }
  }

  const step = form === "liquid" ? 1 : 0.5;
  const save = async () => {
    if (!name.trim()) return setError("Write the name of the medicine.");
    setBusy("save");
    setError(null);
    const fields = {
      name: name.trim(),
      strength: strength.trim() || null,
      form,
      usualAmount: amount,
      unit: unitFor(form, 1),
      notes: notes.trim() || null,
    };
    try {
      const saved = medicine
        ? await api.updateMedicine(medicine.id, fields)
        : await api.createMedicine(fields);
      onSaved(saved, medicine ? "saved" : "added");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Not saved.");
    } finally {
      setBusy(null);
    }
  };

  const toggleArchive = async () => {
    if (!medicine) return;
    setBusy("archive");
    try {
      const saved = await api.updateMedicine(medicine.id, { archived: !medicine.archived });
      onSaved(saved, saved.archived ? "archived" : "restored");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Not saved.");
    } finally {
      setBusy(null);
    }
  };

  return (
    <BottomSheet
      open={open}
      onOpenChange={onOpenChange}
      title={medicine ? "Edit the medicine" : "Add a medicine"}
      description="Your medicines show on Today, for one-tap logging."
      footer={
        <div className="flex flex-col gap-2">
          <Button size="lg" fullWidth loading={busy === "save"} onClick={() => void save()}>
            Save
          </Button>
          {medicine && (
            <Button
              variant="secondary"
              size="lg"
              fullWidth
              loading={busy === "archive"}
              onClick={() => void toggleArchive()}
            >
              {medicine.archived ? (
                <>
                  <ArchiveRestore aria-hidden className="size-5" /> Bring it back
                </>
              ) : (
                <>
                  <Archive aria-hidden className="size-5" /> Archive
                </>
              )}
            </Button>
          )}
        </div>
      }
    >
      <div className="flex flex-col gap-3.5 py-1">
        <Field
          label="Name"
          dir="auto"
          autoComplete="off"
          maxLength={MEDICINE_LIMITS.nameChars}
          value={name}
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
              setAmount((current) => Math.max(current, next === "liquid" ? 1 : 0.5));
            }}
          />
        </div>
        <div className="flex items-center justify-between gap-2">
          <span aria-hidden className="text-label">
            Usual amount
          </span>
          <Stepper
            label="Usual amount"
            value={amount}
            onChange={setAmount}
            min={step}
            max={MEDICINE_LIMITS.maxAmount}
            step={step}
            format={(value) => formatDose(value, unitFor(form, 1))}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <label htmlFor={`${id}-notes`} className="text-label">
            Notes (only you see them)
          </label>
          <textarea
            id={`${id}-notes`}
            dir="auto"
            rows={2}
            maxLength={MEDICINE_LIMITS.notesChars}
            value={notes}
            onChange={(event) => setNotes(event.target.value)}
            className="border-border bg-surface text-body text-text focus:border-primary w-full resize-none rounded-[var(--radius-control)] border px-3.5 py-2.5 focus:outline-none focus-visible:outline-3 focus-visible:outline-[var(--focus)]"
          />
        </div>
        {error && (
          <p role="alert" className="text-body text-danger">
            {error}
          </p>
        )}
      </div>
    </BottomSheet>
  );
};
