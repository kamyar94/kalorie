// OpenAI adapter on the Responses API (POST /v1/responses), written with plain fetch.
// Images go in as input_image data URLs; JSON replies use text.format of type json_schema.
// store: false keeps OpenAI from storing the exchange for later retrieval. Reasoning effort goes
// in reasoning.effort (adapted from the Lingo project).
// Reference: https://developers.openai.com/api/docs/guides/structured-outputs
import { baseUrlFor, DEFAULT_MAX_OUTPUT_TOKENS, requestTimeoutMs } from "../config";
import { AiError, cleanProviderMessage, kindForStatus } from "../errors";
import {
  asNumber,
  asRecord,
  parseModelJson,
  postJson,
  retryAfterSeconds,
  type ProviderReply,
} from "../http";
import type { AdapterOptions, AiAdapter, AiResponse, AiUsage } from "../types";

const schemaName = (name: string) => name.replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 64) || "answer";

const toError = (reply: ProviderReply, apiKey: string) => {
  const error = asRecord(asRecord(reply.body).error);
  const code = String(error.code ?? error.type ?? "");
  let kind = kindForStatus(reply.status);
  if (code === "insufficient_quota") kind = "quota";
  if (code === "invalid_api_key") kind = "auth";
  return new AiError(kind, cleanProviderMessage(error.message, apiKey), {
    provider: "openai",
    status: reply.status,
    retryAfter: retryAfterSeconds(reply.headers),
  });
};

export const createOpenAiAdapter = (options: AdapterOptions): AiAdapter => {
  const baseUrl = (options.baseUrl ?? baseUrlFor("openai")).replace(/\/+$/, "");

  return {
    provider: "openai",
    async send(request): Promise<AiResponse> {
      const content: Record<string, unknown>[] = [
        { type: "input_text", text: request.prompt },
        ...(request.images ?? []).map((image) => ({
          type: "input_image",
          image_url: `data:${image.mediaType};base64,${image.data}`,
        })),
      ];
      const body: Record<string, unknown> = {
        model: request.model,
        input: [
          ...(request.history ?? []).map((turn) => ({
            role: turn.role,
            content: turn.text,
          })),
          { role: "user", content },
        ],
        max_output_tokens: request.maxOutputTokens ?? DEFAULT_MAX_OUTPUT_TOKENS,
        store: false,
      };
      if (request.system) body.instructions = request.system;
      if (request.reasoning)
        body.reasoning = { effort: request.reasoning === "minimal" ? "low" : request.reasoning };
      if (request.json)
        body.text = {
          format: {
            type: "json_schema",
            name: schemaName(request.json.name),
            schema: request.json.schema,
            strict: true,
          },
        };

      const reply = await postJson(
        "openai",
        `${baseUrl}/responses`,
        { authorization: `Bearer ${options.apiKey}` },
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
        inputTokens: asNumber(rawUsage.input_tokens),
        outputTokens: asNumber(rawUsage.output_tokens),
      };
      const model = typeof data.model === "string" ? data.model : request.model;

      let text = "";
      let refusal = "";
      for (const item of Array.isArray(data.output) ? data.output : []) {
        const entry = asRecord(item);
        if (entry.type !== "message") continue;
        for (const part of Array.isArray(entry.content) ? entry.content : []) {
          const piece = asRecord(part);
          if (piece.type === "output_text" && typeof piece.text === "string") text += piece.text;
          if (piece.type === "refusal" && typeof piece.refusal === "string")
            refusal += piece.refusal;
        }
      }

      const status = typeof data.status === "string" ? data.status : undefined;
      if (refusal && !text)
        throw new AiError("refusal", cleanProviderMessage(refusal), {
          provider: "openai",
          usage,
        });
      if (status === "incomplete") {
        const reason = String(asRecord(data.incomplete_details).reason ?? "");
        throw new AiError(
          reason === "content_filter" ? "refusal" : "incomplete",
          reason ? `Stopped early: ${reason}.` : "Stopped early.",
          { provider: "openai", usage },
        );
      }
      if (status === "failed") {
        const error = asRecord(data.error);
        throw new AiError("server", cleanProviderMessage(error.message, options.apiKey), {
          provider: "openai",
          usage,
        });
      }

      return {
        provider: "openai",
        model,
        text,
        json: request.json ? parseModelJson("openai", text, usage) : undefined,
        usage,
        stopReason: status,
      };
    },
  };
};
