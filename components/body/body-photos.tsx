"use client";

import { Camera, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useId, useState } from "react";

import { useCapture } from "@/components/capture/capture-provider";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { useToast } from "@/components/ui/toast";
import { api } from "@/lib/client/api";
import type { WeightEntryDto } from "@/lib/contracts/body";
import {
  BODY_PHOTO_NOTICE,
  BODY_POSES,
  POSE_LABELS,
  type BodyPose,
  type BodySessionDto,
} from "@/lib/contracts/body-photos";
import { longDate, shortDate } from "@/lib/ui/format";

import { showValue, type Units } from "./format";

/**
 * Body photos (board 11): two days side by side for one pose (the first and the latest set unless
 * others are chosen), each with that day's weight; a photo opens at full size. "Take today's 4
 * photos" opens the camera on its Body tab.
 */
export const BodyPhotos = ({
  sessions,
  weights,
  units,
  today,
}: {
  /** Newest first. */
  sessions: BodySessionDto[];
  weights: WeightEntryDto[];
  units: Units;
  today: string;
}) => {
  const router = useRouter();
  const { show } = useToast();
  const { openCamera } = useCapture();
  const id = useId();
  const [pose, setPose] = useState<BodyPose>("front");
  const [before, setBefore] = useState<string | null>(null);
  const [after, setAfter] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const dates = sessions.map((s) => s.localDate);
  const afterDate = after && dates.includes(after) ? after : (dates[0] ?? null);
  const beforeDate = before && dates.includes(before) ? before : (dates.at(-1) ?? null);
  const shown = [beforeDate, afterDate]
    .filter((d, i, all): d is string => d !== null && all.indexOf(d) === i)
    .map((d) => sessions.find((s) => s.localDate === d)!);

  const weightOn = (date: string) => weights.find((w) => w.date <= date) ?? null;

  const remove = async (photoId: string) => {
    setBusy(photoId);
    try {
      await api.deleteBodyPhoto(photoId);
      show({ title: "Photo removed", tone: "success" });
      router.refresh();
    } catch (error) {
      show({ title: "Not removed", body: (error as Error).message, tone: "error" });
    } finally {
      setBusy(null);
    }
  };

  const options = dates.map((d) => ({ value: d, label: longDate(d, today) }));

  return (
    <Card as="section" aria-labelledby={`${id}-heading`} className="flex flex-col gap-2.5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id={`${id}-heading`} className="text-body font-semibold">
          Photos
        </h2>
        {sessions.length > 0 && (
          <SegmentedControl
            label="Pose"
            value={pose}
            onValueChange={setPose}
            options={BODY_POSES.map((p) => ({ value: p, label: POSE_LABELS[p] }))}
            className="rounded-full [&>*]:rounded-full"
          />
        )}
      </div>

      {sessions.length > 1 && (
        <div className="grid grid-cols-2 gap-2">
          {(
            [
              ["Before", beforeDate, setBefore],
              ["After", afterDate, setAfter],
            ] as const
          ).map(([label, value, set]) => (
            <div key={label} className="flex min-w-0 flex-col gap-1">
              <label htmlFor={`${id}-${label}`} className="text-caption text-muted">
                {label}
              </label>
              <select
                id={`${id}-${label}`}
                value={value ?? ""}
                onChange={(event) => set(event.target.value)}
                className="border-border bg-surface text-label min-h-11 min-w-0 rounded-[var(--radius-control)] border px-2.5"
              >
                {options.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </div>
          ))}
        </div>
      )}

      {shown.length > 0 ? (
        <div className="grid grid-cols-2 gap-2" data-testid="body-photo-compare">
          {shown.map((session) => {
            const photo = session.photos.find((p) => p.pose === pose);
            const weight = weightOn(session.localDate);
            const caption = [
              shortDate(session.localDate),
              weight ? showValue(weight.kg, "kg", 1, units) : null,
            ]
              .filter(Boolean)
              .join(" · ");
            return (
              <figure key={session.id} className="m-0 flex min-w-0 flex-col gap-1">
                {photo ? (
                  <a
                    href={photo.urls.original}
                    target="_blank"
                    rel="noopener"
                    className="bg-surface-2 block aspect-[3/4] overflow-hidden rounded-[0.875rem]"
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element -- authenticated same-origin photo */}
                    <img
                      src={photo.urls.view}
                      alt={`${POSE_LABELS[pose]} photo, ${longDate(session.localDate, today)}. Opens at full size`}
                      className="size-full object-cover"
                      loading="lazy"
                    />
                  </a>
                ) : (
                  <div className="bg-surface-2 text-caption text-muted grid aspect-[3/4] place-items-center rounded-[0.875rem] p-2 text-center">
                    No {POSE_LABELS[pose].toLowerCase()} photo that day
                  </div>
                )}
                <figcaption className="text-caption text-muted text-center">{caption}</figcaption>
                {photo && (
                  <button
                    type="button"
                    disabled={busy !== null}
                    onClick={() => void remove(photo.id)}
                    aria-label={`Remove the ${POSE_LABELS[pose].toLowerCase()} photo of ${longDate(session.localDate, today)}`}
                    className="text-caption text-muted hover:bg-surface-2 inline-flex min-h-11 items-center justify-center gap-1 rounded-full disabled:opacity-50"
                  >
                    <Trash2 aria-hidden className="size-4" /> Remove
                  </button>
                )}
              </figure>
            );
          })}
        </div>
      ) : (
        <p className="text-body text-muted">
          No body photos yet. Front, left, back and right every few weeks show how your shape
          changes.
        </p>
      )}
      {sessions.length === 1 && (
        <p className="text-caption text-muted">Take the next set in a few weeks to compare.</p>
      )}

      <Button variant="secondary" className="rounded-full" onClick={() => openCamera("body")}>
        <Camera aria-hidden className="size-4" /> Take today&apos;s 4 photos
      </Button>
      <p className="text-caption text-muted">{BODY_PHOTO_NOTICE}</p>
    </Card>
  );
};
