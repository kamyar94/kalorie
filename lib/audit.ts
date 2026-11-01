// The audit log: who did what. Never store secrets, passwords, codes or meal contents here.
import { db as defaultDb, type DbOrTx } from "@/db";
import { auditLog } from "@/db/schema";

export type AuditAction =
  | "signin"
  | "signin.locked"
  | "signout"
  | "invite.create"
  | "invite.accept"
  | "reset.create"
  | "reset.redeem"
  | "user.disable"
  | "user.enable"
  | "user.role"
  | "ai.key.save"
  | "ai.key.delete"
  | "integration.connect"
  | "integration.disconnect"
  | "data.export"
  | "data.delete"
  | (string & {});

export const audit = async (
  entry: {
    userId: string | null;
    action: AuditAction;
    targetType?: string;
    targetId?: string;
    details?: Record<string, unknown>;
  },
  dbx: DbOrTx = defaultDb,
) => {
  await dbx.insert(auditLog).values({
    userId: entry.userId,
    action: entry.action,
    targetType: entry.targetType ?? null,
    targetId: entry.targetId ?? null,
    details: entry.details ?? {},
  });
};
