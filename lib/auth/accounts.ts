// Accounts, sign-in, invites and reset codes (adapted from the Lingo project). Plain functions
// over the database, without Next.js, so they are tested directly; lib/auth/session.ts and the
// server actions in app/(auth) wrap them with cookies and redirects.
import crypto from "node:crypto";

import { and, asc, eq, gt, isNull, lt, sql } from "drizzle-orm";

import { db as defaultDb, type DbOrTx } from "@/db";
import { invites, resetCodes, sessions, users, type UserRole } from "@/db/schema";
import { audit } from "@/lib/audit";
import { isRateLimited, recordRateHit, SIGNIN_IP_WINDOW } from "@/lib/rate-limit";

import { CODE_DAYS_DEFAULT, CODE_DAYS_MAX, hashCode, newCode } from "./codes";
import { burnPasswordCheck, hashPassword, passwordProblem, verifyPassword } from "./password";

const num = (name: string, fallback: number) => {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? value : fallback;
};

export const loginPolicy = {
  maxAttempts: num("MAX_LOGIN_ATTEMPTS", 5),
  lockMinutes: num("LOGIN_LOCK_MINUTES", 15),
  sessionDays: num("SESSION_DAYS", 30),
};

export const USERNAME_PATTERN = /^[a-z0-9._-]{3,32}$/;
export const USERNAME_RULE =
  "Usernames are 3 to 32 characters: lowercase letters, numbers, dot, dash or underscore.";

export const TOO_MANY = "Too many attempts from this network. Wait 15 minutes and try again.";
export const WRONG = "Wrong username or password.";

const ipBucket = (ip: string) => `signin-ip:${ip}`;

export type Failure = {
  ok: false;
  error: string;
  reason: "bad" | "locked" | "limited" | "invalid";
};
export type Success = { ok: true; userId: string };

const fail = (error: string, reason: Failure["reason"]): Failure => ({ ok: false, error, reason });

// ---- Sessions ----

export const sha256 = (value: string) => crypto.createHash("sha256").update(value).digest("hex");

/** Makes a session row and returns the cookie value (only its hash is stored). */
export const createSession = async (userId: string, dbx: DbOrTx = defaultDb) => {
  const token = crypto.randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + loginPolicy.sessionDays * 86_400_000);
  await dbx.insert(sessions).values({ id: sha256(token), userId, expiresAt });
  return { token, expiresAt };
};

export const deleteSession = async (token: string, dbx: DbOrTx = defaultDb) => {
  await dbx.delete(sessions).where(eq(sessions.id, sha256(token)));
};

export type SessionUser = {
  id: string;
  username: string;
  displayName: string;
  role: UserRole;
  timeZone: string;
  units: "metric" | "imperial";
};

/** The account behind a session cookie value, or null when it is unknown, expired or disabled. */
export const findSessionUser = async (
  token: string,
  dbx: DbOrTx = defaultDb,
): Promise<SessionUser | null> => {
  if (!token || token.length > 100) return null;
  const rows = await dbx
    .select({
      id: users.id,
      username: users.username,
      displayName: users.displayName,
      role: users.role,
      timeZone: users.timeZone,
      units: users.units,
      disabled: users.disabled,
    })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(and(eq(sessions.id, sha256(token)), gt(sessions.expiresAt, new Date())))
    .limit(1);
  const row = rows[0];
  if (!row || row.disabled) return null;
  const { disabled: _disabled, ...user } = row;
  return user;
};

// ---- Sign-in ----

/**
 * Checks a username and password. Five wrong passwords lock the account for 15 minutes; every
 * failure also counts against the address (20 per 15 minutes).
 */
