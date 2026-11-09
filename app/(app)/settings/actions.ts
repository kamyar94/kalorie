"use server";

// Server actions of the Settings page. Each one checks the session itself and changes only the
// signed-in person's data. API keys go in and never come back out: the answers carry the masked
// view (last four characters) only.
import { cookies } from "next/headers";

import { deleteUserData } from "@/lib/account/data";
import {
  SettingsInputError,
  updatePreferences,
  updateProfile,
  type Preferences,
} from "@/lib/account/settings";
import { isAiError, describeAiError } from "@/lib/ai/errors";
import {
  deleteProviderKey,
  getKeyViews,
  saveProviderKey,
  saveTaskSetting,
  testProviderKey,
  type KeyView,
} from "@/lib/ai/service";
import { isAiProvider, isAiTask, isReasoningEffort, type AiProvider } from "@/lib/ai/types";
import { retryKeyFailures } from "@/lib/analysis/requests";
import { audit } from "@/lib/audit";
import { requireUser, secureCookies } from "@/lib/auth/session";
import { isNutrientCode } from "@/lib/contracts/nutrients";
import type { DailyTargets, Profile } from "@/lib/contracts/targets";
import { SETTINGS_WINDOWS, takeRateLimit } from "@/lib/rate-limit";
import { getTargets, resetTarget, setCustomTarget } from "@/lib/targets/service";
import { parseTheme, THEME_COOKIE } from "@/lib/ui/theme";

export type ActionResult<T = null> = { ok: true; data: T } | { ok: false; error: string };

const failure = (error: unknown, fallback: string): { ok: false; error: string } => ({
  ok: false,
  error:
    error instanceof SettingsInputError
      ? error.message
      : isAiError(error)
        ? describeAiError(error)
        : fallback,
});

const limited = async (userId: string) =>
  !(await takeRateLimit(`settings:${userId}`, SETTINGS_WINDOWS)).ok;

export const setThemeAction = async (theme: string) => {
  (await cookies()).set(THEME_COOKIE, parseTheme(theme), {
    path: "/",
    sameSite: "lax",
    secure: secureCookies(),
    maxAge: 60 * 60 * 24 * 365,
  });
};

// ---- Profile and targets ----

export const saveProfileAction = async (
  input: Partial<Record<keyof Profile, unknown>>,
): Promise<ActionResult<DailyTargets>> => {
  const user = await requireUser();
  try {
    await updateProfile(user.id, input);
    return { ok: true, data: await getTargets(user.id) };
  } catch (error) {
    return failure(error, "The profile was not saved.");
  }
};

export const setTargetAction = async (
  code: string,
  target: number | null,
): Promise<ActionResult<DailyTargets>> => {
  const user = await requireUser();
  if (!isNutrientCode(code)) return { ok: false, error: "Unknown nutrient." };
  try {
    if (target === null) await resetTarget(user.id, code);
    else {
      if (!Number.isFinite(target) || target <= 0 || target > 100_000)
        return { ok: false, error: "Give a positive number." };
      await setCustomTarget(user.id, code, { target });
    }
    return { ok: true, data: await getTargets(user.id) };
  } catch (error) {
    return failure(error, "The target was not saved.");
  }
};

// ---- Preferences ----

export const savePreferencesAction = async (
  input: Partial<Record<keyof Preferences, unknown>>,
): Promise<ActionResult<Preferences>> => {
  const user = await requireUser();
  try {
    const saved = await updatePreferences(user.id, input);
    if (!saved) return { ok: false, error: "Not saved." };
    return { ok: true, data: saved };
  } catch (error) {
    return failure(error, "Not saved.");
  }
};

// ---- AI keys and models ----

export const saveKeyAction = async (
  provider: string,
  apiKey: string,
): Promise<ActionResult<KeyView & { retried: number }>> => {
  const user = await requireUser();
  if (!isAiProvider(provider)) return { ok: false, error: "Unknown provider." };
  if (await limited(user.id))
    return { ok: false, error: "Too many changes in a short time. Try again in a few minutes." };
  try {
    await saveProviderKey(user.id, provider, apiKey);
    await audit({ userId: user.id, action: "ai.key.save", details: { provider } });
    // Meals that stopped for a missing or refused key are analysed again with the new one.
    const retried = await retryKeyFailures(user.id).catch(() => 0);
    return { ok: true, data: { ...(await getKeyViews(user.id))[provider], retried } };
  } catch (error) {
    return failure(error, "The key was not saved.");
  }
};

export const deleteKeyAction = async (provider: string): Promise<ActionResult<KeyView>> => {
  const user = await requireUser();
  if (!isAiProvider(provider)) return { ok: false, error: "Unknown provider." };
  await deleteProviderKey(user.id, provider);
  await audit({ userId: user.id, action: "ai.key.delete", details: { provider } });
  return { ok: true, data: (await getKeyViews(user.id))[provider] };
};

export const testKeyAction = async (
  provider: string,
): Promise<ActionResult<{ model: string; reply: string }>> => {
  const user = await requireUser();
  if (!isAiProvider(provider)) return { ok: false, error: "Unknown provider." };
  if (await limited(user.id))
    return { ok: false, error: "Too many tests in a short time. Try again in a few minutes." };
  try {
    const result = await testProviderKey(user.id, provider as AiProvider);
    return { ok: true, data: { model: result.model, reply: result.reply } };
  } catch (error) {
    return failure(error, "The test did not work.");
  }
};

export const saveTaskAction = async (input: {
  task: string;
  provider: string;
  model: string;
  reasoning: string;
}): Promise<ActionResult> => {
  const user = await requireUser();
  if (!isAiTask(input.task) || !isAiProvider(input.provider))
    return { ok: false, error: "Unknown task or provider." };
  try {
    await saveTaskSetting(user.id, {
      task: input.task,
      provider: input.provider,
      model: input.model.trim() || null,
      reasoning: isReasoningEffort(input.reasoning) ? input.reasoning : null,
    });
    return { ok: true, data: null };
  } catch (error) {
    return failure(error, "Not saved.");
  }
};

// ---- My data ----

export const deleteMyDataAction = async (confirmation: string): Promise<ActionResult> => {
  const user = await requireUser();
  if (confirmation.trim().toLowerCase() !== "delete")
    return { ok: false, error: 'Type "delete" to confirm.' };
  await deleteUserData(user.id);
  return { ok: true, data: null };
};
