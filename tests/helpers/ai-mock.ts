// The AI provider mock for tests (adapted from the Lingo project's adapter tests): recorded reply
// shapes of OpenAI, Anthropic and Google, including errors, refusals, cut-off and malformed JSON,
// and a local server that answers each provider's path from a queue of scripted replies.
//
//   const ai = await startAiMock();      // routes /openai, /anthropic, /google
//   useAiMock(ai);                        // points AI_*_BASE_URL at it
//   ai.queue("google", aiReplies.google.json({ is_food: true, ... }));
//   ai.queue("openai", aiReplies.openai.badKey, aiReplies.openai.success("OK"));
//   ... ai.requests[0].body ...
//   await ai.close();
import type { AiProvider } from "@/lib/ai/types";

import { startMockServer, type MockReply, type RecordedRequest } from "./mock-http";

export const TEST_API_KEY = "sk-test-SECRET-0123456789-WXYZ";

export type ProviderReplies = {
  /** A normal reply whose text is the given string. */
  success: (text: string) => MockReply;
  /** A normal reply whose text is the JSON of the value (structured output). */
  json: (value: unknown) => MockReply;
  badKey: MockReply;
  rateLimited: MockReply;
  quota: MockReply;
  refusal: MockReply;
  cutOff: MockReply;
  /** Valid reply, text that is not JSON (for requests that asked for JSON). */
  malformed: MockReply;
  serverError: MockReply;
  /** Answers after the given delay (pair with a short AI_REQUEST_TIMEOUT_MS). */
  slow: (delayMs: number) => MockReply;
  /** Usage reported by success replies. */
  usage: { inputTokens: number; outputTokens: number };
};

const openaiSuccess = (text: string): MockReply => ({
  json: {
    id: "resp_1",
    object: "response",
    status: "completed",
    model: "gpt-6.1-sol",
    output: [
      { type: "reasoning", id: "rs_1", summary: [] },
      {
        type: "message",
        id: "msg_1",
        status: "completed",
        role: "assistant",
        content: [{ type: "output_text", text, annotations: [] }],
      },
    ],
    usage: {
      input_tokens: 120,
      input_tokens_details: { cached_tokens: 0 },
      output_tokens: 30,
      output_tokens_details: { reasoning_tokens: 12 },
      total_tokens: 150,
    },
  },
});

const anthropicSuccess = (text: string): MockReply => ({
  json: {
    id: "msg_1",
    type: "message",
    role: "assistant",
    model: "claude-sonnet-5-5",
    content: [
      { type: "thinking", thinking: "Let me see.", signature: "sig" },
      { type: "text", text },
    ],
    stop_reason: "end_turn",
    stop_sequence: null,
    usage: {
      input_tokens: 100,
      cache_creation_input_tokens: 0,
      cache_read_input_tokens: 20,
      output_tokens: 30,
    },
  },
});

const googleSuccess = (text: string): MockReply => ({
  json: {
    candidates: [
      {
        content: { parts: [{ text: "thinking...", thought: true }, { text }], role: "model" },
        finishReason: "STOP",
        index: 0,
      },
    ],
    usageMetadata: {
      promptTokenCount: 120,
      candidatesTokenCount: 18,
      thoughtsTokenCount: 12,
      totalTokenCount: 150,
    },
    modelVersion: "gemini-3.8-flash",
    responseId: "abc",
  },
});

