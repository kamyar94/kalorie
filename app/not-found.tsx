import Link from "next/link";

import { EmptyState } from "@/components/ui/empty-state";

export default function NotFound() {
  return (
    <main id="main" className="mx-auto flex min-h-dvh max-w-sm flex-col justify-center px-4">
      <EmptyState
        title="Page not found"
        body="This page does not exist or is not yours to see."
        action={
          <Link
            href="/today"
            className="bg-primary text-label text-on-primary inline-flex min-h-11 items-center rounded-[var(--radius-control)] px-5"
          >
            Back to today
          </Link>
        }
      />
    </main>
  );
}
