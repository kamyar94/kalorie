"use client";

import * as Dialog from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import type { ReactNode } from "react";

import { cn } from "./cn";

export type BottomSheetProps = {
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  /** Element that opens the sheet (rendered as the trigger, keeps its own look). */
  trigger?: ReactNode;
  title: string;
  /** Hidden visually when false, still read by screen readers. */
  showTitle?: boolean;
  description?: string;
  children: ReactNode;
  footer?: ReactNode;
  className?: string;
};

/**
 * A panel that slides up from the bottom on phones and appears centred on wide screens. Focus is
 * trapped inside, Escape and the scrim close it, and it keeps clear of the home-indicator area.
 */
export const BottomSheet = ({
  open,
  onOpenChange,
  trigger,
  title,
  showTitle = true,
  description,
  children,
  footer,
  className,
}: BottomSheetProps) => (
  <Dialog.Root open={open} onOpenChange={onOpenChange}>
    {trigger && <Dialog.Trigger asChild>{trigger}</Dialog.Trigger>}
    <Dialog.Portal>
      <Dialog.Overlay className="bg-scrim data-[state=closed]:animate-fade-out data-[state=open]:animate-fade-in fixed inset-0 z-40" />
      <Dialog.Content
        className={cn(
          "border-border bg-surface shadow-raised fixed inset-x-0 bottom-0 z-50 flex max-h-[92dvh] flex-col rounded-t-[1.75rem] border outline-none",
          "data-[state=closed]:animate-sheet-out data-[state=open]:animate-sheet-in",
          "md:data-[state=closed]:animate-fade-out md:data-[state=open]:animate-fade-in md:inset-x-auto md:top-1/2 md:bottom-auto md:left-1/2 md:w-[min(32rem,calc(100vw-2rem))] md:-translate-x-1/2 md:-translate-y-1/2 md:rounded-[1.75rem]",
          className,
        )}
      >
        <div
          aria-hidden
          className="bg-surface-3 mx-auto mt-2.5 h-1.5 w-10 shrink-0 rounded-full md:hidden"
        />
        <div className="flex items-start gap-2 px-5 pt-3">
          <div className="min-w-0 flex-1 pt-2">
            <Dialog.Title className={cn("text-headline", !showTitle && "sr-only")}>
              {title}
            </Dialog.Title>
            {description ? (
              <Dialog.Description className="text-caption text-muted mt-0.5">
                {description}
              </Dialog.Description>
            ) : (
              <Dialog.Description className="sr-only">{title}</Dialog.Description>
            )}
          </div>
          <Dialog.Close
            className="text-muted hover:bg-surface-2 -mr-2 grid size-11 shrink-0 place-items-center rounded-full"
            aria-label="Close"
          >
            <X aria-hidden className="size-5" />
          </Dialog.Close>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 pt-2 pb-4">
          {children}
        </div>
        {footer ? (
          <div className="safe-bottom border-border border-t px-5 pt-3 pb-3">{footer}</div>
        ) : (
          <div className="safe-bottom" />
        )}
      </Dialog.Content>
    </Dialog.Portal>
  </Dialog.Root>
);
