"use client";

import { X } from "lucide-react";
import Link from "next/link";
import { useState } from "react";

import { useToast } from "@/components/ui/toast";
import { api } from "@/lib/client/api";

/**
 * Board 36: while the person's Health Connect steps come only from the phone's own counter and
 * nothing from Samsung Health has arrived, a note that a watch's steps come through Samsung
 * Health, with the same "How to fix it" steps as Kal for Android. Closing it closes it for good.
 */
export const StepsHint = () => {
  const { show } = useToast();
  const [closed, setClosed] = useState(false);
  if (closed) return null;

  const close = async () => {
    setClosed(true);
    try {
      await api.dismissHint("phone-steps-only");
    } catch (error) {
      setClosed(false);
      show({ title: "Not closed", body: (error as Error).message, tone: "error" });
    }
  };

  return (
    <div
      role="note"
      aria-labelledby="steps-hint-title"
      className="bg-warning-soft border-on-warning-soft/40 flex items-start gap-1 rounded-2xl border py-1 pr-1 pl-3.5"
      data-testid="move-steps-hint"
    >
      <p className="min-w-0 flex-1 py-2 text-sm leading-[1.45]">
        <b id="steps-hint-title" className="text-on-warning-soft">
          Only the phone&apos;s own step counter is sending steps.
        </b>{" "}
        Your watch&apos;s steps come through Samsung Health; check that it may write to Health
        Connect.{" "}
        <Link
          href="/more/android#how-to-fix"
          className="text-on-warning-soft font-semibold underline underline-offset-2"
        >
          How to fix it
        </Link>
      </p>
      <button
        type="button"
        aria-label="Close this hint"
        onClick={() => void close()}
        className="text-on-warning-soft hover:bg-on-warning-soft/10 grid size-11 shrink-0 place-items-center rounded-full"
      >
        <X aria-hidden className="size-5" />
      </button>
    </div>
  );
};
