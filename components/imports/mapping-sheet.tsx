"use client";

import { useState } from "react";

import { BottomSheet } from "@/components/ui/bottom-sheet";
import { Button } from "@/components/ui/button";
import { SelectField } from "@/components/ui/select-field";
import type { DateOrder } from "@/lib/imports/dates";
import {
  applyMapping,
  guessFields,
  guessMapping,
  MAPPING_FIELDS,
  MAPPING_KINDS,
  type ColumnMapping,
  type MappedRecords,
  type MappingKind,
} from "@/lib/imports/mapping";
import type { UnknownDataset } from "@/lib/imports/read";

const ORDERS: { value: DateOrder; label: string }[] = [
  { value: "ymd", label: "Year first (2026-11-10)" },
  { value: "dmy", label: "Day first (10/11/2026)" },
  { value: "mdy", label: "Month first (11/10/2026)" },
];

const NONE = "";

const rows = (n: number) => `${n.toLocaleString("en-US")} ${n === 1 ? "row" : "rows"}`;

/**
 * The column-mapping step (a CSV Kal does not know): what the file holds, the date (and time)
 * column, and the column of each value, pre-selected from the column names. The first rows read
 * with the choice are shown before anything is imported.
 */
export const MappingSheet = ({
  dataset,
  tz,
  onClose,
  onApply,
}: {
  dataset: UnknownDataset | null;
  tz: string;
  onClose: () => void;
  onApply: (dataset: UnknownDataset, mapping: ColumnMapping, records: MappedRecords) => void;
}) => {
  const [mapping, setMapping] = useState<ColumnMapping | null>(null);
  const [shownFor, setShownFor] = useState<UnknownDataset | null>(null);
  if (dataset !== shownFor) {
    setShownFor(dataset);
    setMapping(dataset ? guessMapping(dataset.headers, dataset.rows) : null);
  }

  const columns = (dataset?.headers ?? []).map((header, index) => ({
    value: String(index),
    label: header.trim() || `Column ${index + 1}`,
  }));
  const optional = [{ value: NONE, label: "None" }, ...columns];
  const records = dataset && mapping ? applyMapping(dataset.rows, mapping, tz) : null;
  const required = mapping
    ? MAPPING_FIELDS[mapping.kind]
        .filter((f) => f.required)
        .every((f) => mapping.fields[f.id] != null)
    : false;
  // Measurements count by weigh-in (one row can hold several values).
  const count = !records
    ? 0
    : mapping?.kind === "measurements"
      ? new Set(records.measurements.map((m) => m.measuredAt)).size
      : records.activities.length;

  const set = (patch: Partial<ColumnMapping>) =>
    setMapping((current) => (current ? { ...current, ...patch } : current));
  const setField = (field: string, value: string) =>
    setMapping((current) =>
      current
        ? {
            ...current,
            fields: { ...current.fields, [field]: value === NONE ? null : Number(value) },
          }
        : current,
    );

  return (
    <BottomSheet
      open={dataset !== null}
      onOpenChange={(open) => !open && onClose()}
      title="Choose the columns"
      description={
        dataset ? `${dataset.fileName}: Kal reads it with the columns you choose.` : undefined
      }
      footer={
        <Button
          size="lg"
          fullWidth
          disabled={!required || count === 0}
          onClick={() => dataset && mapping && records && onApply(dataset, mapping, records)}
        >
          {count ? `Use ${rows(count)}` : "Nothing to use yet"}
        </Button>
      }
    >
      {mapping && dataset && (
        <div className="flex flex-col gap-3 py-1">
          <SelectField
            label="What does the file hold?"
            options={MAPPING_KINDS.map((k) => ({ value: k.id, label: k.label }))}
            value={mapping.kind}
            onChange={(event) => {
              const kind = event.target.value as MappingKind;
              const taken = new Set([
                mapping.date,
                ...(mapping.time !== null ? [mapping.time] : []),
              ]);
              set({ kind, fields: guessFields(dataset.headers, kind, taken) });
            }}
          />
          <div className="grid grid-cols-2 gap-2.5">
            <SelectField
              label="Date"
              options={columns}
              value={String(mapping.date)}
              onChange={(event) => set({ date: Number(event.target.value) })}
            />
            <SelectField
              label="Time (if apart)"
              options={optional}
              value={mapping.time === null ? NONE : String(mapping.time)}
              onChange={(event) =>
                set({ time: event.target.value === NONE ? null : Number(event.target.value) })
              }
            />
          </div>
          <SelectField
            label="Dates are written"
            options={ORDERS}
            value={mapping.order}
            onChange={(event) => set({ order: event.target.value as DateOrder })}
          />
          {mapping.kind === "measurements" && (
            <SelectField
              label="Weights are in"
              options={[
                { value: "kg", label: "Kilograms (kg)" },
                { value: "lb", label: "Pounds (lb)" },
              ]}
              value={mapping.massUnit ?? "kg"}
              onChange={(event) => set({ massUnit: event.target.value as "kg" | "lb" })}
            />
          )}
          {MAPPING_FIELDS[mapping.kind].map((field) => (
            <SelectField
              key={field.id}
              label={field.required ? field.label : `${field.label} (optional)`}
              options={
                field.required ? [{ value: NONE, label: "Choose a column" }, ...columns] : optional
              }
              value={mapping.fields[field.id] == null ? NONE : String(mapping.fields[field.id])}
              onChange={(event) => setField(field.id, event.target.value)}
            />
          ))}
          <div className="bg-surface-2 rounded-2xl p-3" data-testid="mapping-preview">
            <p className="text-label">
              {count
                ? `${rows(count)} read, ${records!.skipped.toLocaleString("en-US")} skipped`
                : "No rows can be read with these columns yet."}
            </p>
            {records?.measurements.slice(0, 3).map((record) => (
              <p key={record.externalId} className="text-caption text-muted">
                {record.measuredAt.slice(0, 10)}: {record.code.replace("_", " ")} {record.value}
              </p>
            ))}
            {records?.activities.slice(0, 3).map((record) => (
              <p key={record.externalId} className="text-caption text-muted">
                {record.localDate}:{" "}
                {record.steps
                  ? `${record.steps.toLocaleString("en-US")} steps`
                  : `${record.title}, ${Math.round(record.durationMin ?? 0)} min`}
              </p>
            ))}
          </div>
        </div>
      )}
    </BottomSheet>
  );
};