export const authenticate = async (
  input: { username: string; password: string; ip: string },
  dbx: DbOrTx = defaultDb,
): Promise<Success | Failure> => {
  const username = input.username.trim().toLowerCase();
  const { password, ip } = input;

  if (!(await isRateLimited(ipBucket(ip), SIGNIN_IP_WINDOW, dbx)).ok)
    return fail(TOO_MANY, "limited");

  const user = (await dbx.select().from(users).where(eq(users.username, username)).limit(1))[0];

  if (!user || user.disabled) {
    await burnPasswordCheck(password);
    await recordRateHit(ipBucket(ip), SIGNIN_IP_WINDOW, dbx);
    return fail(WRONG, "bad");
  }

  if (user.lockedUntil && user.lockedUntil > new Date())
    return fail(
      `This account is locked after too many wrong passwords. Try again in ${loginPolicy.lockMinutes} minutes.`,
      "locked",
    );

  if (!(await verifyPassword(password, user.passwordHash))) {
    await recordRateHit(ipBucket(ip), SIGNIN_IP_WINDOW, dbx);
    const failed = user.failedLogins + 1;
    const lock = failed >= loginPolicy.maxAttempts;
    await dbx
      .update(users)
      .set({
        failedLogins: lock ? 0 : failed,
        lockedUntil: lock ? new Date(Date.now() + loginPolicy.lockMinutes * 60_000) : null,
      })
      .where(eq(users.id, user.id));
    if (lock) {
      await audit({ userId: user.id, action: "signin.locked" }, dbx);
      return fail(
        `This account is locked after too many wrong passwords. Try again in ${loginPolicy.lockMinutes} minutes.`,
        "locked",
      );
    }
    return fail(WRONG, "bad");
  }

  await dbx.update(users).set({ failedLogins: 0, lockedUntil: null }).where(eq(users.id, user.id));
  // Sign-ins that have run out are removed now and then, so the table stays small.
  await dbx.delete(sessions).where(lt(sessions.expiresAt, new Date()));
  await audit({ userId: user.id, action: "signin" }, dbx);
  return { ok: true, userId: user.id };
};

// ---- Invites ----

const clampDays = (days?: number) => {
  const value = days ?? CODE_DAYS_DEFAULT;
  if (!Number.isFinite(value) || value <= 0 || value > CODE_DAYS_MAX)
    throw new Error(`Days must be between 1 and ${CODE_DAYS_MAX}.`);
  return value;
};

/** A single-use sign-up code. The plain code is returned once; only its hash is stored. */
export const createInvite = async (
  input: { role?: UserRole; note?: string; days?: number; createdBy?: string | null },
  dbx: DbOrTx = defaultDb,
) => {
  const code = newCode();
  const expiresAt = new Date(Date.now() + clampDays(input.days) * 86_400_000);
  const [row] = await dbx
    .insert(invites)
    .values({
      codeHash: code.hash,
      note: (input.note ?? "").slice(0, 80),
      role: input.role ?? "member",
      createdBy: input.createdBy ?? null,
      expiresAt,
    })
    .returning({ id: invites.id });
  await audit(
    {
      userId: input.createdBy ?? null,
      action: "invite.create",
      targetType: "invite",
      targetId: String(row!.id),
      details: { role: input.role ?? "member" },
    },
    dbx,
  );
  return { code: code.plain, expiresAt };
};

/** Whether an invite code can still be used (for the invite page, before the form is filled). */
export const checkInvite = async (code: string, dbx: DbOrTx = defaultDb) => {
  const row = (
    await dbx
      .select({ id: invites.id, role: invites.role })
      .from(invites)
      .where(
        and(
          eq(invites.codeHash, hashCode(code)),
          isNull(invites.usedAt),
          gt(invites.expiresAt, new Date()),
        ),
      )
      .limit(1)
  )[0];
  return row ?? null;
};

