import type { Metadata } from "next";

import { AdminView } from "@/components/admin/admin-view";
import { getUsageTotals } from "@/lib/ai/service";
import { listOpenInvites, listUsers } from "@/lib/auth/accounts";
import { requireAdmin } from "@/lib/auth/session";

export const metadata: Metadata = { title: "Admin" };

export default async function AdminPage() {
  const admin = await requireAdmin();
  const [invites, users, usage] = await Promise.all([
    listOpenInvites(),
    listUsers(),
    getUsageTotals(),
  ]);
  return (
    <AdminView
      selfId={admin.id}
      invites={invites.map((i) => ({
        id: i.id,
        note: i.note,
        role: i.role,
        createdAt: i.createdAt.toISOString(),
        expiresAt: i.expiresAt.toISOString(),
      }))}
      users={users.map((u) => ({ ...u, createdAt: u.createdAt.toISOString() }))}
      usage={usage}
    />
  );
}
