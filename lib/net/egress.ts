// Outbound HTTP for every call that leaves the server (AI providers, Open Food Facts, Mealie,
// openGym, Web Push). Node's built-in fetch ignores HTTPS_PROXY, so when EGRESS_PROXY_URL is set
// (the Squid allowlist proxy of the Docker stack) requests go through undici's ProxyAgent: HTTPS
// targets through a CONNECT tunnel, so the proxy sees only the host. A proxy that is down makes
// the request fail; it never falls back to a direct connection. Nothing here logs URLs, headers
// or bodies.
import { fetch as undiciFetch, ProxyAgent, type Dispatcher, type RequestInit } from "undici";

export type Env = Record<string, string | undefined>;

let proxy: { url: string; agent: ProxyAgent } | null = null;

/** The proxy URL in force: EGRESS_PROXY_URL, or AI_PROXY_URL as used by the Lingo layout. */
export const egressProxyUrl = (env: Env = process.env) =>
  (env.EGRESS_PROXY_URL || env.AI_PROXY_URL || "").trim() || null;

export const egressDispatcher = (env: Env = process.env): Dispatcher | undefined => {
  const url = egressProxyUrl(env);
  if (!url) return undefined;
  if (proxy?.url !== url) {
    void proxy?.agent.close().catch(() => undefined);
    proxy = { url, agent: new ProxyAgent(url) };
  }
  return proxy.agent;
};

/** fetch through the egress proxy when one is configured. */
export const egressFetch = (url: string, init: RequestInit = {}, env: Env = process.env) =>
  undiciFetch(url, { ...init, dispatcher: egressDispatcher(env) });
