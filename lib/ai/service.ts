// Server side of the AI layer (adapted from the Lingo project): the person's stored keys and task
// settings, key encryption, the per-account rate limit, the provider call and the token record.
// The worker's analysis and matching steps call runAiTask; the settings page calls the rest.
// Never import this into a client component.
import { and, desc, eq, gte, sql } from "drizzle-orm";

import { db as defaultDb, type DbOrTx } from "@/db";
import { aiKeys, aiSettings, aiUsage } from "@/db/schema";
import { aiKeyContext, decryptSecret, encryptSecret, lastFour } from "@/lib/crypto";
import { aiWindows, takeRateLimit } from "@/lib/rate-limit";

import { createAdapter } from "./adapters";
import {
  DEFAULT_MODELS,
  DEFAULT_REASONING,
  isValidModelName,
  PREFERRED_PROVIDER_ORDER,
} from "./config";
import { AiError, isAiError } from "./errors";
import {
  AI_PROVIDERS,
  AI_TASKS,
  isAiProvider,
  isAiTask,
  isReasoningEffort,
  type AiProvider,
  type AiRequest,
  type AiResponse,
  type AiTask,
  type AiUsage,
  type ReasoningEffort,
} from "./types";

// ---- Keys ----

export type KeyView = { provider: AiProvider; hasKey: boolean; keyLastFour: string | null };

/** What the settings page may show: never the key, only whether one is saved and its end. */
export const getKeyViews = async (
  userId: string,
  dbx: DbOrTx = defaultDb,
): Promise<Record<AiProvider, KeyView>> => {
  const rows = await dbx.select().from(aiKeys).where(eq(aiKeys.userId, userId));
  const view = {} as Record<AiProvider, KeyView>;
  for (const provider of AI_PROVIDERS) {
    const row = rows.find((r) => r.provider === provider);
    view[provider] = { provider, hasKey: !!row, keyLastFour: row?.keyLastFour ?? null };
  }
  return view;
};

export const saveProviderKey = async (
  userId: string,
  provider: AiProvider,
  apiKey: string,
  dbx: DbOrTx = defaultDb,
) => {
  const key = apiKey.trim();
  if (key.length < 8 || key.length > 400 || /\s/.test(key))
    throw new AiError("bad-request", "That does not look like an API key.", { provider });
  const encryptedKey = encryptSecret(key, aiKeyContext(userId, provider));
  await dbx
    .insert(aiKeys)
    .values({ userId, provider, encryptedKey, keyLastFour: lastFour(key) })
    .onConflictDoUpdate({
      target: [aiKeys.userId, aiKeys.provider],
      set: { encryptedKey, keyLastFour: lastFour(key), updatedAt: new Date() },
    });
};

export const deleteProviderKey = async (
  userId: string,
  provider: AiProvider,
  dbx: DbOrTx = defaultDb,
) => {
  await dbx.delete(aiKeys).where(and(eq(aiKeys.userId, userId), eq(aiKeys.provider, provider)));
};

// ---- Task settings ----

export type TaskSetting = {
  task: AiTask;
  /** null until the person picks one; then the first provider with a key is used. */
  provider: AiProvider | null;
  /** null for the provider's default model for the task. */
  model: string | null;
  /** null for the default effort of the task. */
  reasoning: ReasoningEffort | null;
};

export const getTaskSettings = async (
  userId: string,
  dbx: DbOrTx = defaultDb,
): Promise<Record<AiTask, TaskSetting>> => {
  const rows = await dbx.select().from(aiSettings).where(eq(aiSettings.userId, userId));
  const out = {} as Record<AiTask, TaskSetting>;
  for (const task of AI_TASKS) {
    const row = rows.find((r) => r.task === task);
    out[task] = {
      task,
      provider: row && isAiProvider(row.provider) ? row.provider : null,
      model: row?.model && isValidModelName(row.model) ? row.model : null,
      reasoning: row && isReasoningEffort(row.reasoning) ? row.reasoning : null,
    };
  }
  return out;
};

