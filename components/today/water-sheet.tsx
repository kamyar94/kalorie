"use client";

import { Clock, Minus, Plus, Trash2 } from "lucide-react";
import { useId, useRef, useState } from "react";

import { WhenSheet } from "@/components/capture/when-sheet";
import { BottomSheet } from "@/components/ui/bottom-sheet";
import { Button } from "@/components/ui/button";
import { cn } from "@/components/ui/cn";
import { WATER_LIMITS, WATER_PRESETS, type WaterEntryDto } from "@/lib/contracts/water";
import { cleanWaterMl, WATER_AMOUNT_ERROR } from "@/lib/meals/water";
import { useOnline } from "@/lib/ui/hooks";
import { whenLabel, whenSpoken } from "@/lib/ui/when";

/** What a new amount starts at: a glass. */
const NEW_WATER_ML = 250;

const roundButton =
  "bg-surface-2 hover:bg-surface-3 text-text grid size-13 shrink-0 place-items-center rounded-full disabled:opacity-40";

/** The number typed in the amount field, or null when it is not a whole number. */
const typedMl = (text: string) => (/^\d{1,5}$/.test(text.trim()) ? Number(text.trim()) : null);

/**
 * Water (board 29): the amount in ml with 50 ml less and more, a field to type it and presets
 * (Sip 100 to 1 L), the When chip (the When sheet) and Save; for water already logged also Remove
 * this water. `entry` null is new water ("+ Other amount"), at `start` (null: now). The screen
 * saves and removes (onSave and onRemove throw a sentence for the person when that fails).
 */
