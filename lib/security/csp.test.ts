import { describe, expect, it } from "vitest";

import { buildCsp, isSameOrigin, newNonce } from "./csp";

const headers = (values: Record<string, string>) => new Headers(values);

describe("same-origin check", () => {
  it("accepts the app's own origin, also behind the tunnel", () => {
    expect(isSameOrigin(headers({ host: "127.0.0.1:3201", origin: "http://127.0.0.1:3201" }))).toBe(
      true,
    );
    expect(
      isSameOrigin(
        headers({
          host: "app:3000",
          "x-forwarded-host": "cal.example.org",
          origin: "https://cal.example.org",
        }),
      ),
    ).toBe(true);
    expect(
      isSameOrigin(headers({ host: "cal.example.org", "sec-fetch-site": "same-origin" })),
    ).toBe(true);
  });

  it("refuses other sites, null origins and requests that say nothing", () => {
    expect(
      isSameOrigin(headers({ host: "cal.example.org", origin: "https://evil.example.net" })),
    ).toBe(false);
    expect(isSameOrigin(headers({ host: "cal.example.org", origin: "null" }))).toBe(false);
    expect(isSameOrigin(headers({ host: "cal.example.org", "sec-fetch-site": "cross-site" }))).toBe(
      false,
    );
    expect(isSameOrigin(headers({ host: "cal.example.org" }))).toBe(false);
    expect(isSameOrigin(headers({ host: "cal.example.org", origin: "not a url" }))).toBe(false);
  });
});

describe("content security policy", () => {
  it("allows scripts only with the nonce and no eval in production", () => {
    const nonce = newNonce();
    const csp = buildCsp(nonce, { dev: false, upgrade: true });
    expect(csp).toContain(`script-src 'self' 'nonce-${nonce}' 'strict-dynamic'`);
    expect(csp).not.toContain("'unsafe-eval'");
    // WebAssembly (the barcode reader) may compile; eval() stays blocked.
    expect(csp).toContain("'wasm-unsafe-eval'");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("connect-src 'self'");
    expect(csp).toContain("upgrade-insecure-requests");
    expect(buildCsp(nonce, { dev: true, upgrade: false })).toContain("'unsafe-eval'");
    expect(newNonce()).not.toBe(nonce);
  });
});
