"use client";

import { Utensils } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { useCapture } from "@/components/capture/capture-provider";

import { SuggestSheet } from "./suggest-sheet";

/**
 * "What should I eat?" at the top of Today (board 42): opens the suggestions for now. A logged
 * suggestion shows on Today at once; the AI's idea opens the camera as a meal in words.
 */
export const SuggestButton = () => {
  const router = useRouter();
  const { openCamera } = useCapture();
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        aria-haspopup="dialog"
        onClick={() => setOpen(true)}
        className="bg-primary text-on-primary hover:bg-primary-hover shadow-card inline-flex min-h-11 items-center gap-2 rounded-full px-4 text-sm font-bold"
        data-testid="suggest-open"
      >
        <Utensils aria-hidden className="size-4" /> What should I eat?
      </button>
      <SuggestSheet
        open={open}
        onOpenChange={setOpen}
        onLogged={() => router.refresh()}
        onDetails={(mealId) => router.push(`/meals/${mealId}`)}
        onTypeIt={(text) => openCamera("meal", { text })}
      />
    </>
  );
};
