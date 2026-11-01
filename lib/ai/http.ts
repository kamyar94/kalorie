// The one place that sends requests to AI providers (adapted from the Lingo project). Requests go
// through the egress proxy when one is configured (lib/net/egress.ts). Nothing here logs URLs with
// keys, headers or bodies.
import { egressFetch } from "@/lib/net/egress";

import type { Env } from "./config";
import { AiError } from "./errors";
import type { AiProvider, AiUsage } from "./types";

export type ProviderReply = {
  status: number;
  headers: Headers;
  /** Parsed JSON body, or undefined when the body was not JSON. */
  body: unknown;
};

/**
 * POSTs JSON to a provider and returns the status and parsed body. Throws AiError for network
 * failures and timeouts only; HTTP errors are returned for the adapter to interpret.
 */
export const postJson = async (
  provider: AiProvider,
  url: string,
  headers: Record<string, string>,
  body: unknown,
  options: { timeoutMs: number; signal?: AbortSignal; env?: Env },
): Promise<ProviderReply> => {
  const timeout = AbortSignal.timeout(options.timeoutMs);
  const signal = options.signal ? AbortSignal.any([options.signal, timeout]) : timeout;

  let response;
  try {
    response = await egressFetch(
      url,
      {
        method: "POST",
        headers: { "content-type": "application/json", ...headers },
        body: JSON.stringify(body),
        signal,
      },
      options.env ?? process.env,
    );
  } catch (error) {
    if (timeout.aborted)
      throw new AiError("timeout", "The provider did not answer in time.", { provider });
    if (options.signal?.aborted) throw error;
    throw new AiError("network", "The provider could not be reached.", { provider });
  }

  let text = "";
  try {
    text = await response.text();
  } catch {
    if (timeout.aborted)
      throw new AiError("timeout", "The provider did not answer in time.", { provider });
    throw new AiError("network", "The connection to the provider broke off.", { provider });
  }

  let parsed: unknown;
  try {
    parsed = text ? JSON.parse(text) : undefined;
  } catch {
    parsed = undefined;
  }

  return {
    status: response.status,
    headers: response.headers as unknown as Headers,
    body: parsed,
  };
};

/** Seconds from a Retry-After header, when the provider sent one. */
export const retryAfterSeconds = (headers: Headers) => {
  const value = headers.get("retry-after");
  if (!value) return undefined;
  const seconds = Number(value);
  if (Number.isFinite(seconds)) return Math.max(0, Math.round(seconds));
  const date = Date.parse(value);
  return Number.isNaN(date) ? undefined : Math.max(0, Math.round((date - Date.now()) / 1000));
};

export const asRecord = (value: unknown): Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

export const asNumber = (value: unknown) =>
  typeof value === "number" && Number.isFinite(value) ? value : 0;

/** Parses the JSON a model returned; tolerates a ```json fence around it. */
export const parseModelJson = (provider: AiProvider, text: string, usage?: AiUsage) => {
  const trimmed = text
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "");
  try {
    return JSON.parse(trimmed) as unknown;
  } catch {
    throw new AiError("invalid-output", "The reply was not valid JSON.", {
      provider,
      usage,
    });
  }
};
