// The server side of the AI layer against the database and the provider mock: keys stored
// encrypted per account, task routing with defaults, usage records, the per-account limit.
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { db } from "@/db";
import { aiKeys, aiUsage } from "@/db/schema";
import { DEFAULT_MODELS } from "@/lib/ai/config";
import { AiError } from "@/lib/ai/errors";
import {
  deleteProviderKey,
  getKeyViews,
  getTaskSettings,
  getUsageSummary,
  resolveTask,
  runAiTask,
  saveProviderKey,
  saveTaskSetting,
  testProviderKey,
} from "@/lib/ai/service";
import {
  aiReplies,
  providerPath,
  startAiMock,
  TEST_API_KEY,
  useAiMock,
  type AiMock,
} from "@/tests/helpers/ai-mock";
import { createUser } from "@/tests/helpers/factories";

let ai: AiMock;
let restore: () => void;
let ann: string;
let ben: string;

beforeAll(async () => {
  ai = await startAiMock();
  restore = useAiMock(ai);
  ann = (await createUser()).id;
  ben = (await createUser()).id;
});

afterAll(async () => {
  restore();
  await ai.close();
});

beforeEach(async () => {
  ai.reset();
  await db.execute(sql`delete from rate_limits`);
});

const failure = async (promise: Promise<unknown>) => {
  try {
    await promise;
  } catch (error) {
    return error as AiError;
  }
  throw new Error("expected a failure");
};

describe("AI keys", () => {
  it("are stored encrypted and shown only by their last four characters", async () => {
    await saveProviderKey(ann, "google", ` ${TEST_API_KEY} `);
    const row = (await db.select().from(aiKeys).where(eq(aiKeys.userId, ann)))[0]!;
    expect(row.encryptedKey).toMatch(/^v1\./);
    expect(row.encryptedKey).not.toContain(TEST_API_KEY);
    const views = await getKeyViews(ann);
    expect(views.google).toEqual({ provider: "google", hasKey: true, keyLastFour: "WXYZ" });
    expect(views.openai.hasKey).toBe(false);
    expect(JSON.stringify(views)).not.toContain(TEST_API_KEY);
    expect((await getKeyViews(ben)).google.hasKey).toBe(false);
  });

  it("cannot be used by another account, even when the row is copied", async () => {
    await saveProviderKey(ann, "openai", TEST_API_KEY);
    expect((await failure(resolveTask(ben, "analysis"))).kind).toBe("no-key");
    const row = (await db.select().from(aiKeys).where(eq(aiKeys.userId, ann)))[0]!;
    await db.insert(aiKeys).values({ ...row, id: undefined, userId: ben });
    expect((await failure(resolveTask(ben, "analysis", row.provider as "openai"))).kind).toBe(
      "config",
    );
    await db.delete(aiKeys).where(eq(aiKeys.userId, ben));
  });

  it("refuse values that are not keys", async () => {
    await expect(saveProviderKey(ann, "openai", "short")).rejects.toThrow(AiError);
  });
});

describe("tasks", () => {
  it("use the chosen provider, model and effort, with defaults otherwise", async () => {
    await saveProviderKey(ann, "anthropic", TEST_API_KEY);
    // Without a choice, Google comes first among the providers with a key.
    expect(await resolveTask(ann, "analysis")).toMatchObject({
      provider: "google",
      model: DEFAULT_MODELS.google.analysis,
      reasoning: "low",
    });
    await saveTaskSetting(ann, {
      task: "matching",
      provider: "anthropic",
      model: "claude-haiku-5-5",
      reasoning: "medium",
    });
    expect(await resolveTask(ann, "matching")).toMatchObject({
      provider: "anthropic",
      model: "claude-haiku-5-5",
      reasoning: "medium",
    });
    expect((await getTaskSettings(ann)).matching).toEqual({
      task: "matching",
      provider: "anthropic",
      model: "claude-haiku-5-5",
      reasoning: "medium",
    });
    await expect(
      saveTaskSetting(ann, { task: "analysis", provider: "openai", model: "bad model!" }),
    ).rejects.toThrow(/model name/);
  });

  it("send the request with the person's key and record the tokens", async () => {
    ai.queue("anthropic", aiReplies.anthropic.json({ answer: 1 }));
    const response = await runAiTask(
      ann,
      "matching",
      { prompt: "Pick one", json: { name: "pick", schema: { type: "object" } } },
      { mealId: "00000000-0000-4000-8000-000000000001" },
    );
    expect(response.json).toEqual({ answer: 1 });
    const request = ai.requests[0]!;
    expect(request.url).toBe(providerPath("anthropic", "claude-haiku-5-5"));
    expect(request.headers["x-api-key"]).toBe(TEST_API_KEY);
    expect((request.body as { output_config: { effort: string } }).output_config.effort).toBe(
      "medium",
    );
    const usage = await db.select().from(aiUsage).where(eq(aiUsage.userId, ann));
    expect(usage).toHaveLength(1);
    expect(usage[0]).toMatchObject({
      provider: "anthropic",
      task: "matching",
      inputTokens: 120,
      outputTokens: 30,
      ok: true,
    });
  });

  it("record the tokens of unusable replies too", async () => {
    ai.queue("anthropic", aiReplies.anthropic.refusal);
    expect((await failure(runAiTask(ann, "matching", { prompt: "x" }))).kind).toBe("refusal");
    const rows = await db.select().from(aiUsage).where(eq(aiUsage.ok, false));
    expect(rows.at(-1)).toMatchObject({ inputTokens: 50, outputTokens: 8 });
    const summary = await getUsageSummary(ann);
    expect(summary.find((r) => r.task === "matching")?.requests).toBeGreaterThanOrEqual(2);
  });

  it("stop at the per-account limit", async () => {
    const saved = process.env.AI_RATE_PER_MINUTE;
    process.env.AI_RATE_PER_MINUTE = "2";
    try {
      await runAiTask(ann, "matching", { prompt: "1" });
      await runAiTask(ann, "matching", { prompt: "2" });
      const error = await failure(runAiTask(ann, "matching", { prompt: "3" }));
      expect(error.kind).toBe("local-rate-limit");
      expect(error.retryAfter).toBeGreaterThan(0);
      // Another account is not affected.
      await saveProviderKey(ben, "openai", TEST_API_KEY);
      expect((await runAiTask(ben, "matching", { prompt: "x" })).provider).toBe("openai");
    } finally {
      if (saved === undefined) delete process.env.AI_RATE_PER_MINUTE;
      else process.env.AI_RATE_PER_MINUTE = saved;
    }
  });

  it("test a key with a tiny request, and forget deleted keys", async () => {
    ai.queue("google", aiReplies.google.success("OK"));
    expect(await testProviderKey(ann, "google")).toMatchObject({ provider: "google", reply: "OK" });
    await deleteProviderKey(ann, "google");
    expect((await failure(testProviderKey(ann, "google"))).kind).toBe("no-key");
  });
});
