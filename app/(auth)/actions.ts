"use server";

import { redirect } from "next/navigation";

import { acceptInvite, authenticate, redeemResetCode } from "@/lib/auth/accounts";
import { endSession, getClientIp, startSession } from "@/lib/auth/session";

// The typed fields come back with an error, because React empties a form after each submit.
// Passwords are never sent back.
export type AuthState = { error?: string; values?: Record<string, string> };

const field = (form: FormData, name: string, max = 200) =>
  String(form.get(name) ?? "")
    .trim()
    .slice(0, max);
const secret = (form: FormData, name: string) => String(form.get(name) ?? "").slice(0, 400);

export const signInAction = async (_state: AuthState, form: FormData): Promise<AuthState> => {
  const username = field(form, "username", 64).toLowerCase();
  const result = await authenticate({
    username,
    password: secret(form, "password"),
    ip: await getClientIp(),
  });
  if (!result.ok) return { error: result.error, values: { username } };
  await startSession(result.userId);
  redirect("/today");
};

export const acceptInviteAction = async (_state: AuthState, form: FormData): Promise<AuthState> => {
  const values = {
    code: field(form, "code", 40),
    displayName: field(form, "displayName", 60),
    username: field(form, "username", 64).toLowerCase(),
  };
  const password = secret(form, "password");
  if (password !== secret(form, "confirm")) return { error: "The two passwords differ.", values };
  const result = await acceptInvite({ ...values, password, ip: await getClientIp() });
  if (!result.ok) return { error: result.error, values };
  await startSession(result.userId);
  redirect("/today");
};

export const resetPasswordAction = async (
  _state: AuthState,
  form: FormData,
): Promise<AuthState> => {
  const values = { code: field(form, "code", 40) };
  const password = secret(form, "password");
  if (password !== secret(form, "confirm")) return { error: "The two passwords differ.", values };
  const result = await redeemResetCode({ code: values.code, password, ip: await getClientIp() });
  if (!result.ok) return { error: result.error, values };
  await startSession(result.userId);
  redirect("/today");
};

export const signOutAction = async () => {
  await endSession();
  redirect("/sign-in");
};