export const WaterSheet = ({
  open,
  onOpenChange,
  entry,
  start,
  timeZone,
  onSave,
  onRemove,
  onCloseAutoFocus,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  entry: WaterEntryDto | null;
  /** The time new water starts at; null is "Now". */
  start: Date | null;
  /** The zone of the time: the entry's own, else the device's. */
  timeZone: string;
  onSave: (ml: number, at: Date | null) => Promise<void>;
  onRemove: () => Promise<void>;
  onCloseAutoFocus?: (event: Event) => void;
}) => {
  const id = useId();
  const online = useOnline();
  const whenButton = useRef<HTMLButtonElement>(null);
  // A second tap while the first request is on its way sends nothing.
  const sending = useRef(false);
  const [text, setText] = useState(String(NEW_WATER_ML));
  const [at, setAt] = useState<Date | null>(null);
  const [whenOpen, setWhenOpen] = useState(false);
  const [busy, setBusy] = useState<"save" | "remove" | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Start from the entry (or a glass) each time the sheet opens.
  const [wasOpen, setWasOpen] = useState(false);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) {
      setText(String(entry?.waterMl ?? NEW_WATER_ML));
      setAt(entry ? new Date(entry.eatenAt) : start);
      setWhenOpen(false);
      setError(null);
    }
  }

  const ml = typedMl(text);
  const step = (delta: number) => {
    const next = (ml ?? 0) + delta;
    if (next < WATER_LIMITS.minMl || next > WATER_LIMITS.maxMl) return;
    setText(String(next));
    setError(null);
  };

  const run = async (kind: "save" | "remove", action: () => Promise<void>) => {
    if (sending.current) return;
    sending.current = true;
    setBusy(kind);
    setError(null);
    try {
      await action();
      onOpenChange(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "That did not work. Try again.");
    } finally {
      sending.current = false;
      setBusy(null);
    }
  };

  const save = () => {
    const amount = cleanWaterMl(ml);
    if (amount === null) return setError(WATER_AMOUNT_ERROR);
    void run("save", () => onSave(amount, at));
  };

  const now = new Date();
  return (
    <>
      <BottomSheet
        open={open}
        onOpenChange={onOpenChange}
        title={
          <>
            <span aria-hidden>💧 </span>
            {entry ? `${entry.name} at ${entry.localTime}` : "Add water"}
          </>
        }
        onCloseAutoFocus={onCloseAutoFocus}
        footer={
          <div className="flex flex-col gap-1.5">
            <Button
              size="lg"
              fullWidth
              className="rounded-full"
              loading={busy === "save"}
              disabled={!online || busy !== null}
              onClick={save}
            >
              Save
            </Button>
            {entry && (
              <Button
                variant="ghost"
                fullWidth
                className="text-danger rounded-full"
                loading={busy === "remove"}
                disabled={!online || busy !== null}
                onClick={() => void run("remove", onRemove)}
              >
                <Trash2 aria-hidden className="size-4.5" /> Remove this water
              </Button>
            )}
          </div>
        }
      >
        <div className="flex flex-col gap-3.5 py-1" data-testid="water-sheet">
          <div className="bg-bg border-border flex flex-col items-center gap-3 rounded-2xl border p-3.5">
            <div className="flex items-center gap-3.5">
              <button
                type="button"
                aria-label={`${WATER_LIMITS.stepMl} ml less`}
                disabled={ml === null || ml - WATER_LIMITS.stepMl < WATER_LIMITS.minMl}
                onClick={() => step(-WATER_LIMITS.stepMl)}
                className={roundButton}
              >
                <Minus aria-hidden className="size-6" />
              </button>
              <div className="flex items-baseline gap-1">
                <label htmlFor={`${id}-ml`} className="sr-only">
                  Amount in ml
                </label>
                <input
                  id={`${id}-ml`}
                  type="text"
                  inputMode="numeric"
                  autoComplete="off"
                  maxLength={5}
                  value={text}
                  aria-invalid={error === WATER_AMOUNT_ERROR || undefined}
                  onChange={(event) => {
                    setText(event.target.value.replace(/[^\d]/g, ""));
                    setError(null);
                  }}
                  className="tabular border-primary text-text w-24 border-0 border-b-2 bg-transparent text-center text-[2.125rem] leading-tight font-extrabold"
                />
                <span aria-hidden className="text-muted text-base">
                  ml
                </span>
              </div>
              <button
                type="button"
                aria-label={`${WATER_LIMITS.stepMl} ml more`}
                disabled={ml !== null && ml + WATER_LIMITS.stepMl > WATER_LIMITS.maxMl}
                onClick={() => step(WATER_LIMITS.stepMl)}
                className={roundButton}
              >
                <Plus aria-hidden className="size-6" />
              </button>
            </div>
            <div
              role="group"
              aria-label="Amounts"
              className="flex flex-wrap justify-center gap-1.5"
            >
              {WATER_PRESETS.map((preset) => {
                const pressed = ml === preset.ml;
                return (
                  <button
                    key={preset.ml}
                    type="button"
                    aria-pressed={pressed}
                    onClick={() => {
                      setText(String(preset.ml));
                      setError(null);
                    }}
                    className={cn(
                      "text-caption min-h-11 rounded-full px-3 font-semibold",
                      pressed
                        ? "border-primary bg-primary-soft text-on-primary-soft border"
                        : "bg-surface-2 hover:bg-surface-3",
                    )}
                  >
                    {preset.label}
                    {preset.ml < 1000 && <span className="sr-only"> ml</span>}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="flex items-center justify-between gap-2">
            <span className="text-[0.9375rem] font-semibold">When</span>
            <button
              ref={whenButton}
              type="button"
              aria-haspopup="dialog"
              aria-label={`When: ${whenSpoken(at, now, timeZone)}. Change the time`}
              onClick={() => setWhenOpen(true)}
              className="text-label bg-surface-2 hover:bg-surface-3 inline-flex min-h-11 items-center gap-1.5 rounded-full px-3.5"
            >
              <Clock aria-hidden className="size-4" />
              <span className="tabular">{whenLabel(at, now, timeZone)}</span>
            </button>
          </div>

          {!online && (
            <p role="status" className="text-caption text-danger">
              You are offline. Water can be saved once you are back online.
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
        tz={timeZone}
        title="When did you drink it?"
        description="Pick the day and time you drank it."
        returnFocus={whenButton}
        onDone={(chosen) => {
          setAt(chosen);
          setWhenOpen(false);
        }}
      />
    </>
  );
};
