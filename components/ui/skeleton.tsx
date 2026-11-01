import { cn } from "./cn";

/** A placeholder block shown while content loads. */
export const Skeleton = ({ className }: { className?: string }) => (
  <div aria-hidden className={cn("animate-pulse-soft bg-surface-3 rounded-lg", className)} />
);
