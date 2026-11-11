// Server-side settings of the integrations (docs/DESIGN.md section 8). The Mealie and openGym
// addresses are set on the server only, never typed by a person, so nobody can point Kal's server
// at another address (no server-side request forgery). An integration without its address is
// shown as "not set up on this server".
//
//   MEALIE_BASE_URL          for example https://mealie.example.org
//   OPENGYM_BASE_URL         for example https://gym.example.org
//   INTEGRATION_TIMEOUT_MS   per request, default 8000
import type { IntegrationKind } from "@/lib/contracts/integrations";

export type Env = Record<string, string | undefined>;

export type IntegrationConfig = {
  mealieBaseUrl: string | null;
  opengymBaseUrl: string | null;
  timeoutMs: number;
};

/** An http(s) origin plus optional path, without a trailing slash, or null. */
export const cleanBaseUrl = (value: string | undefined) => {
  const text = value?.trim();
  if (!text) return null;
  try {
    const url = new URL(text);
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    if (url.username || url.password || url.search || url.hash) return null;
    return `${url.origin}${url.pathname}`.replace(/\/+$/, "");
  } catch {
    return null;
  }
};

export const integrationConfig = (env: Env = process.env): IntegrationConfig => {
  const timeout = Number(env.INTEGRATION_TIMEOUT_MS);
  return {
    mealieBaseUrl: cleanBaseUrl(env.MEALIE_BASE_URL),
    opengymBaseUrl: cleanBaseUrl(env.OPENGYM_BASE_URL),
    timeoutMs: Number.isFinite(timeout) && timeout > 0 ? Math.min(timeout, 60_000) : 8000,
  };
};

export const baseUrlFor = (kind: IntegrationKind, env: Env = process.env) => {
  const config = integrationConfig(env);
  return kind === "mealie" ? config.mealieBaseUrl : config.opengymBaseUrl;
};
