// Each adapter against the local provider mock (tests/helpers/ai-mock.ts), reached through the
// AI_*_BASE_URL overrides, and through a local forward proxy for the egress path. Adapted from
// the Lingo project's adapter tests.
/* eslint-disable @typescript-eslint/no-explicit-any -- request bodies are checked field by field */
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import {
  aiReplies,
  providerPath,
  startAiMock,
  TEST_API_KEY,
  useAiMock,
  type AiMock,
} from "@/tests/helpers/ai-mock";
import { startForwardProxy, type RecordedRequest } from "@/tests/helpers/mock-http";

import { AiError } from "../errors";
import type { AiProvider, AiRequest } from "../types";

import { createAdapter } from ".";

const IMAGE = { mediaType: "image/jpeg" as const, data: "/9j/4AAQSkZJRg==" };
const SCHEMA = {
  type: "object",
  properties: { answer: { type: "number" } },
  required: ["answer"],
  additionalProperties: false,
};

const MODELS: Record<AiProvider, string> = {
  openai: "gpt-6.1-sol",
  anthropic: "claude-sonnet-5-5",
  google: "gemini-3.8-flash",
};

let ai: AiMock;
let restore: () => void;

beforeAll(async () => {
  ai = await startAiMock();
  restore = useAiMock(ai);
});

afterAll(async () => {
  restore();
  await ai.close();
});

afterEach(() => {
  ai.reset();
  delete process.env.EGRESS_PROXY_URL;
});

const fullRequest = (provider: AiProvider): AiRequest => ({
  model: MODELS[provider],
  system: "You look at meals.",
  history: [
    { role: "user", text: "Earlier question" },
    { role: "assistant", text: "Earlier answer" },
  ],
  prompt: "What is on this plate?",
  images: [IMAGE],
  json: { name: "meal analysis", schema: SCHEMA },
  maxOutputTokens: 1000,
  reasoning: "low",
});

const checks: Record<AiProvider, (request: RecordedRequest, sent: AiRequest) => void> = {
  openai: (request, sent) => {
    expect(request.headers.authorization).toBe(`Bearer ${TEST_API_KEY}`);
    const body = request.body as Record<string, any>;
    expect(body.model).toBe(sent.model);
    expect(body.instructions).toBe(sent.system);
    expect(body.store).toBe(false);
    expect(body.max_output_tokens).toBe(1000);
    expect(body.reasoning).toEqual({ effort: "low" });
    expect(body.input[0]).toEqual({ role: "user", content: "Earlier question" });
    expect(body.input[1]).toEqual({ role: "assistant", content: "Earlier answer" });
    expect(body.input[2].content).toEqual([
      { type: "input_text", text: sent.prompt },
      { type: "input_image", image_url: `data:image/jpeg;base64,${IMAGE.data}` },
    ]);
    expect(body.text.format).toEqual({
      type: "json_schema",
      name: "meal_analysis",
      schema: SCHEMA,
      strict: true,
    });
  },
  anthropic: (request, sent) => {
    expect(request.headers["x-api-key"]).toBe(TEST_API_KEY);
    expect(request.headers["anthropic-version"]).toBe("2023-06-01");
    expect(request.headers.authorization).toBeUndefined();
    const body = request.body as Record<string, any>;
    expect(body.model).toBe(sent.model);
    expect(body.system).toBe(sent.system);
    expect(body.max_tokens).toBe(1000);
    expect(body.messages[2].content).toEqual([
      { type: "image", source: { type: "base64", media_type: "image/jpeg", data: IMAGE.data } },
      { type: "text", text: sent.prompt },
    ]);
    expect(body.output_config).toEqual({
      format: { type: "json_schema", schema: SCHEMA },
      effort: "low",
    });
  },
  google: (request, sent) => {
    expect(request.headers["x-goog-api-key"]).toBe(TEST_API_KEY);
    expect(request.url).not.toContain(TEST_API_KEY);
    const body = request.body as Record<string, any>;
    expect(body.systemInstruction).toEqual({ parts: [{ text: sent.system }] });
    expect(body.contents[1]).toEqual({ role: "model", parts: [{ text: "Earlier answer" }] });
    expect(body.contents[2].parts).toEqual([
      { text: sent.prompt },
      { inlineData: { mimeType: "image/jpeg", data: IMAGE.data } },
    ]);
    expect(body.generationConfig).toEqual({
      maxOutputTokens: 1000,
      responseMimeType: "application/json",
      responseJsonSchema: SCHEMA,
      thinkingConfig: { thinkingLevel: "low" },
    });
  },
};

