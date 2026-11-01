// Invites, sign-in with lockout and the per-address limit, reset codes, sessions, the server tool.
import { eq, sql } from "drizzle-orm";
import pg from "pg";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { db } from "@/db";
import { auditLog, invites, sessions, users } from "@/db/schema";
import {
  acceptInvite,
  authenticate,
  checkInvite,
  createInvite,
  createResetCode,
  createSession,
  findSessionUser,
  listUsers,
  redeemResetCode,
  setUserDisabled,
} from "@/lib/auth/accounts";
import { clearRateLimit } from "@/lib/rate-limit";
import { runCommand } from "@/scripts/cal.mjs";

const PASSWORD = "a long enough password";
let ipCounter = 0;
const freshIp = () => `10.0.0.${++ipCounter}`;

const join = async (username: string, role?: "admin" | "member") => {
  const { code } = await createInvite({ role, note: username });
  const result = await acceptInvite({
    code,
    username,
    displayName: username,
    password: PASSWORD,
    ip: freshIp(),
  });
  if (!result.ok) throw new Error(result.error);
  return result.userId;
};

beforeEach(async () => {
  await db.execute(sql`delete from rate_limits`);
});

describe("invites", () => {
  it("create an account once, then never again", async () => {
    const { code, expiresAt } = await createInvite({ note: "Ann" });
    expect(expiresAt.getTime() - Date.now()).toBeGreaterThan(6.9 * 86_400_000);
    expect(await checkInvite(code.toLowerCase())).not.toBeNull();

    const first = await acceptInvite({
      code,
      username: "Ann.B",
      displayName: "Ann",
      password: PASSWORD,
      ip: freshIp(),
    });
    expect(first.ok).toBe(true);
    const user = (await db.select().from(users).where(eq(users.username, "ann.b")))[0]!;
    expect(user.role).toBe("member");
    expect(user.passwordHash).not.toContain(PASSWORD);

    const again = await acceptInvite({
      code,
      username: "other",
      displayName: "O",
      password: PASSWORD,
      ip: freshIp(),
    });
    expect(again).toMatchObject({ ok: false, reason: "bad" });
    const row = (await db.select().from(invites))[0]!;
    expect(row.codeHash).not.toContain(code.replace(/-/g, ""));
    expect(row.usedBy).toBe(user.id);
  });

  it("refuse expired codes, weak passwords, bad usernames and taken names", async () => {
    const { code } = await createInvite({});
    await db.update(invites).set({ expiresAt: new Date(Date.now() - 1000) });
    expect(
      (
        await acceptInvite({
          code,
          username: "late",
          displayName: "L",
          password: PASSWORD,
          ip: freshIp(),
        })
      ).ok,
    ).toBe(false);

    const fresh = (await createInvite({})).code;
    expect(
      await acceptInvite({
        code: fresh,
        username: "ok",
        displayName: "O",
        password: "short",
        ip: freshIp(),
      }),
    ).toMatchObject({ reason: "invalid" });
    expect(
      await acceptInvite({
        code: fresh,
        username: "a b",
        displayName: "O",
        password: PASSWORD,
        ip: freshIp(),
      }),
    ).toMatchObject({ reason: "invalid" });
    await join("taken");
    expect(
      await acceptInvite({
        code: fresh,
        username: "taken",
        displayName: "T",
        password: PASSWORD,
        ip: freshIp(),
      }),
    ).toMatchObject({ error: expect.stringMatching(/taken/) });
    // The failed tries did not use the code up.
    expect(await checkInvite(fresh)).not.toBeNull();
  });

  it("can make admins", async () => {
    const id = await join("boss", "admin");
    expect((await db.select().from(users).where(eq(users.id, id)))[0]!.role).toBe("admin");
  });
});

