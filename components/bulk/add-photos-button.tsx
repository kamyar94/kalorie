"use client";

import { Images } from "lucide-react";
import { useRef } from "react";

import { useCapture } from "@/components/capture/capture-provider";

/**
 * "Add photos" at the top of Today (board 44): picks many photos from the gallery and opens the
 * screen that sorts them into meals. On an earlier day, photos with no time taken start on it.
 */
export const AddPhotosButton = ({ date, today }: { date: string; today: string }) => {
  const { openBulk } = useCapture();
  const input = useRef<HTMLInputElement>(null);
  return (
    <>
      <button
        type="button"
        aria-haspopup="dialog"
        onClick={() => input.current?.click()}
        className="bg-surface-2 text-text hover:bg-surface-3 shadow-card inline-flex min-h-11 items-center gap-2 rounded-full px-4 text-sm font-bold"
        data-testid="bulk-open"
      >
        <Images aria-hidden className="size-4" /> Add photos
      </button>
      <input
        ref={input}
        type="file"
        accept="image/*"
        multiple
        hidden
        aria-label="Photos to add"
        data-testid="bulk-input"
        onChange={(event) => {
          const files = Array.from(event.target.files ?? []);
          event.target.value = "";
          if (files.length) openBulk(files, { day: date === today ? null : date });
        }}
      />
    </>
  );
};
