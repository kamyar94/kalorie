// Linking a phone against Postgres: one-time codes from the signed-in page, the phone trading a
// code for its token (once, before it expires, with limits), the phone asking about itself,
// unlinking from the web page and from the phone, the proxy letting the app's calls through, and
// export and "Delete my data".
import { sql } from "drizzle-orm";
import { NextRequest } from "next/server";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { db } from "@/db";
import { deviceLinkCodes, devices, users } from "@/db/schema";
import { deleteUserData, exportUserData } from "@/lib/account/data";
import type { SessionUser } from "@/lib/auth/accounts";
import type { DeviceDto, LinkCodeDto } from "@/lib/contracts/devices";
import { proxy } from "@/proxy";
import { createUser } from "@/tests/helpers/factories";

const session = vi.hoisted(() => ({ user: null as SessionUser | null }));
vi.mock("@/lib/auth/session", () => ({ getCurrentUser: async () => session.user }));

const codesRoute = await import("@/app/api/devices/link-codes/route");
const claimRoute = await import("@/app/api/devices/claim/route");
const listRoute = await import("@/app/api/devices/route");
const itemRoute = await import("@/app/api/devices/[id]/route");
const selfRoute = await import("@/app/api/devices/self/route");

const ORIGIN = "http://127.0.0.1:3201";
const HEADERS = { origin: ORIGIN, "x-forwarded-host": "127.0.0.1:3201" };
let ann: SessionUser;
let ben: SessionUser;

const asUser = async () => {
  const row = await createUser();
  return {
    id: row.id,
    username: row.username,
    displayName: row.displayName,
    role: row.role,
    timeZone: row.timeZone,
    units: row.units,
  };
};

const page = (url: string, method = "GET") =>
  new NextRequest(`${ORIGIN}${url}`, { method, headers: HEADERS });

/** A call from the phone: no cookie, no Origin. */
const phone = (url: string, method = "GET", init: { token?: string; body?: unknown } = {}) =>
  new NextRequest(`${ORIGIN}${url}`, {
    method,
    headers: {
      "content-type": "application/json",
      "cf-connecting-ip": "203.0.113.7",
      ...(init.token ? { authorization: `Bearer ${init.token}` } : {}),
    },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });

const newCode = async () => {
  const response = await codesRoute.POST(page("/api/devices/link-codes", "POST"));
  return { status: response.status, body: (await response.json()) as LinkCodeDto };
};

const claim = async (code: string, name = "samsung SM-S928B") => {
  const response = await claimRoute.POST(
    phone("/api/devices/claim", "POST", { body: { code, name, appVersion: "1.0 (1)" } }),
  );
  return {
    status: response.status,
    body: (await response.json()) as { token: string; device: DeviceDto; error?: string },
  };
};

const link = async () => {
  const { body } = await newCode();
  return (await claim(body.code)).body;
};

const self = async (token: string, method = "GET") => {
  const response = await selfRoute[method === "GET" ? "GET" : "DELETE"](
    phone("/api/devices/self", method, { token }),
  );
  return { status: response.status, body: (await response.json()) as Record<string, unknown> };
};

beforeAll(async () => {
  ann = await asUser();
  ben = await asUser();
});

beforeEach(async () => {
  session.user = ann;
  process.env.ANDROID_APP_ID = "app.kal";
  await db.execute(sql`delete from rate_limits`);
});

describe("one-time link codes", () => {
  it("makes a code and the intent URL that opens the app with it", async () => {
    const { status, body } = await newCode();
    expect(status).toBe(201);
    expect(body.code).toMatch(/^[A-Za-z0-9_-]{32}$/);
    expect(body.intentUrl).toBe(
      `intent://link?code=${body.code}#Intent;scheme=kal;package=app.kal;end`,
    );
    const minutes = (new Date(body.expiresAt).getTime() - Date.now()) / 60_000;
    expect(minutes).toBeGreaterThan(9);
    expect(minutes).toBeLessThanOrEqual(10);
    // Only the hash is stored.
    const rows = await db.select().from(deviceLinkCodes);
    expect(rows.some((r) => r.codeHash === body.code)).toBe(false);
  });

  it("says the app is not set up without an app id, and limits codes per hour", async () => {
    delete process.env.ANDROID_APP_ID;
    expect((await newCode()).status).toBe(503);
    process.env.ANDROID_APP_ID = "app.kal";
    for (let i = 0; i < 20; i++) expect((await newCode()).status).toBe(201);
    expect((await newCode()).status).toBe(429);
  });

  it("needs a session and a same-origin request", async () => {
    session.user = null;
    expect((await newCode()).status).toBe(401);
    session.user = ann;
    const crossSite = await codesRoute.POST(
      new NextRequest(`${ORIGIN}/api/devices/link-codes`, {
        method: "POST",
        headers: { origin: "https://elsewhere.example.org", "x-forwarded-host": "127.0.0.1:3201" },
      }),
    );
    expect(crossSite.status).toBe(403);
  });
});

