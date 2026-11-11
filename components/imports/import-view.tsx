"use client";

import { ChevronLeft, FileUp, ShieldCheck } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useId, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { useToast } from "@/components/ui/toast";
import { api } from "@/lib/client/api";
import { ACTIVITY_LIMITS, SOURCE_APP_LABELS, type ImportResult } from "@/lib/contracts/activities";
import {
  mappedDataset,
  readImportFiles,
  type ImportDataset,
  type KnownDataset,
  type UnknownDataset,
} from "@/lib/imports/read";
import { deviceTimeZone } from "@/lib/photos/client";
import { longDate } from "@/lib/ui/format";
import { useOnline } from "@/lib/ui/hooks";

import { MappingSheet } from "./mapping-sheet";

export type ImportFrom = "move" | "body";

const BACK: Record<ImportFrom, { href: string; label: string }> = {
  move: { href: "/move", label: "Back to Move" },
  body: { href: "/body", label: "Back to Body" },
};

const rangeText = (dataset: ImportDataset) =>
  dataset.kind === "unknown" || !dataset.first || !dataset.last
    ? null
    : dataset.first === dataset.last
      ? longDate(dataset.first)
      : `${longDate(dataset.first)} to ${longDate(dataset.last)}`;

const resultText = (result: ImportResult) =>
  [
    `${result.added.toLocaleString("en-US")} added`,
    result.updated ? `${result.updated.toLocaleString("en-US")} already there, updated` : null,
    result.skipped ? `${result.skipped.toLocaleString("en-US")} skipped` : null,
  ]
    .filter(Boolean)
    .join(", ");

/**
 * Import a file (Move and Body): a Samsung Health export (the zip or its CSV files), or any other
 * CSV through the column-mapping step. The file is read on this device; only the records go to
 * Kal, in batches. A file imported again updates what it brought the first time.
 */
