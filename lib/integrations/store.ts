// The integrations table: one row per person and kind with the credential encrypted like AI keys
// (lib/crypto.ts, AES-256-GCM bound to the account and the kind), a settings object for cached
// data (openGym weigh-ins and workouts, Mealie recipe nutrition), a status and the last sync.
// Every function takes the user id first; another person's row is never read or changed.
import { and, eq } from "drizzle-orm";

import { db as defaultDb, type DbOrTx } from "@/db";
import { integrations } from "@/db/schema";
import { decryptSecret, encryptSecret, integrationContext } from "@/lib/crypto";
import type {
  IntegrationKind,
  IntegrationStatusDto,
  WeightPointDto,
} from "@/lib/contracts/integrations";

import { baseUrlFor } from "./config";

export type IntegrationRow = typeof integrations.$inferSelect;

const own = (userId: string, kind: IntegrationKind) =>
  and(eq(integrations.userId, userId), eq(integrations.kind, kind));

export const getIntegrationRow = async (
  userId: string,
  kind: IntegrationKind,
  dbx: DbOrTx = defaultDb,
): Promise<IntegrationRow | null> =>
  (await dbx.select().from(integrations).where(own(userId, kind)).limit(1))[0] ?? null;

/** The decrypted credential, or null (none stored, or it no longer decrypts). */
export const credentialOf = (row: IntegrationRow | null) => {
  if (!row?.encryptedCredential) return null;
  try {
    return decryptSecret(row.encryptedCredential, integrationContext(row.userId, row.kind));
  } catch {
    return null;
  }
};

export const readCredential = async (
  userId: string,
  kind: IntegrationKind,
  dbx: DbOrTx = defaultDb,
) => credentialOf(await getIntegrationRow(userId, kind, dbx));

/** Stores a new credential (encrypted) with status ok; settings are replaced when given. */
export const saveCredential = async (
  userId: string,
  kind: IntegrationKind,
  credential: string,
  settings: Record<string, unknown> | undefined,
  dbx: DbOrTx = defaultDb,
) => {
  const encrypted = encryptSecret(credential, integrationContext(userId, kind));
  const values = {
    encryptedCredential: encrypted,
    status: "ok" as const,
    statusMessage: null,
    ...(settings ? { settings } : {}),
  };
  await dbx
    .insert(integrations)
    .values({ userId, kind, ...values, settings: settings ?? {} })
    .onConflictDoUpdate({ target: [integrations.userId, integrations.kind], set: values });
};

/** Changes status, message, settings or the sync time of an existing row. */
export const updateIntegration = async (
  userId: string,
  kind: IntegrationKind,
  patch: Partial<Pick<IntegrationRow, "status" | "statusMessage" | "settings" | "lastSyncAt">>,
  dbx: DbOrTx = defaultDb,
) => {
  await dbx.update(integrations).set(patch).where(own(userId, kind));
};

/** Forgets the credential and everything cached for it. */
export const removeIntegration = async (
  userId: string,
  kind: IntegrationKind,
  dbx: DbOrTx = defaultDb,
) => {
  const rows = await dbx
    .delete(integrations)
    .where(own(userId, kind))
    .returning({ id: integrations.id });
  return rows.length > 0;
};

const KINDS: IntegrationKind[] = ["mealie", "opengym"];

/** The latest weigh-in cached by the openGym sync. */
export const latestWeightOf = (row: IntegrationRow | null): WeightPointDto | null => {
  const value = (row?.settings as { latestWeight?: unknown } | undefined)?.latestWeight;
  if (!value || typeof value !== "object") return null;
  const { date, kg } = value as Record<string, unknown>;
  return typeof date === "string" && typeof kg === "number" && kg > 0 ? { date, kg } : null;
};

/** Connection state of each integration, for the settings page. */
export const getIntegrationStatuses = async (
  userId: string,
  dbx: DbOrTx = defaultDb,
): Promise<IntegrationStatusDto[]> => {
  const rows = await dbx.select().from(integrations).where(eq(integrations.userId, userId));
  return KINDS.map((kind) => {
    const row = rows.find((r) => r.kind === kind) ?? null;
    return {
      kind,
      available: baseUrlFor(kind) !== null,
      connected: !!row?.encryptedCredential,
      status: row?.status ?? "disconnected",
      message: row?.statusMessage ?? null,
      lastSyncAt: row?.lastSyncAt?.toISOString() ?? null,
      latestWeight: kind === "opengym" ? latestWeightOf(row) : null,
    };
  });
};
