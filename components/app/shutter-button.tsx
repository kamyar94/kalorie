"use client";

import { Camera } from "lucide-react";
import { forwardRef, type ButtonHTMLAttributes } from "react";

import { cn } from "@/components/ui/cn";

/**
 * The one big capture button. Fixed above the navigation, centred, within thumb reach on phones;
 * at the lower right on wide screens. TodayCapture (today-capture.tsx) opens the in-app camera
 * with it.
 */
export const ShutterButton = forwardRef<
  HTMLButtonElement,
  ButtonHTMLAttributes<HTMLButtonElement> & { busy?: boolean }
>(function ShutterButton({ className, busy, children, ...props }, ref) {
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-[calc(var(--spacing-nav)+env(safe-area-inset-bottom)+1rem)] z-30 flex justify-center md:inset-x-auto md:right-8 md:bottom-8">
      <button
        ref={ref}
        type="button"
        aria-label="Take a photo of a meal"
        aria-busy={busy || undefined}
        className={cn(
          "bg-primary text-on-primary shadow-raised ring-bg hover:bg-primary-hover pointer-events-auto grid size-[4.5rem] place-items-center rounded-full ring-4 transition-transform duration-150 active:scale-95 disabled:opacity-60",
          busy && "animate-pulse-soft",
          className,
        )}
        {...props}
      >
        {children ?? <Camera aria-hidden className="size-8" strokeWidth={2.2} />}
      </button>
    </div>
  );
});
