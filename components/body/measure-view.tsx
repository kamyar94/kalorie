"use client";

import { ChevronLeft, Plus, Trash2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useId, useState } from "react";

import { BottomSheet } from "@/components/ui/bottom-sheet";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { cn } from "@/components/ui/cn";
import { useToast } from "@/components/ui/toast";
import { api } from "@/lib/client/api";
import {
  CUSTOM_PREFIX,
  CUSTOM_UNITS,
  formatMeasure,
  fromDisplay,
  measureInfo,
  toDisplay,
} from "@/lib/contracts/body";
import { deviceTimeZone } from "@/lib/photos/client";
import { longDate } from "@/lib/ui/format";
import { useOnline } from "@/lib/ui/hooks";

import { BodyOutline } from "./body-outline";
import type { Units } from "./format";

const input =
  "border-border bg-bg text-text placeholder:text-muted focus:border-primary min-h-11 w-full min-w-0 rounded-xl border px-2.5 text-[0.9375rem] focus:outline-none focus-visible:outline-3 focus-visible:outline-offset-0 focus-visible:outline-[var(--focus)]";

const SCALE_FIRST = ["weight", "body_fat"];
const SCALE_MORE = ["muscle", "water", "visceral_fat", "bone", "bmr"];
const TAPE_MAIN = ["neck", "chest", "waist", "hips"];
const PAIRS = [
  ["Upper arm", "upper_arm_l", "upper_arm_r"],
  ["Thigh", "thigh_l", "thigh_r"],
  ["Calf", "calf_l", "calf_r"],
] as const;
const MORE_PAIRS = [["Forearm", "forearm_l", "forearm_r"]] as const;
const MORE_SINGLE = ["shoulders", "wrist"];

type CustomPart = { key: number; label: string; unit: string; value: string };

/** A number typed with a point or a comma, else null. */
const typed = (text: string) => {
  const value = Number(text.replace(",", ".").trim());
  return text.trim() && Number.isFinite(value) && value > 0 ? value : null;
};

/**
 * Log measurements (board 12): the day (today unless changed), scale values, tape measurements
 * with where to measure, left and right, and parts of the person's own with a unit. Only what is
 * filled in is saved; values typed in lb or in are stored as kg and cm.
 */
