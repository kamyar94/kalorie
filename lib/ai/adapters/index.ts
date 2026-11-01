import type { AdapterOptions, AiAdapter, AiProvider } from "../types";

import { createAnthropicAdapter } from "./anthropic";
import { createGoogleAdapter } from "./google";
import { createOpenAiAdapter } from "./openai";

const FACTORIES: Record<AiProvider, (options: AdapterOptions) => AiAdapter> = {
  openai: createOpenAiAdapter,
  anthropic: createAnthropicAdapter,
  google: createGoogleAdapter,
};

/** The adapter of one provider, bound to one key. */
export const createAdapter = (provider: AiProvider, options: AdapterOptions): AiAdapter =>
  FACTORIES[provider](options);

export { createAnthropicAdapter, createGoogleAdapter, createOpenAiAdapter };