const failure = async (promise: Promise<unknown>) => {
  try {
    await promise;
  } catch (error) {
    return error as AiError;
  }
  throw new Error("expected a failure");
};

describe.each(["openai", "anthropic", "google"] as const)("%s adapter", (provider) => {
  const r = aiReplies[provider];
  const adapter = () => createAdapter(provider, { apiKey: TEST_API_KEY });
  const plain = { model: MODELS[provider], prompt: "x" };
  const asJson = { ...plain, json: { name: "a", schema: SCHEMA } };

  it("sends images, schema and effort in the provider's format and parses the reply", async () => {
    ai.queue(provider, r.json({ answer: 3 }));
    const sent = fullRequest(provider);
    const response = await adapter().send(sent);
    expect(ai.requests).toHaveLength(1);
    expect(ai.requests[0]!.url).toBe(providerPath(provider, MODELS[provider]));
    checks[provider](ai.requests[0]!, sent);
    expect(response.provider).toBe(provider);
    expect(response.json).toEqual({ answer: 3 });
    expect(response.usage).toEqual(r.usage);
  });

  it("leaves effort out when none is asked for", async () => {
    ai.queue(provider, r.success("OK"));
    const response = await adapter().send(plain);
    expect(response.text).toBe("OK");
    expect(response.json).toBeUndefined();
    const body = ai.requests[0]!.body as Record<string, any>;
    expect(
      body.reasoning ?? body.output_config ?? body.generationConfig?.thinkingConfig,
    ).toBeUndefined();
  });

  it("reports a refused key without repeating it", async () => {
    ai.queue(provider, r.badKey);
    const error = await failure(adapter().send(plain));
    expect(error).toBeInstanceOf(AiError);
    expect(error.kind).toBe("auth");
    expect(error.message).not.toContain(TEST_API_KEY);
    expect(JSON.stringify(error)).not.toContain(TEST_API_KEY);
  });

  it("reports rate limits with the wait time, and an empty account", async () => {
    ai.queue(provider, r.rateLimited, r.quota);
    const limited = await failure(adapter().send(plain));
    expect(limited.kind).toBe("rate-limit");
    expect(limited.retryAfter).toBe(20);
    const quota = await failure(adapter().send(plain));
    expect(quota.kind).toBe(provider === "google" ? "auth" : "quota");
  });

  it("reports refusals, cut-off replies and malformed JSON with their usage", async () => {
    ai.queue(provider, r.refusal, r.cutOff, r.malformed);
    const refusal = await failure(adapter().send(plain));
    expect(refusal.kind).toBe("refusal");
    expect(refusal.usage?.inputTokens).toBe(50);
    const cut = await failure(adapter().send(asJson));
    expect(cut.kind).toBe("incomplete");
    expect(cut.usage?.outputTokens).toBe(256);
    const malformed = await failure(adapter().send(asJson));
    expect(malformed.kind).toBe("invalid-output");
    expect(malformed.usage).toEqual(r.usage);
  });

  it("maps provider failures to server errors", async () => {
    ai.queue(provider, r.serverError);
    expect((await failure(adapter().send(plain))).kind).toBe("server");
  });

  it("goes through the egress proxy when one is set", async () => {
    const proxy = await startForwardProxy();
    try {
      process.env.EGRESS_PROXY_URL = proxy.url;
      ai.queue(provider, r.success("OK"));
      expect((await adapter().send(plain)).text).toBe("OK");
      expect(proxy.seen).toEqual([`${ai.url}${providerPath(provider, MODELS[provider])}`]);
    } finally {
      await proxy.close();
    }
  });
});

describe("network failures", () => {
  it("reports an unreachable provider and a timeout", async () => {
    const unreachable = createAdapter("openai", {
      apiKey: TEST_API_KEY,
      baseUrl: "http://127.0.0.1:9",
    });
    expect((await failure(unreachable.send({ model: "m", prompt: "x" }))).kind).toBe("network");

    ai.queue("anthropic", aiReplies.anthropic.slow(1000));
    const slow = createAdapter("anthropic", { apiKey: TEST_API_KEY, timeoutMs: 200 });
    expect((await failure(slow.send({ model: "m", prompt: "x" }))).kind).toBe("timeout");
  });

  it("refuses to use a proxy that is down instead of going direct", async () => {
    process.env.EGRESS_PROXY_URL = "http://127.0.0.1:9";
    const error = await failure(
      createAdapter("openai", { apiKey: TEST_API_KEY }).send({ model: "m", prompt: "x" }),
    );
    expect(error.kind).toBe("network");
    expect(ai.requests).toHaveLength(0);
  });
});