/** Saves the provider, model and effort for one task. Invalid model names are refused. */
export const saveTaskSetting = async (
  userId: string,
  setting: {
    task: AiTask;
    provider: AiProvider;
    model?: string | null;
    reasoning?: ReasoningEffort | null;
  },
  dbx: DbOrTx = defaultDb,
) => {
  if (!isAiTask(setting.task) || !isAiProvider(setting.provider))
    throw new AiError("bad-request", "Unknown task or provider.");
  const model = setting.model?.trim() || null;
  if (model && !isValidModelName(model))
    throw new AiError("bad-request", "That is not a valid model name.");
  const reasoning = setting.reasoning ?? null;
  if (reasoning && !isReasoningEffort(reasoning))
    throw new AiError("bad-request", "Unknown reasoning effort.");
  await dbx
    .insert(aiSettings)
    .values({ userId, task: setting.task, provider: setting.provider, model, reasoning })
    .onConflictDoUpdate({
      target: [aiSettings.userId, aiSettings.task],
      set: { provider: setting.provider, model, reasoning, updatedAt: new Date() },
    });
};

// ---- Resolving and running a task ----

export type ResolvedTask = {
  provider: AiProvider;
  model: string;
  reasoning: ReasoningEffort | undefined;
  apiKey: string;
};

/**
 * The provider, model, effort and decrypted key for a task: the provider chosen for the task, or
 * when none was chosen (or it has no key), the first provider with a key in the preferred order.
 */
export const resolveTask = async (
  userId: string,
  task: AiTask,
  provider?: AiProvider,
  dbx: DbOrTx = defaultDb,
): Promise<ResolvedTask> => {
  const [keys, settings] = await Promise.all([
    dbx.select().from(aiKeys).where(eq(aiKeys.userId, userId)),
    getTaskSettings(userId, dbx),
  ]);
  const setting = settings[task];
  const chosen = provider ?? setting.provider;
  const keyRow = chosen
    ? keys.find((k) => k.provider === chosen)
    : PREFERRED_PROVIDER_ORDER.map((p) => keys.find((k) => k.provider === p)).find(Boolean);

  if (!keyRow || !isAiProvider(keyRow.provider))
    throw new AiError("no-key", "No API key is saved for this task.", {
      provider: chosen ?? undefined,
    });

  let apiKey: string;
  try {
    apiKey = decryptSecret(keyRow.encryptedKey, aiKeyContext(userId, keyRow.provider));
  } catch (error) {
    throw new AiError(
      "config",
      error instanceof Error && error.message.includes("CAL_SECRET_KEY")
        ? error.message
        : "A saved key could not be decrypted; CAL_SECRET_KEY may have changed. Save the key again.",
      { provider: keyRow.provider },
    );
  }

  const sameProvider = setting.provider === keyRow.provider;
  const model = (sameProvider && setting.model) || DEFAULT_MODELS[keyRow.provider][task];
  const reasoning = (sameProvider && setting.reasoning) || DEFAULT_REASONING[task];
  return { provider: keyRow.provider, model, reasoning, apiKey };
};

export const recordAiUsage = async (
  entry: {
    userId: string;
    provider: AiProvider;
    model: string;
    task: string;
    usage: AiUsage;
    mealId?: string | null;
    ok?: boolean;
  },
  dbx: DbOrTx = defaultDb,
) => {
  await dbx.insert(aiUsage).values({
    userId: entry.userId,
    provider: entry.provider,
    model: entry.model,
    task: entry.task,
    mealId: entry.mealId ?? null,
    inputTokens: Math.round(entry.usage.inputTokens),
    outputTokens: Math.round(entry.usage.outputTokens),
    ok: entry.ok ?? true,
  });
};

/** Throws AiError("local-rate-limit") when the account made too many AI requests. */
export const takeAiRequest = async (userId: string, dbx: DbOrTx = defaultDb) => {
  const { ok, retryAfter } = await takeRateLimit(`ai:${userId}`, aiWindows(), dbx);
  if (!ok) throw new AiError("local-rate-limit", "Too many AI requests.", { retryAfter });
};