export const aiReplies: Record<AiProvider, ProviderReplies> = {
  openai: {
    success: openaiSuccess,
    json: (value) => openaiSuccess(JSON.stringify(value)),
    badKey: {
      status: 401,
      json: {
        error: {
          message: `Incorrect API key provided: ${TEST_API_KEY}. You can find your API key in your account.`,
          type: "invalid_request_error",
          param: null,
          code: "invalid_api_key",
        },
      },
    },
    rateLimited: {
      status: 429,
      headers: { "retry-after": "20" },
      json: {
        error: {
          message: "Rate limit reached for requests.",
          type: "requests",
          param: null,
          code: "rate_limit_exceeded",
        },
      },
    },
    quota: {
      status: 429,
      json: {
        error: {
          message: "You exceeded your current quota.",
          type: "insufficient_quota",
          param: null,
          code: "insufficient_quota",
        },
      },
    },
    refusal: {
      json: {
        status: "completed",
        model: "gpt-6.1-sol",
        output: [
          {
            type: "message",
            role: "assistant",
            content: [{ type: "refusal", refusal: "I can't help with that." }],
          },
        ],
        usage: { input_tokens: 50, output_tokens: 8 },
      },
    },
    cutOff: {
      json: {
        status: "incomplete",
        incomplete_details: { reason: "max_output_tokens" },
        model: "gpt-6.1-sol",
        output: [],
        usage: { input_tokens: 50, output_tokens: 256 },
      },
    },
    malformed: openaiSuccess("not json"),
    serverError: { status: 500, text: "upstream exploded" },
    slow: (delayMs) => ({ ...openaiSuccess("late"), delayMs }),
    usage: { inputTokens: 120, outputTokens: 30 },
  },

  anthropic: {
    success: anthropicSuccess,
    json: (value) => anthropicSuccess(JSON.stringify(value)),
    badKey: {
      status: 401,
      json: {
        type: "error",
        error: { type: "authentication_error", message: "invalid x-api-key" },
        request_id: "req_1",
      },
    },
    rateLimited: {
      status: 429,
      headers: { "retry-after": "20" },
      json: {
        type: "error",
        error: {
          type: "rate_limit_error",
          message: "Number of requests has exceeded your rate limit.",
        },
      },
    },
    quota: {
      status: 400,
      json: {
        type: "error",
        error: {
          type: "invalid_request_error",
          message: "Your credit balance is too low to access the Anthropic API.",
        },
      },
    },
    refusal: {
      json: {
        type: "message",
        role: "assistant",
        model: "claude-sonnet-5-5",
        content: [],
        stop_reason: "refusal",
        usage: { input_tokens: 50, output_tokens: 8 },
      },
    },
    cutOff: {
      json: {
        type: "message",
        role: "assistant",
        model: "claude-sonnet-5-5",
        content: [{ type: "text", text: '{"answ' }],
        stop_reason: "max_tokens",
        usage: { input_tokens: 50, output_tokens: 256 },
      },
    },
    malformed: anthropicSuccess("not json"),
    serverError: { status: 500, text: "upstream exploded" },
    slow: (delayMs) => ({ ...anthropicSuccess("late"), delayMs }),
    usage: { inputTokens: 120, outputTokens: 30 },
  },

  google: {
    success: googleSuccess,
    json: (value) => googleSuccess(JSON.stringify(value)),
    badKey: {
      status: 400,
      json: {
        error: {
          code: 400,
          message: "API key not valid. Please pass a valid API key.",
          status: "INVALID_ARGUMENT",
          details: [
            {
              "@type": "type.googleapis.com/google.rpc.ErrorInfo",
              reason: "API_KEY_INVALID",
              domain: "googleapis.com",
            },
          ],
        },
      },
    },
    rateLimited: {
      status: 429,
      headers: { "retry-after": "20" },
      json: {
        error: {
          code: 429,
          message: "Resource has been exhausted (e.g. check quota).",
          status: "RESOURCE_EXHAUSTED",
        },
      },
    },
    quota: {
      status: 403,
      json: {
        error: {
          code: 403,
          message: "Billing is not enabled for this project.",
          status: "PERMISSION_DENIED",
        },
      },
    },
    refusal: {
      json: {
        promptFeedback: { blockReason: "SAFETY" },
        usageMetadata: { promptTokenCount: 50, totalTokenCount: 50 },
      },
    },
    cutOff: {
      json: {
        candidates: [
          { content: { parts: [{ text: '{"answ' }], role: "model" }, finishReason: "MAX_TOKENS" },
        ],
        usageMetadata: { promptTokenCount: 50, candidatesTokenCount: 256 },
      },
    },
    malformed: googleSuccess("not json"),
    serverError: { status: 500, text: "upstream exploded" },
    slow: (delayMs) => ({ ...googleSuccess("late"), delayMs }),
    usage: { inputTokens: 120, outputTokens: 30 },
  },
};

/** The path each provider's adapter posts to, below the mock's per-provider prefix. */
export const providerPath = (provider: AiProvider, model: string) =>
  provider === "openai"
    ? "/openai/v1/responses"
    : provider === "anthropic"
      ? "/anthropic/v1/messages"
      : `/google/v1beta/models/${encodeURIComponent(model)}:generateContent`;

export type QueuedReply = MockReply | ((request: RecordedRequest) => MockReply);

export type AiMock = {
  url: string;
  /** Base URL settings that point the adapters here. */
  env: Record<string, string>;
  requests: (RecordedRequest & { provider: AiProvider | null })[];
  /**
   * Replies used in order for the next requests to that provider. A function builds its reply
   * from the request (for replies that refer to ids in the prompt).
   */
  queue: (provider: AiProvider, ...replies: QueuedReply[]) => void;
  /** Reply used when a provider's queue is empty (default: success "OK"). */
  setDefault: (provider: AiProvider, reply: MockReply) => void;
  reset: () => void;
  close: () => Promise<void>;
};

const providerOf = (url: string): AiProvider | null =>
  url.startsWith("/openai/")
    ? "openai"
    : url.startsWith("/anthropic/")
      ? "anthropic"
      : url.startsWith("/google/")
        ? "google"
        : null;

export const startAiMock = async (): Promise<AiMock> => {
  const server = await startMockServer();
  const queues: Record<AiProvider, QueuedReply[]> = { openai: [], anthropic: [], google: [] };
  const defaults: Record<AiProvider, MockReply> = {
    openai: aiReplies.openai.success("OK"),
    anthropic: aiReplies.anthropic.success("OK"),
    google: aiReplies.google.success("OK"),
  };
  const requests: AiMock["requests"] = [];
  server.reply((request) => {
    const provider = providerOf(request.url);
    requests.push({ ...request, provider });
    if (!provider) return { status: 404, json: { error: "unknown path" } };
    const next = queues[provider].shift() ?? defaults[provider];
    return typeof next === "function" ? next(request) : next;
  });
  return {
    url: server.url,
    env: {
      AI_OPENAI_BASE_URL: `${server.url}/openai/v1`,
      AI_ANTHROPIC_BASE_URL: `${server.url}/anthropic`,
      AI_GOOGLE_BASE_URL: `${server.url}/google/v1beta`,
    },
    requests,
    queue: (provider, ...replies) => {
      queues[provider].push(...replies);
    },
    setDefault: (provider, reply) => {
      defaults[provider] = reply;
    },
    reset: () => {
      requests.length = 0;
      for (const provider of Object.keys(queues) as AiProvider[]) queues[provider].length = 0;
    },
    close: server.close,
  };
};

/** Points the AI layer at the mock (process.env); returns a function that restores the env. */
export const useAiMock = (mock: AiMock) => {
  const saved = Object.fromEntries(Object.keys(mock.env).map((key) => [key, process.env[key]]));
  Object.assign(process.env, mock.env);
  return () => {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  };
};
