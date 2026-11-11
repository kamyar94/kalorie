import type { Metadata } from "next";

import { ImportView, type ImportFrom } from "@/components/imports/import-view";
import { requireUser } from "@/lib/auth/session";

export const metadata: Metadata = { title: "Import a file" };

export default async function ImportPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string | string[] }>;
}) {
  await requireUser();
  const from = (await searchParams).from;
  return <ImportView from={(from === "body" ? "body" : "move") satisfies ImportFrom} />;
}
