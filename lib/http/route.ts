// Helpers for API route handlers: JSON answers, the signed-in user, and the same-origin check
// (proxy.ts checks it too; routes repeat it so a changed matcher cannot open them).
import { NextResponse } from "next/server";

import type { SessionUser } from "@/lib/auth/accounts";
import { getCurrentUser } from "@/lib/auth/session";
import { isSameOrigin } from "@/lib/security/csp";

export const json = (data: unknown, init: number | ResponseInit = 200) =>
  NextResponse.json(data, typeof init === "number" ? { status: init } : init);

export const errorJson = (status: number, error: string, headers?: Record<string, string>) =>
  NextResponse.json({ error }, { status, headers: { "cache-control": "no-store", ...headers } });

/** The signed-in user, or a 401 response to return. Mutations also get the CSRF check. */
export const apiUser = async (
  req: Request,
): Promise<
  { user: SessionUser; error?: undefined } | { user?: undefined; error: NextResponse }
> => {
  if (!["GET", "HEAD"].includes(req.method) && !isSameOrigin(req.headers))
    return { error: errorJson(403, "Cross-site request refused.") };
  const user = await getCurrentUser();
  if (!user) return { error: errorJson(401, "Sign in first.") };
  return { user };
};