/** Creates the account for an invite code and uses the code up. */
export const acceptInvite = async (
  input: { code: string; username: string; displayName: string; password: string; ip: string },
  dbx: DbOrTx = defaultDb,
): Promise<Success | Failure> => {
  const username = input.username.trim().toLowerCase();
  const displayName = input.displayName.trim();

  if (!(await isRateLimited(ipBucket(input.ip), SIGNIN_IP_WINDOW, dbx)).ok)
    return fail(TOO_MANY, "limited");
  if (!displayName || displayName.length > 40)
    return fail("Enter your name (up to 40 characters).", "invalid");
  if (!USERNAME_PATTERN.test(username)) return fail(USERNAME_RULE, "invalid");
  const problem = passwordProblem(input.password);
  if (problem) return fail(problem, "invalid");

  const invite = await checkInvite(input.code, dbx);
  if (!invite) {
    await recordRateHit(ipBucket(input.ip), SIGNIN_IP_WINDOW, dbx);
    return fail("This code is not valid, has expired, or was already used.", "bad");
  }

  const taken = await dbx.select({ id: users.id }).from(users).where(eq(users.username, username));
  if (taken.length) return fail("That username is taken. Pick another one.", "invalid");

  const passwordHash = await hashPassword(input.password);
  const run = async (tx: DbOrTx) => {
    const [user] = await tx
      .insert(users)
      .values({ username, displayName, passwordHash, role: invite.role })
      .onConflictDoNothing()
      .returning({ id: users.id });
    if (!user) return null;
    const claimed = await tx
      .update(invites)
      .set({ usedAt: new Date(), usedBy: user.id })
      .where(and(eq(invites.id, invite.id), isNull(invites.usedAt)))
      .returning({ id: invites.id });
    if (!claimed.length) throw new InviteRace();
    await audit(
      {
        userId: user.id,
        action: "invite.accept",
        targetType: "invite",
        targetId: String(invite.id),
      },
      tx,
    );
    return user.id;
  };

  try {
    const userId = await dbx.transaction(run);
    if (!userId) return fail("That username is taken. Pick another one.", "invalid");
    return { ok: true, userId };
  } catch (error) {
    if (error instanceof InviteRace) return fail("This code was already used.", "bad");
    throw error;
  }
};

class InviteRace extends Error {}

// ---- Password reset codes ----

/** A single-use code with which one account chooses a new password. */
export const createResetCode = async (
  input: { userId: string; days?: number; createdBy?: string | null },
  dbx: DbOrTx = defaultDb,
) => {
  const code = newCode();
  const expiresAt = new Date(Date.now() + clampDays(input.days ?? 2) * 86_400_000);
  await dbx.insert(resetCodes).values({
    codeHash: code.hash,
    userId: input.userId,
    createdBy: input.createdBy ?? null,
    expiresAt,
  });
  await audit(
    {
      userId: input.createdBy ?? null,
      action: "reset.create",
      targetType: "user",
      targetId: input.userId,
    },
    dbx,
  );
  return { code: code.plain, expiresAt };
};

/** Sets a new password with a reset code; every old sign-in of the account ends. */
export const redeemResetCode = async (
  input: { code: string; password: string; ip: string },
  dbx: DbOrTx = defaultDb,
): Promise<Success | Failure> => {
  if (!(await isRateLimited(ipBucket(input.ip), SIGNIN_IP_WINDOW, dbx)).ok)
    return fail(TOO_MANY, "limited");
  const problem = passwordProblem(input.password);
  if (problem) return fail(problem, "invalid");

  const row = (
    await dbx
      .select({ id: resetCodes.id, userId: resetCodes.userId })
      .from(resetCodes)
      .innerJoin(users, eq(users.id, resetCodes.userId))
      .where(
        and(
          eq(resetCodes.codeHash, hashCode(input.code)),
          isNull(resetCodes.usedAt),
          gt(resetCodes.expiresAt, new Date()),
          eq(users.disabled, false),
        ),
      )
      .limit(1)
  )[0];
  if (!row) {
    await recordRateHit(ipBucket(input.ip), SIGNIN_IP_WINDOW, dbx);
    return fail("This code is not valid, has expired, or was already used.", "bad");
  }

  const passwordHash = await hashPassword(input.password);
  const run = async (tx: DbOrTx) => {
    const claimed = await tx
      .update(resetCodes)
      .set({ usedAt: new Date() })
      .where(and(eq(resetCodes.id, row.id), isNull(resetCodes.usedAt)))
      .returning({ id: resetCodes.id });
    if (!claimed.length) return false;
    await tx
      .update(users)
      .set({ passwordHash, failedLogins: 0, lockedUntil: null })
      .where(eq(users.id, row.userId));
    await tx.delete(sessions).where(eq(sessions.userId, row.userId));
    await audit({ userId: row.userId, action: "reset.redeem" }, tx);
    return true;
  };
  const done = await dbx.transaction(run);
  if (!done) return fail("This code was already used.", "bad");
  return { ok: true, userId: row.userId };
};

