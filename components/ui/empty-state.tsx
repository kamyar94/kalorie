import type { ReactNode } from "react";

import { cn } from "./cn";

/** What a screen shows when it has nothing yet: an icon, a short title, one helpful line, and the
 * next step. */
export const EmptyState = ({
  icon,
  title,
  body,
  action,
  className,
}: {
  icon?: ReactNode;
  title: string;
  body?: string;
  action?: ReactNode;
  className?: string;
}) => (
  <div className={cn("flex flex-col items-center px-6 py-10 text-center", className)}>
    {icon && (
      <div
        aria-hidden
        className="bg-primary-soft text-on-primary-soft mb-4 grid size-16 place-items-center rounded-full"
      >
        {icon}
      </div>
    )}
    <h2 className="text-headline">{title}</h2>
    {body && <p className="text-body text-muted mt-1 max-w-xs">{body}</p>}
    {action && <div className="mt-5">{action}</div>}
  </div>
);