export const ImportView = ({ from }: { from: ImportFrom }) => {
  const router = useRouter();
  const { show } = useToast();
  const online = useOnline();
  const input = useRef<HTMLInputElement>(null);
  const inputId = useId();
  const [reading, setReading] = useState(false);
  const [datasets, setDatasets] = useState<ImportDataset[]>([]);
  const [notes, setNotes] = useState<string[]>([]);
  const [chosen, setChosen] = useState<Set<string>>(new Set());
  const [mapping, setMapping] = useState<UnknownDataset | null>(null);
  const [progress, setProgress] = useState<string | null>(null);
  const [results, setResults] = useState<Map<string, ImportResult>>(new Map());
  const tz = deviceTimeZone();

  const read = async (files: File[]) => {
    if (!files.length) return;
    setReading(true);
    setResults(new Map());
    try {
      const result = await readImportFiles(files, tz);
      setDatasets(result.datasets);
      setNotes(result.notes);
      setChosen(new Set(result.datasets.filter((d) => d.kind !== "unknown").map((d) => d.id)));
    } finally {
      setReading(false);
    }
  };

  /** One batch of a dataset to its import route. */
  const post = (dataset: KnownDataset, from: number) => {
    const to = from + ACTIVITY_LIMITS.importBatch;
    return dataset.kind === "activities"
      ? api.importActivities(dataset.records.slice(from, to))
      : api.importMeasurements(dataset.records.slice(from, to));
  };

  const send = async () => {
    const picked = datasets.filter(
      (d): d is KnownDataset => d.kind !== "unknown" && chosen.has(d.id),
    );
    const total = picked.reduce((n, d) => n + d.records.length, 0);
    let sent = 0;
    const done = new Map<string, ImportResult>();
    try {
      for (const dataset of picked) {
        const sum: ImportResult = { added: 0, updated: 0, skipped: 0 };
        for (let i = 0; i < dataset.records.length; i += ACTIVITY_LIMITS.importBatch) {
          setProgress(
            `Sending ${sent.toLocaleString("en-US")} of ${total.toLocaleString("en-US")} records…`,
          );
          const result = await post(dataset, i);
          sum.added += result.added;
          sum.updated += result.updated;
          sum.skipped += result.skipped;
          sent += Math.min(ACTIVITY_LIMITS.importBatch, dataset.records.length - i);
        }
        done.set(dataset.id, sum);
        setResults(new Map(done));
      }
      const added = [...done.values()].reduce((n, r) => n + r.added, 0);
      show({
        title: "Imported",
        body: `${added.toLocaleString("en-US")} new records.`,
        tone: "success",
      });
      setChosen(new Set());
      router.refresh();
    } catch (error) {
      show({ title: "The import stopped", body: (error as Error).message, tone: "error" });
    } finally {
      setProgress(null);
    }
  };

  const known = datasets.filter((d): d is KnownDataset => d.kind !== "unknown");
  const unknown = datasets.filter((d): d is UnknownDataset => d.kind === "unknown");

  return (
    <>
      <div className="flex items-center gap-2">
        <Link
          href={BACK[from].href}
          aria-label={BACK[from].label}
          className="bg-surface-2 hover:bg-surface-3 grid size-11 shrink-0 place-items-center rounded-full"
        >
          <ChevronLeft aria-hidden className="size-5" />
        </Link>
        <h1 className="text-title min-w-0 flex-1">Import a file</h1>
      </div>

      <div className="mt-4 flex max-w-2xl flex-col gap-4">
        <Card as="section" aria-labelledby="pick-heading" className="flex flex-col gap-3">
          <h2 id="pick-heading" className="text-headline">
            Choose the export
          </h2>
          <p className="text-body text-muted">
            Samsung Health: in the app, Settings, then Download personal data; pick the zip it
            makes, or the CSV files inside it. Kal reads steps, workouts and weigh-ins from it. A
            Renpho scale: export its data as CSV in the Renpho app. Any other CSV works too: you
            choose its columns.
          </p>
          <p className="text-caption text-muted flex items-start gap-2">
            <ShieldCheck aria-hidden className="text-primary mt-0.5 size-4 shrink-0" />
            The file is read on this device. Only the records go to your Kal server, and to no one
            else.
          </p>
          <input
            ref={input}
            id={inputId}
            type="file"
            accept=".zip,.csv,application/zip,text/csv"
            multiple
            hidden
            data-testid="import-input"
            aria-label="Export files"
            onChange={(event) => {
              const files = Array.from(event.target.files ?? []);
              event.target.value = "";
              void read(files);
            }}
          />
          <Button
            variant="secondary"
            className="self-start rounded-full"
            loading={reading}
            onClick={() => input.current?.click()}
          >
            <FileUp aria-hidden className="size-4" /> Choose files
          </Button>
          {reading && (
            <p role="status" className="text-caption text-muted">
              Reading on this device…
            </p>
          )}
          {notes.length > 0 && (
            <ul className="text-caption text-muted flex flex-col gap-1" data-testid="import-notes">
              {notes.map((note) => (
                <li key={note}>{note}</li>
              ))}
            </ul>
          )}
        </Card>

        {(known.length > 0 || unknown.length > 0) && (
          <Card as="section" aria-labelledby="found-heading" className="flex flex-col gap-3">
            <h2 id="found-heading" className="text-headline">
              Found in the files
            </h2>
            {known.length > 0 && (
              <ul className="flex flex-col gap-2" data-testid="import-datasets">
                {known.map((dataset) => {
                  const result = results.get(dataset.id);
                  const range = rangeText(dataset);
                  return (
                    <li key={dataset.id} className="bg-surface-2 rounded-2xl p-3">
                      <label className="flex min-h-11 items-start gap-3">
                        <input
                          type="checkbox"
                          className="accent-primary mt-1 size-5 shrink-0"
                          checked={chosen.has(dataset.id)}
                          disabled={progress !== null}
                          onChange={(event) =>
                            setChosen((current) => {
                              const next = new Set(current);
                              if (event.target.checked) next.add(dataset.id);
                              else next.delete(dataset.id);
                              return next;
                            })
                          }
                        />
                        <span className="min-w-0 flex-1">
                          <span className="text-label block">{dataset.label}</span>
                          <span className="text-caption text-muted block wrap-break-word">
                            {[range, `from ${SOURCE_APP_LABELS[dataset.app] ?? dataset.fileName}`]
                              .filter(Boolean)
                              .join(" · ")}
                          </span>
                          {result && (
                            <span
                              className="text-caption text-primary block font-semibold"
                              data-testid="import-result"
                            >
                              {resultText(result)}
                            </span>
                          )}
                        </span>
                      </label>
                    </li>
                  );
                })}
              </ul>
            )}
            {unknown.map((dataset) => (
              <div key={dataset.id} className="bg-surface-2 flex flex-col gap-2 rounded-2xl p-3">
                <p className="text-label wrap-break-word">{dataset.fileName}</p>
                <p className="text-caption text-muted">
                  Kal does not know this file&apos;s layout. Say which column holds what.
                </p>
                <Button
                  variant="secondary"
                  className="bg-surface self-start rounded-full"
                  onClick={() => setMapping(dataset)}
                >
                  Choose the columns
                </Button>
              </div>
            ))}
            {known.length > 0 && (
              <>
                <Button
                  size="lg"
                  disabled={!online || progress !== null || ![...chosen].length}
                  loading={progress !== null}
                  onClick={() => void send()}
                >
                  Import
                </Button>
                {progress && (
                  <p role="status" className="text-caption text-muted">
                    {progress}
                  </p>
                )}
                {!online && (
                  <p className="text-caption text-muted">Importing needs a connection.</p>
                )}
              </>
            )}
            {results.size > 0 && (
              <Link href={BACK[from].href} className="text-label text-primary min-h-11 py-2.5">
                {from === "body" ? "See Body" : "See Move"}
              </Link>
            )}
          </Card>
        )}
      </div>

      <MappingSheet
        dataset={mapping}
        tz={tz}
        onClose={() => setMapping(null)}
        onApply={(dataset, chosenMapping, records) => {
          const mapped = mappedDataset(dataset, chosenMapping, records);
          setDatasets((list) => list.map((d) => (d.id === dataset.id ? mapped : d)));
          setChosen((current) => new Set(current).add(mapped.id));
          setMapping(null);
        }}
      />
    </>
  );
};