// ---- Admin ----

export type UserListRow = {
  id: string;
  username: string;
  displayName: string;
  role: UserRole;
  disabled: boolean;
  locked: boolean;
  createdAt: Date;
  activeSessions: number;
  meals: number;
};

/** Accounts for the admin page: names, state and counts, never meal contents. */
export const listUsers = async (dbx: DbOrTx = defaultDb): Promise<UserListRow[]> => {
  const rows = await dbx
    .select({
      id: users.id,
      username: users.username,
      displayName: users.displayName,
      role: users.role,
      disabled: users.disabled,
      lockedUntil: users.lockedUntil,
      createdAt: users.createdAt,
      activeSessions: sql<number>`(select count(*)::int from sessions s where s.user_id = "users"."id" and s.expires_at > now())`,
      meals: sql<number>`(select count(*)::int from meals m where m.user_id = "users"."id" and m.deleted_at is null)`,
    })
    .from(users)
    .orderBy(asc(users.createdAt));
  const now = new Date();
  return rows.map(({ lockedUntil, ...row }) => ({
    ...row,
    locked: !!lockedUntil && lockedUntil > now,
  }));
};

/** Blocks or allows an account; blocking ends its sign-ins. */
export const setUserDisabled = async (
  input: { userId: string; disabled: boolean; by?: string | null },
  dbx: DbOrTx = defaultDb,
) => {
  await dbx.update(users).set({ disabled: input.disabled }).where(eq(users.id, input.userId));
  if (input.disabled) await dbx.delete(sessions).where(eq(sessions.userId, input.userId));
  await audit(
    {
      userId: input.by ?? null,
      action: input.disabled ? "user.disable" : "user.enable",
      targetType: "user",
      targetId: input.userId,
    },
    dbx,
  );
};

export const setUserRole = async (
  input: { userId: string; role: UserRole; by?: string | null },
  dbx: DbOrTx = defaultDb,
) => {
  await dbx.update(users).set({ role: input.role }).where(eq(users.id, input.userId));
  await audit(
    {
      userId: input.by ?? null,
      action: "user.role",
      targetType: "user",
      targetId: input.userId,
      details: { role: input.role },
    },
    dbx,
  );
};

export const unlockUser = async (userId: string, dbx: DbOrTx = defaultDb) => {
  await dbx.update(users).set({ failedLogins: 0, lockedUntil: null }).where(eq(users.id, userId));
};

/** Unused codes that have not expired, for the admin page. */
export const listOpenInvites = async (dbx: DbOrTx = defaultDb) =>
  dbx
    .select({
      id: invites.id,
      note: invites.note,
      role: invites.role,
      createdAt: invites.createdAt,
      expiresAt: invites.expiresAt,
    })
    .from(invites)
    .where(and(isNull(invites.usedAt), gt(invites.expiresAt, new Date())))
    .orderBy(asc(invites.createdAt));

/** Ends an unused invite before it expires. */
export const revokeInvite = async (id: number, dbx: DbOrTx = defaultDb) => {
  await dbx
    .update(invites)
    .set({ expiresAt: new Date() })
    .where(and(eq(invites.id, id), isNull(invites.usedAt)));
};
