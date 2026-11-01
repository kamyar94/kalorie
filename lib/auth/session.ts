// Session cookie handling for pages, server actions and route handlers. The cookie holds a random
// token; the database keeps only its SHA-256 (lib/auth/accounts.ts).
import "server-only";

import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";

import { createSession, deleteSession, findSessionUser, type SessionUser } from "./accounts";

export const SESSION_COOKIE = "cal_session";

/** Secure cookies unless COOKIE_SECURE=false (plain http on 127.0.0.1 in development and tests). */
export const secureCookies = () => process.env.COOKIE_SECURE !== "false";

export const startSession = async (userId: string) => {
  const { token, expiresAt } = await createSession(userId);
  (await cookies()).set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: secureCookies(),
    path: "/",
    expires: expiresAt,
  });
};

export const endSession = async () => {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (token) await deleteSession(token);
  jar.delete(SESSION_COOKIE);
};

/** The signed-in account, once per request. */
export const getCurrentUser = cache(async (): Promise<SessionUser | null> => {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  return token ? findSessionUser(token) : null;
});

/** For pages and server actions: sends anyone not signed in to the sign-in page. */
export const requireUser = async () => {
  const user = await getCurrentUser();
  if (!user) redirect("/sign-in");
  return user;
};

/** For admin pages and actions: members get a not-found, never a hint that the page exists. */
export const requireAdmin = async () => {
  const user = await requireUser();
  if (user.role !== "admin") redirect("/today");
  return user;
};

// The tunnel connector is the only way in, so its visitor-address header is trustworthy; in
// development the request comes straight from the browser.
export const getClientIp = async () => {
  const h = await headers();
  return (
    h.get("cf-connecting-ip") ||
    h.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    "local"
  ).slice(0, 64);
};
