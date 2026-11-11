import type { Metadata } from "next";

import { InviteForm } from "./invite-form";

export const metadata: Metadata = { title: "Accept an invite" };

export default async function InvitePage({
  searchParams,
}: {
  searchParams: Promise<{ code?: string | string[] }>;
}) {
  const raw = (await searchParams).code;
  const code = (Array.isArray(raw) ? raw[0] : raw)?.slice(0, 40) ?? "";
  return (
    <>
      <h1 className="text-title">Join Kal</h1>
      <p className="text-muted mt-1 mb-6">
        Choose how you sign in. Your meals and photos are visible only to you.
      </p>
      <InviteForm code={code} />
    </>
  );
}
