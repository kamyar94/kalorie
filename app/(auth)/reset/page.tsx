import type { Metadata } from "next";

import { ResetForm } from "./reset-form";

export const metadata: Metadata = { title: "New password" };

export default async function ResetPage({
  searchParams,
}: {
  searchParams: Promise<{ code?: string | string[] }>;
}) {
  const raw = (await searchParams).code;
  const code = (Array.isArray(raw) ? raw[0] : raw)?.slice(0, 40) ?? "";
  return (
    <>
      <h1 className="text-title">Choose a new password</h1>
      <p className="text-muted mt-1 mb-6">Use the reset code you were given.</p>
      <ResetForm code={code} />
    </>
  );
}
