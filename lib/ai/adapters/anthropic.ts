// Anthropic adapter on the Messages API (POST /v1/messages), written with plain fetch.
// Images go in as base64 image blocks before the text; JSON replies use structured outputs
// (output_config.format of type json_schema), which needs no beta header. Reasoning effort goes in
// output_config.effort (low, medium, high), also without a beta header. Adapted from the Lingo
// project.
// Reference: https://platform.claude.com/docs/en/build-with-claude/effort
// Reference: https://platform.claude.com/docs/en/build-with-claude/structured-outputs
import { baseUrlFor, DEFAULT_MAX_OUTPUT_TOKENS, requestTimeoutMs } from "../config";
import { AiError, cleanProviderMessage, kindForStatus, type AiErrorKind } from "../errors";
import {
  asNumber,
  asRecord,
  parseModelJson,
  postJson,
  retryAfterSeconds,
  type ProviderReply,
} from "../http";
import type { AdapterOptions, AiAdapter, AiResponse, AiUsage, ReasoningEffort } from "../types";

export const ANTHROPIC_VERSION = "2023-06-01";

// Claude's effort levels start at low; none and minimal map to it.
const ANTHROPIC_EFFORT: Record<ReasoningEffort, string> = {
  none: "low",
  minimal: "low",
  low: "low",
  medium: "medium",
  high: "high",
};

const KINDS: Record<string, AiErrorKind> = {
  authentication_error: "auth",
  permission_error: "auth",
  rate_limit_error: "rate-limit",
  overloaded_error: "overloaded",
  billing_error: "quota",
  invalid_request_error: "bad-request",
  not_found_error: "bad-request",
  request_too_large: "bad-request",
  api_error: "server",
  timeout_error: "timeout",
};

const toError = (reply: ProviderReply, apiKey: string) => {
  const error = asRecord(asRecord(reply.body).error);
  const message = cleanProviderMessage(error.message, apiKey);
  let kind = KINDS[String(error.type)] ?? kindForStatus(reply.status);
  if (kind === "bad-request" && /credit balance/i.test(message)) kind = "quota";
  return new AiError(kind, message, {
    provider: "anthropic",
    status: reply.status,
    retryAfter: retryAfterSeconds(reply.headers),
  });
};

export const createAnthropicAdapter = (options: AdapterOptions): AiAdapter => {
  const baseUrl = (options.baseUrl ?? baseUrlFor("anthropic")).replace(/\/+$/, "");

  return {
    provider: "anthropic",
    async send(request): Promise<AiResponse> {
      const content: Record<string, unknown>[] = [
        ...(request.images ?? []).map((image) => ({
          type: "image",
          source: { type: "base64", media_type: image.mediaType, data: image.data },
        })),
        { type: "text", text: request.prompt },
      ];
      const body: Record<string, unknown> = {
        model: request.model,
        max_tokens: request.maxOutputTokens ?? DEFAULT_MAX_OUTPUT_TOKENS,
        messages: [
          ...(request.history ?? []).map((turn) => ({
            role: turn.role,
            content: turn.text,
          })),
          { role: "user", content },
        ],
      };
      if (request.system) body.system = request.system;
      const outputConfig: Record<string, unknown> = {};
      if (request.json) outputConfig.format = { type: "json_schema", schema: request.json.schema };
      if (request.reasoning) outputConfig.effort = ANTHROPIC_EFFORT[request.reasoning];
      if (Object.keys(outputConfig).length) body.output_config = outputConfig;

      const reply = await postJson(
        "anthropic",
        `${baseUrl}/v1/messages`,
        { "x-api-key": options.apiKey, "anthropic-version": ANTHROPIC_VERSION },
        body,
        {
          timeoutMs: options.timeoutMs ?? requestTimeoutMs(),
          signal: request.signal,
        },
      );
      if (reply.status < 200 || reply.status >= 300) throw toError(reply, options.apiKey);

      const data = asRecord(reply.body);
      const rawUsage = asRecord(data.usage);
      const usage: AiUsage = {
        inputTokens:
          asNumber(rawUsage.input_tokens) +
          asNumber(rawUsage.cache_creation_input_tokens) +
          asNumber(rawUsage.cache_read_input_tokens),
        outputTokens: asNumber(rawUsage.output_tokens),
      };
      const model = typeof data.model === "string" ? data.model : request.model;

      // Thinking blocks may come first; the answer is in the text blocks.
      const text = (Array.isArray(data.content) ? data.content : [])
        .map(asRecord)
        .filter((block) => block.type === "text" && typeof block.text === "string")
        .map((block) => block.text as string)
        .join("");

      const stopReason = typeof data.stop_reason === "string" ? data.stop_reason : undefined;
      if (stopReason === "refusal")
        throw new AiError("refusal", "The model declined to answer.", {
          provider: "anthropic",
          usage,
        });
      if (stopReason === "max_tokens")
        throw new AiError("incomplete", "Stopped at the token limit.", {
          provider: "anthropic",
          usage,
        });

      return {
        provider: "anthropic",
        model,
        text,
        json: request.json ? parseModelJson("anthropic", text, usage) : undefined,
        usage,
        stopReason,
      };
    },
  };
};
