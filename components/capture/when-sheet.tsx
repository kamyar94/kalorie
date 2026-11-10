"use client";

import { useId, useState } from "react";

import { BottomSheet } from "@/components/ui/bottom-sheet";
import { Button } from "@/components/ui/button";
import { cn } from "@/components/ui/cn";
import { localParts } from "@/lib/meals/time";
import {
  oldestDay,
  parseWhenInputs,
  WHEN_CHOICES,
  whenForChoice,
  whenInputs,
  type WhenChoice,
} from "@/lib/ui/when";

const inputClass =
  "border-border bg-bg text-text min-h-12 w-full min-w-0 rounded-[var(--radius-control)] border px-3 text-base";

/**
 * "When did you eat this?": quick choices (Now, 30 min ago, 1 hour ago, 2 hours ago, This morning,
 * Yesterday) and a date and a time field. Done hands back the moment, or null for "Now" (the
 * camera then keeps the photo's own time). Times in the future cannot be picked.
 */
export const WhenSheet = ({
  open,
  onOpenChange,
  value,
  tz,
  description,
  elevated = false,
  onDone,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The time chosen so far; null is "Now". */
  value: Date | null;
  tz: string;
  description: string;
  /** Above the full-screen camera. */
  elevated?: boolean;
  onDone: (at: Date | null) => void | Promise<void>;
}) => {
  const id = useId();
  const [choice, setChoice] = useState<WhenChoice | null>(null);
  const [date, setDate] = useState("");
  const [time, setTime] = useState("");
  const [now, setNow] = useState(() => new Date());
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Fill the fields each time the sheet opens.
  const [wasOpen, setWasOpen] = useState(false);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) {
      const current = new Date();
      const fields = whenInputs(value ?? current, tz);
      setNow(current);
      setChoice(value ? null : "now");
      setDate(fields.date);
      setTime(fields.time);
      setError(null);
    }
  }

  const today = localParts(now, tz).date;

  const pick = (next: WhenChoice) => {
    const current = new Date();
    const at = whenForChoice(next, current, tz);
    if (!at) return;
    const fields = whenInputs(at, tz);
    setNow(current);
    setChoice(next);
    setDate(fields.date);
    setTime(fields.time);
    setError(null);
  };

  const done = async () => {
    let at: Date | null = null;
    if (choice !== "now") {
      const parsed = parseWhenInputs(date, time, tz, new Date());
      if ("error" in parsed) return setError(parsed.error);
      at = parsed.at;
    }
    setBusy(true);
    try {
      await onDone(at);
    } finally {
      setBusy(false);
    }
  };

  return (
    <BottomSheet
      open={open}
      onOpenChange={onOpenChange}
      title="When did you eat this?"
      description={description}
      elevated={elevated}
      footer={
        <Button fullWidth size="lg" loading={busy} onClick={() => void done()}>
          Done
        </Button>
      }
    >
      <div className="flex flex-col gap-4 py-1">
        <div role="group" aria-label="Quick choices" className="grid grid-cols-3 gap-2">
          {WHEN_CHOICES.map((option) => {
            const pressed = choice === option.id;
            const possible = whenForChoice(option.id, now, tz) !== null;
            return (
              <button
                key={option.id}
                type="button"
                aria-pressed={pressed}
                disabled={!possible}
                onClick={() => pick(option.id)}
                className={cn(
                  "text-label min-h-12 rounded-[var(--radius-control)] border px-1 transition-colors disabled:opacity-50",
                  pressed
                    ? "border-primary bg-primary-soft text-on-primary-soft border-2"
                    : "border-border bg-surface-2 hover:bg-surface-3",
                )}
              >
                {option.label}
              </button>
            );
          })}
        </div>
        <div className="grid grid-cols-2 gap-2.5">
          <div className="flex min-w-0 flex-col gap-1.5">
            <label htmlFor={`${id}-date`} className="text-label text-muted">
              Date
            </label>
            <input
              id={`${id}-date`}
              type="date"
              value={date}
              min={oldestDay(now, tz)}
              max={today}
              onChange={(event) => {
                setDate(event.target.value);
                setChoice(null);
                setError(null);
              }}
              className={inputClass}
            />
          </div>
          <div className="flex min-w-0 flex-col gap-1.5">
            <label htmlFor={`${id}-time`} className="text-label text-muted">
              Time
            </label>
            <input
              id={`${id}-time`}
              type="time"
              value={time}
              max={date === today ? localParts(now, tz).time : undefined}
              onChange={(event) => {
                setTime(event.target.value);
                setChoice(null);
                setError(null);
              }}
              className={inputClass}
            />
          </div>
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
