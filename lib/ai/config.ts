// Provider addresses and default models. The base URLs are server settings only, never taken from
// the web interface, so nobody can point the app at another address. Each can be overridden with
// an environment variable (used by tests with a local mock server); in the Docker stack the
// egress proxy allows only the three public API hosts anyway.
//
// Model names are settings each person can change. The defaults below were checked against each
// provider's public model documentation on 31 October 2026 (checked twice that day; the second
// check also set the per-task defaults):
//   OpenAI     https://developers.openai.com/api/docs/models
//              gpt-6.1-sol: lower-cost flagship, image input, effort low..max (no "none").
//              gpt-6-luna: efficient high-volume model, effort none..max.
//   Anthropic  https://platform.claude.com/docs/en/about-claude/models/overview
//              claude-sonnet-5-5: speed and intelligence, vision. claude-haiku-5-5: fastest.
//   Google     https://ai.google.dev/gemini-api/docs/models
//              gemini-3.8-flash: current stable Flash. gemini-3.5-flash-lite: fastest, cheapest.
//              https://ai.google.dev/gemini-api/docs/thinking: thinking levels are low, medium,
//              high on gemini-3.8-flash (default medium; no "minimal") and minimal..high on
//              gemini-3.5-flash-lite; thinking tokens count against the output token limit.
// Analysis: Gemini Flash at low effort is the suggested default (docs/DESIGN.md section 4);
// matching is a short text-only choice, so the small models at low effort (accepted by all six).
// Providers retire models over time, so treat them as editable starting points.
import type { AiProvider, AiTask, ReasoningEffort } from "./types";

/** Environment variables, as process.env or a plain object in tests. */
export type Env = Record<string, string | undefined>;

export const DEFAULT_BASE_URLS: Record<AiProvider, string> = {
  openai: "https://api.openai.com/v1",
  anthropic: "https://api.anthropic.com",
  google: "https://generativelanguage.googleapis.com/v1beta",
};

const BASE_URL_ENV: Record<AiProvider, string> = {
  openai: "AI_OPENAI_BASE_URL",
  anthropic: "AI_ANTHROPIC_BASE_URL",
  google: "AI_GOOGLE_BASE_URL",
};

export const baseUrlFor = (provider: AiProvider, env: Env = process.env) =>
  (env[BASE_URL_ENV[provider]] || DEFAULT_BASE_URLS[provider]).replace(/\/+$/, "");

/**
 * Analysis needs vision and good judgement of amounts; matching is a short text-only choice, so
 * a small model is enough. Google's Flash model at low effort is the suggested default for
 * analysis (docs/DESIGN.md section 4).
 */
export const DEFAULT_MODELS: Record<AiProvider, Record<AiTask, string>> = {
  openai: { analysis: "gpt-6.1-sol", matching: "gpt-6-luna" },
  anthropic: { analysis: "claude-sonnet-5-5", matching: "claude-haiku-5-5" },
  google: { analysis: "gemini-3.8-flash", matching: "gemini-3.5-flash-lite" },
};

/** Effort used when the person has not chosen one (undefined: the provider's default). */
export const DEFAULT_REASONING: Record<AiTask, ReasoningEffort | undefined> = {
  analysis: "low",
  // "low" is accepted by every default and suggested model; "minimal" and "none" are not.
  matching: "low",
};

/** The provider suggested for a new account with keys for several providers. */
export const PREFERRED_PROVIDER_ORDER: readonly AiProvider[] = ["google", "openai", "anthropic"];

/** Model names shown as suggestions next to the model fields; any other name can be typed. */
export const SUGGESTED_MODELS: Record<AiProvider, string[]> = {
  openai: ["gpt-6.1-sol", "gpt-6-astra", "gpt-6.1-terra", "gpt-6-luna"],
  anthropic: ["claude-sonnet-5-5", "claude-opus-5-5", "claude-haiku-5-5", "claude-fable-5-1"],
  google: [
    "gemini-3.8-flash",
    "gemini-3.6-flash",
    "gemini-3.5-flash-lite",
    "gemini-3.1-flash-lite",
  ],
};

export const DEFAULT_MAX_OUTPUT_TOKENS = 4096;

export const requestTimeoutMs = (env: Env = process.env) => {
  const value = Number(env.AI_REQUEST_TIMEOUT_MS);
  return Number.isFinite(value) && value > 0 ? value : 120_000;
};

/**
 * Model names are short identifiers (letters, digits, dot, dash, underscore and the colons of
 * fine-tuned OpenAI names); anything else is refused before it reaches a request.
 */
export const isValidModelName = (value: string) =>
  /^[A-Za-z0-9][A-Za-z0-9._:-]{0,99}$/.test(value) && !value.includes("..");
