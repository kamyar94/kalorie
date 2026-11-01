"use client";

import { useState } from "react";

import { BottomSheet } from "@/components/ui/bottom-sheet";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { deviceTimeZone } from "@/lib/photos/client";
import { fromLocalInputValue, toLocalInputValue } from "@/lib/ui/format";

/** "I ate this again": a copy of the meal now, or at another day and time. */
export const AgainSheet = ({
  open,
  onOpenChange,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: (when: { eatenAt: string; tz: string }) => Promise<void>;
}) => {
  const [tz, setTz] = useState("UTC");
  const [when, setWhen] = useState("");
  const [busy, setBusy] = useState<"now" | "pick" | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [wasOpen, setWasOpen] = useState(false);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) {
      const zone = deviceTimeZone();
      setTz(zone);
      setWhen(toLocalInputValue(new Date().toISOString(), zone));
      setError(null);
    }
  }

  const run = async (kind: "now" | "pick") => {
    const eatenAt = kind === "now" ? new Date().toISOString() : fromLocalInputValue(when, tz);
    if (!eatenAt) return setError("Pick a valid day and time.");
    if (new Date(eatenAt).getTime() > Date.now() + 5 * 60_000)
      return setError("The time cannot be in the future.");
    setBusy(kind);
    try {
      await onConfirm({ eatenAt, tz });
    } finally {
      setBusy(null);
    }
  };

  return (
    <BottomSheet
      open={open}
      onOpenChange={onOpenChange}
      title="I ate this again"
      description="Logs the same foods and amounts again. You can change them afterwards."
    >
      <div className="flex flex-col gap-4 py-1">
        <Button size="lg" fullWidth loading={busy === "now"} onClick={() => void run("now")}>
          Log it now
        </Button>
        <div className="border-border flex flex-col gap-3 border-t pt-4">
          <Field
            label="Or pick a day and time"
            type="datetime-local"
            value={when}
            max={toLocalInputValue(new Date().toISOString(), tz)}
            onChange={(event) => setWhen(event.target.value)}
          />
          <Button
            variant="secondary"
            size="lg"
            fullWidth
            loading={busy === "pick"}
            onClick={() => void run("pick")}
          >
            Log it at this time
          </Button>
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