describe("sign-in", () => {
  it("accepts the right password, case-insensitive username", async () => {
    const id = await join("carol");
    expect(await authenticate({ username: " CAROL ", password: PASSWORD, ip: freshIp() })).toEqual({
      ok: true,
      userId: id,
    });
  });

  it("locks the account for 15 minutes after five wrong passwords", async () => {
    const id = await join("dave");
    const ip = freshIp();
    for (let i = 0; i < 4; i++)
      expect(
        await authenticate({ username: "dave", password: "wrong password!", ip }),
      ).toMatchObject({ reason: "bad" });
    expect(await authenticate({ username: "dave", password: "wrong password!", ip })).toMatchObject(
      { reason: "locked" },
    );
    // Even the right password is refused while locked.
    expect(
      await authenticate({ username: "dave", password: PASSWORD, ip: freshIp() }),
    ).toMatchObject({ reason: "locked" });
    const user = (await db.select().from(users).where(eq(users.id, id)))[0]!;
    expect(user.lockedUntil!.getTime() - Date.now()).toBeGreaterThan(14 * 60_000);
    // After the lock runs out the right password works again.
    await db
      .update(users)
      .set({ lockedUntil: new Date(Date.now() - 1000) })
      .where(eq(users.id, id));
    expect((await authenticate({ username: "dave", password: PASSWORD, ip: freshIp() })).ok).toBe(
      true,
    );
    const actions = (await db.select().from(auditLog).where(eq(auditLog.userId, id))).map(
      (r) => r.action,
    );
    expect(actions).toContain("signin.locked");
  });

  it("blocks an address after 20 failures, whatever the usernames", async () => {
    const ip = freshIp();
    await join("erin");
    for (let i = 0; i < 20; i++) await authenticate({ username: `nobody${i}`, password: "x", ip });
    expect(await authenticate({ username: "erin", password: PASSWORD, ip })).toMatchObject({
      reason: "limited",
    });
    expect((await authenticate({ username: "erin", password: PASSWORD, ip: freshIp() })).ok).toBe(
      true,
    );
    await clearRateLimit(`signin-ip:${ip}`);
    expect((await authenticate({ username: "erin", password: PASSWORD, ip })).ok).toBe(true);
  });

  it("refuses disabled accounts and ends their sessions", async () => {
    const id = await join("frank");
    const { token } = await createSession(id);
    expect((await findSessionUser(token))?.username).toBe("frank");
    await setUserDisabled({ userId: id, disabled: true });
    expect(await findSessionUser(token)).toBeNull();
    expect(
      await authenticate({ username: "frank", password: PASSWORD, ip: freshIp() }),
    ).toMatchObject({ ok: false });
  });
});

describe("sessions", () => {
  it("store only the hash of the cookie and expire", async () => {
    const id = await join("gina");
    const { token } = await createSession(id);
    const row = (await db.select().from(sessions).where(eq(sessions.userId, id)))[0]!;
    expect(row.id).not.toBe(token);
    expect(row.id).toMatch(/^[0-9a-f]{64}$/);
    expect(await findSessionUser(row.id)).toBeNull();
    await db
      .update(sessions)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(sessions.userId, id));
    expect(await findSessionUser(token)).toBeNull();
    expect(await findSessionUser("")).toBeNull();
  });
});

describe("reset codes", () => {
  it("set a new password once and end every old sign-in", async () => {
    const id = await join("hank");
    const { token } = await createSession(id);
    const { code } = await createResetCode({ userId: id });
    const NEW = "a brand new password";
    expect((await redeemResetCode({ code, password: NEW, ip: freshIp() })).ok).toBe(true);
    expect(await findSessionUser(token)).toBeNull();
    expect((await authenticate({ username: "hank", password: PASSWORD, ip: freshIp() })).ok).toBe(
      false,
    );
    expect((await authenticate({ username: "hank", password: NEW, ip: freshIp() })).ok).toBe(true);
    expect((await redeemResetCode({ code, password: "another password", ip: freshIp() })).ok).toBe(
      false,
    );
  });
});

describe("admin views", () => {
  it("list accounts with counts, never meal contents", async () => {
    await join("ivy");
    const rows = await listUsers();
    const ivy = rows.find((r) => r.username === "ivy")!;
    expect(Object.keys(ivy).sort()).toEqual(
      [
        "activeSessions",
        "createdAt",
        "disabled",
        "displayName",
        "id",
        "locked",
        "meals",
        "role",
        "username",
      ].sort(),
    );
  });
});

describe("server tool", () => {
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
  afterAll(() => pool.end());

  it("makes invite codes the web form accepts, and lists, locks out and resets users", async () => {
    const lines: string[] = [];
    const { code } = await runCommand(
      pool,
      ["invite", "--note", "Jo", "--admin", "--days", "3"],
      (l: string) => lines.push(l),
    );
    expect(lines[0]).toMatch(/\(ADMIN\)/);
    const joined = await acceptInvite({
      code,
      username: "joanna",
      displayName: "Jo",
      password: PASSWORD,
      ip: freshIp(),
    });
    expect(joined).toMatchObject({ ok: true });
    expect((await db.select().from(users).where(eq(users.username, "joanna")))[0]!.role).toBe(
      "admin",
    );

    const out: string[] = [];
    await runCommand(pool, ["users"], (l: string) => out.push(l));
    expect(out.join("\n")).toMatch(/joanna\s+Jo\s.*admin/);

    const reset = await runCommand(pool, ["reset", "joanna"], () => undefined);
    expect(
      (await redeemResetCode({ code: reset.code, password: "jo's new password", ip: freshIp() }))
        .ok,
    ).toBe(true);

    await runCommand(pool, ["disable", "joanna"], () => undefined);
    expect((await db.select().from(users).where(eq(users.username, "joanna")))[0]!.disabled).toBe(
      true,
    );
    await expect(runCommand(pool, ["unlock", "nobody"], () => undefined)).rejects.toThrow(
      /No account/,
    );
    // The food commands are wired in (their own tests import fixtures).
    await expect(
      runCommand(pool, ["import-fdc", "--only", "branded"], () => undefined),
    ).rejects.toThrow(/Unknown dataset/);
    await expect(runCommand(pool, ["seed-dishes"], () => undefined)).rejects.toThrow(/import-fdc/);
  });
});
