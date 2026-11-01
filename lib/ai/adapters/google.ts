// Google Gemini adapter on generateContent (POST /v1beta/models/MODEL:generateContent), written
// with plain fetch. Images go in as inlineData parts; JSON replies use responseMimeType
// application/json with responseJsonSchema. The key travels in the x-goog-api-key header, never
// in the URL. Reasoning effort goes in generationConfig.thinkingConfig.thinkingLevel (Gemini 3).
// Adapted from the Lingo project.
// Reference: https://ai.google.dev/api/generate-content
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
import type { AdapterOptions, AiAdapter, AiResponse, AiUsage } from "../types";

const KINDS: Record<string, AiErrorKind> = {
  UNAUTHENTICATED: "auth",
  PERMISSION_DENIED: "auth",
  RESOURCE_EXHAUSTED: "rate-limit",
  INVALID_ARGUMENT: "bad-request",
  FAILED_PRECONDITION: "bad-request",
  NOT_FOUND: "bad-request",
  UNAVAILABLE: "overloaded",
  INTERNAL: "server",
  DEADLINE_EXCEEDED: "timeout",
};

// Finish reasons that mean the reply was withheld rather than cut off.
const BLOCKED = new Set([
  "SAFETY",
  "RECITATION",
  "BLOCKLIST",
  "PROHIBITED_CONTENT",
  "SPII",
  "IMAGE_SAFETY",
  "IMAGE_PROHIBITED_CONTENT",
  "LANGUAGE",
]);

const toError = (reply: ProviderReply, apiKey: string) => {
  const error = asRecord(asRecord(reply.body).error);
  const message = cleanProviderMessage(error.message, apiKey);
  const details = JSON.stringify(error.details ?? "");
  let kind = KINDS[String(error.status)] ?? kindForStatus(reply.status);
  // An unknown key is a 400 INVALID_ARGUMENT with the reason API_KEY_INVALID.
  if (details.includes("API_KEY_INVALID") || /api key not valid/i.test(message)) kind = "auth";
  return new AiError(kind, message, {
    provider: "google",
    status: reply.status,
    retryAfter: retryAfterSeconds(reply.headers),
  });
};

export const createGoogleAdapter = (options: AdapterOptions): AiAdapter => {
  const baseUrl = (options.baseUrl ?? baseUrlFor("google")).replace(/\/+$/, "");

  return {
    provider: "google",
    async send(request): Promise<AiResponse> {
      const generationConfig: Record<string, unknown> = {
        maxOutputTokens: request.maxOutputTokens ?? DEFAULT_MAX_OUTPUT_TOKENS,
      };
      if (request.json) {
        generationConfig.responseMimeType = "application/json";
        generationConfig.responseJsonSchema = request.json.schema;
      }
      if (request.reasoning)
        generationConfig.thinkingConfig = {
          thinkingLevel: request.reasoning === "none" ? "minimal" : request.reasoning,
        };
      const body: Record<string, unknown> = {
        contents: [
          ...(request.history ?? []).map((turn) => ({
            role: turn.role === "assistant" ? "model" : "user",
            parts: [{ text: turn.text }],
          })),
          {
            role: "user",
            parts: [
              { text: request.prompt },
              ...(request.images ?? []).map((image) => ({
                inlineData: { mimeType: image.mediaType, data: image.data },
              })),
            ],
          },
        ],
        generationConfig,
      };
      if (request.system) body.systemInstruction = { parts: [{ text: request.system }] };

      const reply = await postJson(
        "google",
        `${baseUrl}/models/${encodeURIComponent(request.model)}:generateContent`,
        { "x-goog-api-key": options.apiKey },
        body,
        {
          timeoutMs: options.timeoutMs ?? requestTimeoutMs(),
          signal: request.signal,
        },
      );
      if (reply.status < 200 || reply.status >= 300) throw toError(reply, options.apiKey);

      const data = asRecord(reply.body);
      const meta = asRecord(data.usageMetadata);
      const usage: AiUsage = {
        inputTokens: asNumber(meta.promptTokenCount),
        // Thinking tokens are billed as output.
        outputTokens: asNumber(meta.candidatesTokenCount) + asNumber(meta.thoughtsTokenCount),
      };
      const model = typeof data.modelVersion === "string" ? data.modelVersion : request.model;

      const blockReason = asRecord(data.promptFeedback).blockReason;
      if (blockReason)
        throw new AiError("refusal", `The request was blocked (${String(blockReason)}).`, {
          provider: "google",
          usage,
        });

      const candidate = asRecord(Array.isArray(data.candidates) ? data.candidates[0] : undefined);
      const finishReason =
        typeof candidate.finishReason === "string" ? candidate.finishReason : undefined;
      const parts = asRecord(candidate.content).parts;
      const text = (Array.isArray(parts) ? parts : [])
        .map(asRecord)
        .filter((part) => part.thought !== true && typeof part.text === "string")
        .map((part) => part.text as string)
        .join("");

      if (finishReason && BLOCKED.has(finishReason))
        throw new AiError("refusal", `The reply was withheld (${finishReason}).`, {
          provider: "google",
          usage,
        });
      if (finishReason === "MAX_TOKENS")
        throw new AiError("incomplete", "Stopped at the token limit.", {
          provider: "google",
          usage,
        });

      return {
        provider: "google",
        model,
        text,
        json: request.json ? parseModelJson("google", text, usage) : undefined,
        usage,
        stopReason: finishReason,
      };
    },
  };
};
