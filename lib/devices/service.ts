// Linked phones (CONTRACT: lib/contracts/devices.ts). Codes and tokens are random and stored only
// as SHA-256. Every function that takes a user id touches only that person's rows.
import crypto from "node:crypto";

import { and, count, desc, eq, gt, isNull, lte, or, isNotNull, sql } from "drizzle-orm";

import { db as defaultDb, type DbOrTx } from "@/db";
import { deviceLinkCodes, devices, users } from "@/db/schema";
import { audit } from "@/lib/audit";
import { sha256Hex } from "@/lib/crypto";
import { DEVICE_LIMITS, isSendKind, SEND_KINDS, type DeviceDto } from "@/lib/contracts/devices";
import { isUuid } from "@/lib/meals/service";

type DeviceRow = typeof devices.$inferSelect;

export const toDeviceDto = (row: DeviceRow): DeviceDto => ({
  id: row.id,
  name: row.name,
  appVersion: row.appVersion,
  createdAt: row.createdAt.toISOString(),
  lastSeenAt: row.lastSeenAt?.toISOString() ?? null,
  lastSyncAt: row.lastSyncAt?.toISOString() ?? null,
  sends: SEND_KINDS.filter((k) => row.sends.includes(k)),
});

/** One-time codes and device tokens: URL-safe base64 of random bytes. */
const CODE_PATTERN = /^[A-Za-z0-9_-]{20,128}$/;
const TOKEN_PATTERN = /^kal_[A-Za-z0-9_-]{40,100}$/;

/** "Samsung SM-S928B": one line, no control characters, at most 80 characters. */
export const cleanDeviceName = (value: unknown) => {
  const text =
    typeof value === "string"
      ? value
          .replace(/[\p{Cc}\p{Cf}]/gu, " ")
          .replace(/\s+/g, " ")
          .trim()
          .slice(0, DEVICE_LIMITS.nameChars)
      : "";
  return text || "Android phone";
};

const cleanVersion = (value: unknown) =>
  typeof value === "string" && /^[\w .()+-]{1,40}$/.test(value) ? value.trim() : null;

/** A new one-time code for the signed-in person; their used and expired codes are removed. */
export const createLinkCode = async (userId: string, dbx: DbOrTx = defaultDb) => {
  const code = crypto.randomBytes(24).toString("base64url");
  const expiresAt = new Date(Date.now() + DEVICE_LIMITS.codeMinutes * 60_000);
  await dbx
    .delete(deviceLinkCodes)
    .where(
      and(
        eq(deviceLinkCodes.userId, userId),
        or(isNotNull(deviceLinkCodes.usedAt), lte(deviceLinkCodes.expiresAt, sql`now()`)),
      ),
    );
  await dbx.insert(deviceLinkCodes).values({ codeHash: sha256Hex(code), userId, expiresAt });
  return { code, expiresAt: expiresAt.toISOString() };
};

export type ClaimResult =
  { token: string; device: DeviceDto } | "invalid" | "too-many" | "disabled";

/**
 * Trades a one-time code for a device token (shown once, to the phone). The code is used up even
 * when the account has too many phones, so it cannot be tried again.
 */
export const claimLinkCode = async (
  code: unknown,
  input: { name?: unknown; appVersion?: unknown },
  dbx: DbOrTx = defaultDb,
): Promise<ClaimResult> => {
  if (typeof code !== "string" || !CODE_PATTERN.test(code)) return "invalid";
  return dbx.transaction(async (tx) => {
    const [used] = await tx
      .update(deviceLinkCodes)
      .set({ usedAt: sql`now()` })
      .where(
        and(
          eq(deviceLinkCodes.codeHash, sha256Hex(code)),
          isNull(deviceLinkCodes.usedAt),
          gt(deviceLinkCodes.expiresAt, sql`now()`),
        ),
      )
      .returning({ userId: deviceLinkCodes.userId });
    if (!used) return "invalid";
    const owner = (
      await tx
        .select({ disabled: users.disabled })
        .from(users)
        .where(eq(users.id, used.userId))
        .limit(1)
    )[0];
    if (!owner || owner.disabled) return "disabled";
    const [active] = await tx
      .select({ n: count() })
      .from(devices)
      .where(and(eq(devices.userId, used.userId), isNull(devices.revokedAt)));
    if ((active?.n ?? 0) >= DEVICE_LIMITS.maxDevices) return "too-many";
    const token = `kal_${crypto.randomBytes(32).toString("base64url")}`;
    const [row] = await tx
      .insert(devices)
      .values({
        userId: used.userId,
        name: cleanDeviceName(input.name),
        appVersion: cleanVersion(input.appVersion),
        tokenHash: sha256Hex(token),
        lastSeenAt: new Date(),
      })
      .returning();
    await audit(
      { userId: used.userId, action: "device.link", targetType: "device", targetId: row!.id },
      tx,
    );
    return { token, device: toDeviceDto(row!) };
  });
};

export type DeviceOwner = { device: DeviceRow; user: { id: string; timeZone: string } };

/**
 * The linked phone a token belongs to, with its owner; null for an unknown or revoked token or a
 * disabled account. Notes the time it was last seen.
 */
export const deviceForToken = async (
  token: string,
  dbx: DbOrTx = defaultDb,
): Promise<DeviceOwner | null> => {
  if (!TOKEN_PATTERN.test(token)) return null;
  const [found] = await dbx
    .select({ device: devices, user: { id: users.id, timeZone: users.timeZone } })
    .from(devices)
    .innerJoin(users, eq(users.id, devices.userId))
    .where(
      and(
        eq(devices.tokenHash, sha256Hex(token)),
        isNull(devices.revokedAt),
        eq(users.disabled, false),
      ),
    )
    .limit(1);
  if (!found) return null;
  const now = new Date();
  await dbx.update(devices).set({ lastSeenAt: now }).where(eq(devices.id, found.device.id));
  return { device: { ...found.device, lastSeenAt: now }, user: found.user };
};

/** The person's linked phones, newest first (unlinked ones are left out). */
export const listDevices = async (userId: string, dbx: DbOrTx = defaultDb) => {
  if (!isUuid(userId)) return [];
  const rows = await dbx
    .select()
    .from(devices)
    .where(and(eq(devices.userId, userId), isNull(devices.revokedAt)))
    .orderBy(desc(devices.createdAt));
  return rows.map(toDeviceDto);
};

/** Unlinks a phone: its token stops working at once. False for an unknown or unlinked id. */
export const revokeDevice = async (userId: string, id: string, dbx: DbOrTx = defaultDb) => {
  if (!isUuid(userId) || !isUuid(id)) return false;
  const gone = await dbx
    .update(devices)
    .set({ revokedAt: new Date() })
    .where(and(eq(devices.id, id), eq(devices.userId, userId), isNull(devices.revokedAt)))
    .returning({ id: devices.id });
  if (!gone.length) return false;
  await audit({ userId, action: "device.unlink", targetType: "device", targetId: id }, dbx);
  return true;
};

/** After a sync: the time, the app's version, and what the phone has sent so far. */
export const markDeviceSynced = async (
  device: DeviceRow,
  sent: string[],
  appVersion: unknown,
  dbx: DbOrTx = defaultDb,
) => {
  const sends = SEND_KINDS.filter((k) => device.sends.includes(k) || sent.includes(k));
  await dbx
    .update(devices)
    .set({
      lastSyncAt: new Date(),
      sends: sends.filter(isSendKind),
      appVersion: cleanVersion(appVersion) ?? device.appVersion,
    })
    .where(eq(devices.id, device.id));
};
