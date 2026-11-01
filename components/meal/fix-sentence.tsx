"use client";

import { Sparkles } from "lucide-react";
import { useId, useState } from "react";

import { Button } from "@/components/ui/button";

/**
 * "Fix with a sentence": the person says what is wrong ("it was chicken, not beef", "only half
 * the rice") and the analysis runs again with it. Their own item edits stay unless they ask.
 */
export const FixSentence = ({
  disabled,
  onSubmit,
}: {
  disabled?: boolean;
  onSubmit: (text: string, replaceEdits: boolean) => Promise<boolean>;
}) => {
  const [text, setText] = useState("");
  const [replace, setReplace] = useState(false);
  const [busy, setBusy] = useState(false);
  const id = useId();
  return (
    <form
      aria-labelledby={`${id}-h`}
      className="flex flex-col gap-2"
      onSubmit={async (event) => {
        event.preventDefault();
        if (!text.trim()) return;
        setBusy(true);
        try {
          if (await onSubmit(text.trim(), replace)) {
            setText("");
            setReplace(false);
          }
        } finally {
          setBusy(false);
        }
      }}
    >
      <h2 id={`${id}-h`} className="text-headline inline-flex items-center gap-2">
        <Sparkles aria-hidden className="text-primary size-5" /> Fix with a sentence
      </h2>
      <label htmlFor={`${id}-text`} className="text-caption text-muted">
        Say what is different, for example &quot;it was chicken, not beef&quot; or &quot;I ate only
        half the rice&quot;.
      </label>
      <div className="flex gap-2">
        <input
          id={`${id}-text`}
          dir="auto"
          maxLength={300}
          value={text}
          disabled={disabled}
          onChange={(event) => setText(event.target.value)}
          className="border-border bg-surface text-body focus:border-primary min-h-12 min-w-0 flex-1 rounded-[var(--radius-control)] border px-3.5 focus:outline-none focus-visible:outline-3 focus-visible:outline-offset-0 focus-visible:outline-[var(--focus)] disabled:opacity-60"
        />
        <Button type="submit" size="lg" disabled={disabled || !text.trim()} loading={busy}>
          Fix
        </Button>
      </div>
      {/* The whole label is the touch target: 44 px high, with room around the box on every side. */}
      <label className="text-caption text-muted -ml-2.5 inline-flex min-h-11 cursor-pointer items-center gap-2 self-start pr-2 pl-2.5">
        <input
          type="checkbox"
          checked={replace}
          onChange={(event) => setReplace(event.target.checked)}
          className="size-6 shrink-0 cursor-pointer accent-[var(--primary)]"
        />
        Also replace the changes I made by hand
      </label>
    </form>
  );
};