describe("the phone trading a code for its token", () => {
  it("gives a token once, for the code's owner, and keeps only its hash", async () => {
    const { body: code } = await newCode();
    session.user = null;
    const first = await claim(code.code, "  samsung\u0000 SM-S928B\n ");
    expect(first.status).toBe(201);
    expect(first.body.token).toMatch(/^kal_[A-Za-z0-9_-]{43}$/);
    expect(first.body.device).toMatchObject({
      name: "samsung SM-S928B",
      appVersion: "1.0 (1)",
      sends: [],
    });
    const row = (
      await db
        .select()
        .from(devices)
        .where(sql`id = ${first.body.device.id}`)
    )[0]!;
    expect(row.userId).toBe(ann.id);
    expect(row.tokenHash).not.toContain(first.body.token);
    // Used up.
    const again = await claim(code.code);
    expect(again.status).toBe(400);
    expect(again.body.error).toBe(
      "This link has expired or was used. Go back to Kal and tap Connect Health Connect again.",
    );
  });

  it("refuses expired, wrong and malformed codes", async () => {
    const { body: code } = await newCode();
    await db.execute(sql`update device_link_codes set expires_at = now() - interval '1 second'`);
    expect((await claim(code.code)).status).toBe(400);
    expect((await claim("x".repeat(32))).status).toBe(400);
    expect((await claim("short")).status).toBe(400);
    const notJson = await claimRoute.POST(
      new NextRequest(`${ORIGIN}/api/devices/claim`, { method: "POST", body: "code=1" }),
    );
    expect(notJson.status).toBe(400);
  });

  it("limits tries per address", async () => {
    for (let i = 0; i < 20; i++) expect((await claim("y".repeat(32))).status).toBe(400);
    expect((await claim("y".repeat(32))).status).toBe(429);
  });

  it("refuses an eleventh phone and a disabled account", async () => {
    const extra = await asUser();
    session.user = extra;
    for (let i = 0; i < 10; i++) {
      await db.execute(sql`delete from rate_limits`);
      expect((await link()).token).toBeTruthy();
    }
    const { body: code } = await newCode();
    const refused = await claim(code.code);
    expect(refused.status).toBe(409);
    await db
      .update(users)
      .set({ disabled: true })
      .where(sql`id = ${extra.id}`);
    await db.execute(sql`update devices set revoked_at = now() where user_id = ${extra.id}`);
    const { body: other } = await newCode();
    expect((await claim(other.code)).status).toBe(400);
  });
});

describe("linked phones", () => {
  it("lists the person's phones only, and the phone can ask about itself", async () => {
    const { token, device } = await link();
    const listed = (await (await listRoute.GET(page("/api/devices"))).json()) as {
      devices: DeviceDto[];
    };
    expect(listed.devices.map((d) => d.id)).toContain(device.id);
    session.user = ben;
    const others = (await (await listRoute.GET(page("/api/devices"))).json()) as {
      devices: DeviceDto[];
    };
    expect(others.devices.map((d) => d.id)).not.toContain(device.id);
    const me = await self(token);
    expect(me.status).toBe(200);
    expect(me.body.device).toMatchObject({ id: device.id, name: "samsung SM-S928B" });
    expect((await self("kal_" + "a".repeat(43))).status).toBe(401);
    expect((await self("")).status).toBe(401);
  });

  it("unlinks from the web page: the token stops working at once", async () => {
    const { token, device } = await link();
    session.user = ben;
    const ctx = { params: Promise.resolve({ id: device.id }) };
    expect((await itemRoute.DELETE(page(`/api/devices/${device.id}`, "DELETE"), ctx)).status).toBe(
      404,
    );
    expect((await self(token)).status).toBe(200);
    session.user = ann;
    const gone = await itemRoute.DELETE(page(`/api/devices/${device.id}`, "DELETE"), {
      params: Promise.resolve({ id: device.id }),
    });
    expect(gone.status).toBe(200);
    const after = await self(token);
    expect(after.status).toBe(401);
    expect(after.body.error).toBe("Unlinked. Link again.");
    const listed = (await (await listRoute.GET(page("/api/devices"))).json()) as {
      devices: DeviceDto[];
    };
    expect(listed.devices.map((d) => d.id)).not.toContain(device.id);
  });

  it("unlinks from the phone", async () => {
    const { token } = await link();
    expect((await self(token, "DELETE")).status).toBe(200);
    expect((await self(token)).status).toBe(401);
  });

  it("stops working for a disabled account", async () => {
    const extra = await asUser();
    session.user = extra;
    const { token } = await link();
    await db
      .update(users)
      .set({ disabled: true })
      .where(sql`id = ${extra.id}`);
    expect((await self(token)).status).toBe(401);
  });
});

describe("the proxy", () => {
  it("lets the phone's calls through without a cookie or an Origin, and nothing else", () => {
    for (const url of ["/api/devices/claim", "/api/devices/self", "/api/health-connect/sync"]) {
      const response = proxy(phone(url, "POST", { body: {} }));
      expect(response.status, url).toBe(200);
    }
    expect(proxy(phone("/api/devices/link-codes", "POST", { body: {} })).status).toBe(403);
    expect(proxy(phone("/api/devices", "GET")).status).toBe(401);
  });
});

describe("export and Delete my data", () => {
  it("exports the phones without their tokens and removes them with the data", async () => {
    const extra = await asUser();
    session.user = extra;
    const { token } = await link();
    await newCode();
    const data = await exportUserData(extra.id);
    expect(data!.devices).toEqual([
      expect.objectContaining({ name: "samsung SM-S928B", platform: "android", unlinkedAt: null }),
    ]);
    expect(JSON.stringify(data)).not.toContain(token);
    expect(JSON.stringify(data)).not.toMatch(/tokenHash|token_hash/);
    await deleteUserData(extra.id);
    expect((await self(token)).status).toBe(401);
    const left = await db.execute(
      sql`select (select count(*) from devices where user_id = ${extra.id}) as d,
                 (select count(*) from device_link_codes where user_id = ${extra.id}) as c`,
    );
    expect(left.rows[0]).toEqual({ d: "0", c: "0" });
  });
});
