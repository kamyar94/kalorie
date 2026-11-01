"use client";

import { Download, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { deleteMyDataAction } from "@/app/(app)/settings/actions";
import { BottomSheet } from "@/components/ui/bottom-sheet";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Field } from "@/components/ui/field";
import { useToast } from "@/components/ui/toast";

/** Export everything (CSV or JSON) and delete my data, behind a typed confirmation. */
export const DataSection = () => {
  const router = useRouter();
  const { show } = useToast();
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const remove = async () => {
    setBusy(true);
    const result = await deleteMyDataAction(typed);
    setBusy(false);
    if (!result.ok) return setError(result.error);
    setOpen(false);
    setTyped("");
    show({ title: "Your data was deleted", tone: "neutral" });
    router.push("/today");
    router.refresh();
  };

  return (
    <Card as="section" aria-labelledby="data-heading" className="flex flex-col gap-3">
      <h2 id="data-heading" className="text-headline">
        Your data
      </h2>
      <p className="text-caption text-muted">
        Download every meal, item and food you added. Photos stay on the server.
      </p>
      <div className="flex flex-wrap gap-2">
        <Button asChild variant="secondary">
          <a href="/api/export?format=csv" download>
            <Download aria-hidden className="size-4" /> Export CSV
          </a>
        </Button>
        <Button asChild variant="secondary">
          <a href="/api/export?format=json" download>
            <Download aria-hidden className="size-4" /> Export JSON
          </a>
        </Button>
      </div>
      <div className="border-border mt-1 border-t pt-3">
        <Button variant="ghost" className="text-danger -ml-2" onClick={() => setOpen(true)}>
          <Trash2 aria-hidden className="size-4" /> Delete my data
        </Button>
      </div>
      <BottomSheet
        open={open}
        onOpenChange={(next) => {
          setOpen(next);
          setError(null);
          setTyped("");
        }}
        title="Delete all your data?"
        description="Every meal, photo, item, food you added, AI key and connection is removed for good. Your account stays so you can start again."
        footer={
          <div className="grid grid-cols-2 gap-2">
            <Button variant="secondary" size="lg" onClick={() => setOpen(false)}>
              Keep my data
            </Button>
            <Button
              variant="danger"
              size="lg"
              loading={busy}
              disabled={typed.trim().toLowerCase() !== "delete"}
              onClick={() => void remove()}
            >
              Delete
            </Button>
          </div>
        }
      >
        <div className="flex flex-col gap-2 py-1">
          <p className="text-body">Export first if you want a copy.</p>
          <Field
            label='Type "delete" to confirm'
            autoComplete="off"
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
          />
          {error && (
            <p role="alert" className="text-body text-danger">
              {error}
            </p>
          )}
        </div>
      </BottomSheet>
    </Card>
  );
};