export const MeasureView = ({
  today,
  units,
  last,
  customParts,
}: {
  today: string;
  units: Units;
  /** The latest value of each measure (metric), shown as "last ..." in its field. */
  last: Record<string, number>;
  /** Parts of the person's own logged before. */
  customParts: { label: string; unit: string }[];
}) => {
  const router = useRouter();
  const { show } = useToast();
  const online = useOnline();
  const id = useId();
  const [date, setDate] = useState(today);
  const [draftDate, setDraftDate] = useState(today);
  const [picking, setPicking] = useState(false);
  const [values, setValues] = useState<Record<string, string>>({});
  const [moreScale, setMoreScale] = useState(false);
  const [moreParts, setMoreParts] = useState(customParts.length > 0);
  const [custom, setCustom] = useState<CustomPart[]>(
    customParts.map((p, i) => ({ key: i, label: p.label, unit: p.unit, value: "" })),
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const unitOf = (code: string) => toDisplay(0, measureInfo(code)!.unit, units).unit;
  const lastText = (code: string) => {
    const value = last[code];
    if (value === undefined) return undefined;
    const info = measureInfo(code)!;
    return `last ${formatMeasure(toDisplay(value, info.unit, units).value, info.decimals)}`;
  };
  const set = (code: string, text: string) => setValues((v) => ({ ...v, [code]: text }));

  const field = (code: string, wide = false) => {
    const info = measureInfo(code)!;
    const unit = unitOf(code);
    const fieldId = `${id}-${code}`;
    const hintId = `${fieldId}-hint`;
    return (
      <div key={code} className={cn("group flex min-w-0 flex-col gap-1", wide && "col-span-2")}>
        <label htmlFor={fieldId} className="text-[0.8125rem] font-semibold">
          {info.label}
          {unit ? `, ${unit}` : ""}
        </label>
        <input
          id={fieldId}
          inputMode="decimal"
          autoComplete="off"
          value={values[code] ?? ""}
          onChange={(event) => set(code, event.target.value)}
          placeholder={info.hint ? `${unit} · ${info.hint}` : lastText(code)}
          aria-describedby={info.hint ? hintId : undefined}
          className={input}
        />
        {info.hint && (
          <span id={hintId} className="text-caption text-muted hidden group-focus-within:block">
            {info.hint[0]!.toUpperCase() + info.hint.slice(1)}
          </span>
        )}
      </div>
    );
  };

  const pair = ([label, left, right]: readonly [string, string, string]) => {
    const unit = unitOf(left);
    return (
      <div
        key={label}
        className="grid grid-cols-[minmax(0,1.2fr)_repeat(2,minmax(0,1fr))] items-center gap-2"
      >
        <span className="text-label">{label}</span>
        {[
          [left, "left"],
          [right, "right"],
        ].map(([code, side]) => (
          <input
            key={code}
            aria-label={`${label}, ${side}, ${unit}`}
            inputMode="decimal"
            autoComplete="off"
            value={values[code!] ?? ""}
            placeholder={lastText(code!)}
            onChange={(event) => set(code!, event.target.value)}
            className={input}
          />
        ))}
      </div>
    );
  };

  const save = async () => {
    const entries = Object.entries(values)
      .map(([code, text]) => {
        const value = typed(text);
        return value === null
          ? null
          : { code, value: fromDisplay(value, measureInfo(code)!.unit, units) };
      })
      .filter((v): v is { code: string; value: number } => v !== null);
    const parts = custom
      .map((p) => ({ ...p, number: typed(p.value) }))
      .filter((p) => p.number !== null);
    if (parts.some((p) => !p.label.trim())) return setError("Give each extra part a name.");
    const all = [
      ...entries,
      ...parts.map((p) => ({
        code: CUSTOM_PREFIX,
        label: p.label.trim(),
        unit: p.unit,
        value: p.number!,
      })),
    ];
    if (!all.length) return setError("Fill in at least one measurement.");
    setBusy(true);
    setError(null);
    try {
      await api.logMeasurements({ localDate: date, tz: deviceTimeZone(), values: all });
      show({
        title: all.length === 1 ? "1 measurement saved" : `${all.length} measurements saved`,
        tone: "success",
      });
      router.push("/body");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Not saved.");
    } finally {
      setBusy(false);
    }
  };

  const dateLabel = date === today ? "Today" : longDate(date, today);

  return (
    <>
      <div className="flex items-center gap-2">
        <Link
          href="/body"
          aria-label="Back to Body"
          className="bg-surface-2 hover:bg-surface-3 grid size-11 shrink-0 place-items-center rounded-full"
        >
          <ChevronLeft aria-hidden className="size-5" />
        </Link>
        <h1 className="min-w-0 flex-1 text-[1.375rem] leading-tight font-bold">Log measurements</h1>
        <button
          type="button"
          aria-label={`Date: ${date === today ? "today" : dateLabel}. Change the date`}
          aria-haspopup="dialog"
          onClick={() => {
            setDraftDate(date);
            setPicking(true);
          }}
          className="text-label bg-surface-2 hover:bg-surface-3 min-h-11 shrink-0 rounded-full px-3.5"
        >
          {dateLabel}
        </button>
      </div>
      <p className="text-caption text-muted mt-3 max-w-2xl">
        Fill in only what you measured. Use a soft tape, snug but not tight, in the morning before
        eating.
      </p>

      <div className="mt-3.5 grid max-w-4xl grid-cols-1 gap-3.5 md:grid-cols-2 md:items-start">
        <div className="flex flex-col gap-3.5">
          <Card
            as="section"
            aria-label="Scale"
            className="flex flex-col gap-2.5 p-3.5"
            padded={false}
          >
            <div className="grid grid-cols-2 gap-2.5">{SCALE_FIRST.map((c) => field(c))}</div>
            {moreScale && (
              <div className="grid grid-cols-2 gap-2.5">{SCALE_MORE.map((c) => field(c))}</div>
            )}
            {!moreScale && (
              <button
                type="button"
                onClick={() => setMoreScale(true)}
                className="text-label text-primary min-h-11 self-start px-1"
              >
                + More from the scale (muscle, water, visceral fat, bone, BMR)
              </button>
            )}
          </Card>

          <Card
            as="section"
            aria-label="Tape measurements"
            className="flex gap-3 p-3.5"
            padded={false}
          >
            <BodyOutline />
            <div className="flex min-w-0 flex-1 flex-col gap-2">
              {TAPE_MAIN.map((c) => field(c))}
            </div>
          </Card>
        </div>

        <Card
          as="section"
          aria-label="Left and right"
          className="flex flex-col gap-2 p-3.5"
          padded={false}
        >
          <div className="text-caption text-muted grid grid-cols-[minmax(0,1.2fr)_repeat(2,minmax(0,1fr))] gap-2 font-semibold">
            <span />
            <span>Left, {unitOf("calf_l")}</span>
            <span>Right, {unitOf("calf_l")}</span>
          </div>
          {PAIRS.map(pair)}
          {moreParts ? (
            <>
              {MORE_PAIRS.map(pair)}
              <div className="grid grid-cols-2 gap-2.5">{MORE_SINGLE.map((c) => field(c))}</div>
              <h2 className="text-label mt-2">Your own parts</h2>
              <p className="text-caption text-muted">
                Lengths and widths you want to follow: arm span, shoulder width, inside leg.
              </p>
              {custom.map((part) => (
                <div
                  key={part.key}
                  className="grid grid-cols-[minmax(0,1.4fr)_minmax(0,0.8fr)_minmax(0,1fr)_auto] items-center gap-2"
                >
                  <input
                    aria-label="Name of the part"
                    autoComplete="off"
                    maxLength={40}
                    placeholder="Name"
                    value={part.label}
                    onChange={(event) =>
                      setCustom((list) =>
                        list.map((p) =>
                          p.key === part.key ? { ...p, label: event.target.value } : p,
                        ),
                      )
                    }
                    className={input}
                  />
                  <select
                    aria-label={`Unit of ${part.label || "the part"}`}
                    value={part.unit}
                    onChange={(event) =>
                      setCustom((list) =>
                        list.map((p) =>
                          p.key === part.key ? { ...p, unit: event.target.value } : p,
                        ),
                      )
                    }
                    className={input}
                  >
                    {CUSTOM_UNITS.map((u) => (
                      <option key={u} value={u}>
                        {u}
                      </option>
                    ))}
                  </select>
                  <input
                    aria-label={`${part.label || "Part"}, ${part.unit}`}
                    inputMode="decimal"
                    autoComplete="off"
                    value={part.value}
                    onChange={(event) =>
                      setCustom((list) =>
                        list.map((p) =>
                          p.key === part.key ? { ...p, value: event.target.value } : p,
                        ),
                      )
                    }
                    className={input}
                  />
                  <button
                    type="button"
                    aria-label={`Remove ${part.label || "this part"}`}
                    onClick={() => setCustom((list) => list.filter((p) => p.key !== part.key))}
                    className="text-muted hover:bg-surface-2 grid size-11 place-items-center rounded-full"
                  >
                    <Trash2 aria-hidden className="size-4.5" />
                  </button>
                </div>
              ))}
              <button
                type="button"
                onClick={() =>
                  setCustom((list) => [
                    ...list,
                    {
                      key: Date.now(),
                      label: "",
                      unit: units === "imperial" ? "in" : "cm",
                      value: "",
                    },
                  ])
                }
                className="text-label text-primary inline-flex min-h-11 items-center gap-1.5 self-start px-1"
              >
                <Plus aria-hidden className="size-4" /> Add a part
              </button>
            </>
          ) : (
            <button
              type="button"
              onClick={() => setMoreParts(true)}
              className="text-label text-primary min-h-11 self-start px-1 text-left"
            >
              + More parts (shoulders, forearm, wrist, lengths)
            </button>
          )}
        </Card>
      </div>

      <div className="mt-4 flex max-w-4xl flex-col gap-2">
        {error && (
          <p role="alert" className="text-body text-danger">
            {error}
          </p>
        )}
        {!online && <p className="text-caption text-muted">Saving needs a connection.</p>}
        <Button
          size="lg"
          className="rounded-full"
          loading={busy}
          disabled={!online}
          onClick={() => void save()}
        >
          Save
        </Button>
      </div>

      <BottomSheet
        open={picking}
        onOpenChange={setPicking}
        title="Which day?"
        description="Measurements of an earlier day are saved at noon of that day."
        footer={
          <Button
            size="lg"
            fullWidth
            onClick={() => {
              if (draftDate && draftDate <= today) setDate(draftDate);
              setPicking(false);
            }}
          >
            Done
          </Button>
        }
      >
        <div className="flex flex-col gap-1.5 py-1">
          <label htmlFor={`${id}-date`} className="text-label">
            Date
          </label>
          <input
            id={`${id}-date`}
            type="date"
            max={today}
            value={draftDate}
            onChange={(event) => setDraftDate(event.target.value)}
            className="border-border bg-surface text-body min-h-12 rounded-[var(--radius-control)] border px-3.5"
          />
        </div>
      </BottomSheet>
    </>
  );
};
