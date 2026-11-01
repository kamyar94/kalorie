import { WifiOff } from "lucide-react";
import type { Metadata } from "next";

import { EmptyState } from "@/components/ui/empty-state";

export const metadata: Metadata = { title: "Offline" };

// Shown by the service worker when a page cannot load without a connection. Holds no personal
// data, so it is safe to keep in the cache.
export default function OfflinePage() {
  return (
    <main id="main" className="mx-auto flex min-h-dvh max-w-sm flex-col justify-center px-4">
      <EmptyState
        icon={<WifiOff className="size-7" />}
        title="You are offline"
        body="Cal needs a connection to show this page. Meals you capture are kept on this device and sent when you are back online."
        action={
          <a
            href="/today"
            className="bg-primary text-label text-on-primary inline-flex min-h-11 items-center rounded-[var(--radius-control)] px-5"
          >
            Try again
          </a>
        }
      />
    </main>
  );
}
