// One error type for every provider, with a kind the interface can explain to the person
// (adapted from the Lingo project).
// Messages never contain the API key or the request body: provider messages are cleaned of
// anything that looks like a key before they are kept.
import type { AiProvider, AiUsage } from "./types";

export type AiErrorKind =
  | "config" // the server is missing a setting such as CAL_SECRET_KEY
  | "no-key" // the person has not saved a key for the provider
  | "auth" // the provider refused the key
  | "rate-limit" // the provider's rate limit
  | "quota" // the account behind the key has no credit or quota left
  | "local-rate-limit" // Cal's own limit per account
  | "bad-request" // the provider refused the request (unknown model, bad schema...)
  | "overloaded" // the provider is busy, try again later
  | "server" // the provider failed
  | "network" // the provider could not be reached (proxy, DNS, connection)
  | "timeout"
  | "refusal" // the model declined to answer
  | "incomplete" // the reply hit the token limit
  | "invalid-output"; // the reply was not the JSON that was asked for

export class AiError extends Error {
  readonly kind: AiErrorKind;
  readonly provider?: AiProvider;
  readonly status?: number;
  /** Seconds to wait before trying again, when known. */
  readonly retryAfter?: number;
  /** Tokens the provider billed although the reply was unusable (refusal, cut off, bad JSON). */
  readonly usage?: AiUsage;

  constructor(
    kind: AiErrorKind,
    message: string,
    options: {
      provider?: AiProvider;
      status?: number;
      retryAfter?: number;
      usage?: AiUsage;
    } = {},
  ) {
    super(message);
    this.name = "AiError";
    this.kind = kind;
    this.provider = options.provider;
    this.status = options.status;
    this.retryAfter = options.retryAfter;
    this.usage = options.usage;
  }
}

export const isAiError = (error: unknown): error is AiError => error instanceof AiError;

// Shapes of API keys of the three providers, and bearer tokens in general.
const KEY_PATTERNS = [
  /sk-[A-Za-z0-9_*.-]{6,}/g,
  /AIza[0-9A-Za-z_-]{10,}/g,
  /Bearer\s+[A-Za-z0-9._~+/=-]+/gi,
];

/** Removes the key itself and anything key-shaped from a provider message, and shortens it. */
export const cleanProviderMessage = (message: unknown, apiKey?: string) => {
  let text = typeof message === "string" ? message : "";
  if (apiKey && apiKey.length >= 4) text = text.split(apiKey).join("[key]");
  for (const pattern of KEY_PATTERNS) text = text.replace(pattern, "[key]");
  text = text.replace(/\s+/g, " ").trim();
  return text.length > 300 ? `${text.slice(0, 297)}...` : text;
};

/** Error kind for an HTTP status, before provider-specific details refine it. */
export const kindForStatus = (status: number): AiErrorKind => {
  if (status === 401 || status === 403) return "auth";
  if (status === 429) return "rate-limit";
  if (status === 402) return "quota";
  if (status === 529 || status === 503) return "overloaded";
  if (status === 408 || status === 504) return "timeout";
  if (status >= 500) return "server";
  return "bad-request";
};

/** A short sentence for the person, without technical detail. */
export const describeAiError = (error: unknown) => {
  if (!isAiError(error)) return "Something went wrong with the AI request.";
  switch (error.kind) {
    case "config":
      return "AI features are not set up on this server yet.";
    case "no-key":
      return "Save an API key on the AI settings page first.";
    case "auth":
      return "The provider did not accept the key. Check or replace it.";
    case "rate-limit":
      return "The provider's rate limit was reached. Try again in a minute.";
    case "quota":
      return "The provider account behind this key has no credit or quota left.";
    case "local-rate-limit":
      return "Too many AI requests in a short time. Try again shortly.";
    case "bad-request":
      return `The provider refused the request${error.message ? `: ${error.message}` : "."}`;
    case "overloaded":
      return "The provider is busy right now. Try again shortly.";
    case "server":
      return "The provider had a problem. Try again shortly.";
    case "network":
      return "The provider could not be reached from this server.";
    case "timeout":
      return "The provider took too long to answer.";
    case "refusal":
      return "The model declined to answer this request.";
    case "incomplete":
      return "The answer was cut off by the token limit.";
    case "invalid-output":
      return "The model's answer was not in the expected format.";
  }
};

/** Whether trying the same request again later may work (the job queue retries these). */
export const isRetryableAiError = (error: unknown) =>
  isAiError(error) &&
  ["rate-limit", "overloaded", "server", "network", "timeout", "local-rate-limit"].includes(
    error.kind,
  );

/** Errors the person must fix in the AI settings (shown with a link there). */
export const needsAiSettings = (error: unknown) =>
  isAiError(error) && ["no-key", "auth", "quota", "config"].includes(error.kind);