export type RunOptions = {
  /** Use this provider instead of the one chosen for the task (the key test). */
  provider?: AiProvider;
  /** The task name stored with the usage record, when it differs from the task. */
  usageTask?: string;
  /** The meal the request was for, kept with the usage record. */
  mealId?: string;
  db?: DbOrTx;
};

/**
 * Sends one request for a task with the person's own provider, model and key, counts it against
 * the per-account limit and records the tokens used, also when the reply was unusable.
 */
export const runAiTask = async (
  userId: string,
  task: AiTask,
  request: Omit<AiRequest, "model"> & { model?: string },
  options: RunOptions = {},
): Promise<AiResponse> => {
  const dbx = options.db ?? defaultDb;
  await takeAiRequest(userId, dbx);
  const resolved = await resolveTask(userId, task, options.provider, dbx);
  const model = request.model ?? resolved.model;
  const adapter = createAdapter(resolved.provider, { apiKey: resolved.apiKey });
  const record = (usage: AiUsage, ok: boolean) =>
    recordAiUsage(
      {
        userId,
        provider: resolved.provider,
        model,
        task: options.usageTask ?? task,
        usage,
        mealId: options.mealId,
        ok,
      },
      dbx,
    ).catch(() => undefined);

  try {
    const response = await adapter.send({
      ...request,
      model,
      reasoning: request.reasoning ?? resolved.reasoning,
    });
    await record(response.usage, true);
    return response;
  } catch (error) {
    if (isAiError(error) && error.usage) await record(error.usage, false);
    throw error;
  }
};

/**
 * Checks a saved key with a minimal request to the model chosen for matching (or that provider's
 * default). An accepted request proves the key, the model name and the route through the proxy.
 */
export const testProviderKey = async (
  userId: string,
  provider: AiProvider,
  dbx: DbOrTx = defaultDb,
) => {
  const { model } = await resolveTask(userId, "matching", provider, dbx);
  const response = await runAiTask(
    userId,
    "matching",
    { model, prompt: "Reply with the single word OK.", maxOutputTokens: 256 },
    { provider, usageTask: "key-test", db: dbx },
  ).catch((error) => {
    // Cut off by the small token limit still means the key and model work.
    if (isAiError(error) && error.kind === "incomplete") return null;
    throw error;
  });
  return {
    provider,
    model,
    reply: response?.text.slice(0, 80) ?? "",
    usage: response?.usage ?? null,
  };
};

// ---- Usage ----

export type UsageRow = {
  provider: string;
  model: string;
  task: string;
  requests: number;
  inputTokens: number;
  outputTokens: number;
};

/** Tokens per provider, model and task over the last days, newest use first. */
export const getUsageSummary = async (
  userId: string,
  days = 30,
  dbx: DbOrTx = defaultDb,
): Promise<UsageRow[]> => {
  const since = new Date(Date.now() - days * 86_400_000);
  const rows = await dbx
    .select({
      provider: aiUsage.provider,
      model: aiUsage.model,
      task: aiUsage.task,
      requests: sql<number>`count(*)::int`,
      inputTokens: sql<number>`coalesce(sum(${aiUsage.inputTokens}), 0)::int`,
      outputTokens: sql<number>`coalesce(sum(${aiUsage.outputTokens}), 0)::int`,
    })
    .from(aiUsage)
    .where(and(eq(aiUsage.userId, userId), gte(aiUsage.createdAt, since)))
    .groupBy(aiUsage.provider, aiUsage.model, aiUsage.task)
    .orderBy(desc(sql`max(${aiUsage.createdAt})`));
  return rows;
};

/** Totals per account for the admin page (no meal contents). */
export const getUsageTotals = async (days = 30, dbx: DbOrTx = defaultDb) => {
  const since = new Date(Date.now() - days * 86_400_000);
  return dbx
    .select({
      userId: aiUsage.userId,
      requests: sql<number>`count(*)::int`,
      inputTokens: sql<number>`coalesce(sum(${aiUsage.inputTokens}), 0)::int`,
      outputTokens: sql<number>`coalesce(sum(${aiUsage.outputTokens}), 0)::int`,
    })
    .from(aiUsage)
    .where(gte(aiUsage.createdAt, since))
    .groupBy(aiUsage.userId);
};
