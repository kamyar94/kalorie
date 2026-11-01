"use server";

// Admin actions: invites, account state and reset codes. Every action checks the admin role
// itself. Codes are returned once, to the admin who made them; only their hashes are stored.
import { revalidatePath } from "next/cache";

import type { UserRole } from "@/db/schema";
import {
  createInvite,
  createResetCode,
  revokeInvite,
  setUserDisabled,
  unlockUser,
} from "@/lib/auth/accounts";
import { requireAdmin } from "@/lib/auth/session";
import { isUuid } from "@/lib/meals/service";

export type AdminResult<T = null> = { ok: true; data: T } | { ok: false; error: string };

export const createInviteAction = async (input: {
  role: string;
  note: string;
  days: number;
}): Promise<AdminResult<{ code: string; expiresAt: string }>> => {
  const admin = await requireAdmin();
  const role: UserRole = input.role === "admin" ? "admin" : "member";
  const days = Math.min(7, Math.max(1, Math.round(Number(input.days) || 7)));
  const { code, expiresAt } = await createInvite({
    role,
    note: String(input.note ?? "")
      .trim()
      .slice(0, 80),
    days,
    createdBy: admin.id,
  });
  revalidatePath("/admin");
  return { ok: true, data: { code, expiresAt: expiresAt.toISOString() } };
};

export const revokeInviteAction = async (id: number): Promise<AdminResult> => {
  await requireAdmin();
  if (!Number.isInteger(id) || id <= 0) return { ok: false, error: "Unknown invite." };
  await revokeInvite(id);
  revalidatePath("/admin");
  return { ok: true, data: null };
};

export const setDisabledAction = async (
  userId: string,
  disabled: boolean,
): Promise<AdminResult> => {
  const admin = await requireAdmin();
  if (!isUuid(userId)) return { ok: false, error: "Unknown account." };
  if (userId === admin.id) return { ok: false, error: "You cannot block your own account." };
  await setUserDisabled({ userId, disabled, by: admin.id });
  revalidatePath("/admin");
  return { ok: true, data: null };
};

export const resetCodeAction = async (
  userId: string,
): Promise<AdminResult<{ code: string; expiresAt: string }>> => {
  const admin = await requireAdmin();
  if (!isUuid(userId)) return { ok: false, error: "Unknown account." };
  const { code, expiresAt } = await createResetCode({ userId, createdBy: admin.id });
  return { ok: true, data: { code, expiresAt: expiresAt.toISOString() } };
};

export const unlockAction = async (userId: string): Promise<AdminResult> => {
  await requireAdmin();
  if (!isUuid(userId)) return { ok: false, error: "Unknown account." };
  await unlockUser(userId);
  revalidatePath("/admin");
  return { ok: true, data: null };
};
