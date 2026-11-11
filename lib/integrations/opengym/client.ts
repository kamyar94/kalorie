// openGym's API as Kal uses it (the api/openapi.yaml of the openGym project, main branch,
// info.version 1.4.3, read 31 Oct 2026). Kal only reads; it never calls PUT /api/data.
//   POST /api/pair/redeem {code}  no auth; the 8-character code from openGym's "pair the mobile
//        app" (alphabet ABCDEFGHJKLMNPQRSTUVWXYZ23456789, one use, 5 minutes) -> 200
//        {token, user: SessionUser}; 400 {"error": "invalid or expired code", "code": "pair-invalid"}
//   GET  /api/me    Bearer -> 200 {user, token?}; token comes back for a Bearer session past
//        half of its lifetime and replaces the stored one
//   GET  /api/data  Bearer -> 200 {state: State | null, rev}
import { callJson, IntegrationError } from "../http";

export const PAIR_CODE = /^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{8}$/;

export type OpenGymClient = ReturnType<typeof openGymClient>;

const SERVICE = "openGym";

export const openGymClient = (baseUrl: string, timeoutMs = 8000) => ({
  redeem: async (code: string) => {
    const body = await callJson<{ token?: unknown }>(`${baseUrl}/api/pair/redeem`, {
      method: "POST",
      body: { code },
      timeoutMs,
      service: SERVICE,
    });
    if (typeof body?.token !== "string" || !body.token)
      throw new IntegrationError("bad_reply", "openGym sent no token.");
    return body.token;
  },
  me: async (token: string) => {
    const body = await callJson<{ token?: unknown }>(`${baseUrl}/api/me`, {
      token,
      timeoutMs,
      service: SERVICE,
    });
    return { token: typeof body?.token === "string" && body.token ? body.token : null };
  },
  data: async (token: string) => {
    const body = await callJson<{ state?: unknown; rev?: unknown }>(`${baseUrl}/api/data`, {
      token,
      timeoutMs: Math.max(timeoutMs, 15_000),
      service: SERVICE,
    });
    return { state: body?.state ?? null, rev: typeof body?.rev === "number" ? body.rev : 0 };
  },
});
