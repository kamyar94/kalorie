// The Content-Security-Policy (set per request by proxy.ts with a fresh nonce). Scripts run only
// with the nonce ('strict-dynamic' lets Next.js load its own chunks); no eval outside development.
// 'wasm-unsafe-eval' allows compiling WebAssembly only (the ZXing barcode reader), not eval().
// Inline style attributes are allowed because UI primitives position elements with them; style
// injection cannot run code. Photos are same-origin; blob: covers previews of photos about to be
// uploaded and the camera stream.
export const buildCsp = (nonce: string, options: { dev: boolean; upgrade: boolean }) =>
  [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic' 'wasm-unsafe-eval'${options.dev ? " 'unsafe-eval'" : ""}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' blob: data:",
    "media-src 'self' blob:",
    "font-src 'self'",
    `connect-src 'self'${options.dev ? " ws: wss:" : ""}`,
    "worker-src 'self'",
    "manifest-src 'self'",
    "frame-src 'none'",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    ...(options.upgrade ? ["upgrade-insecure-requests"] : []),
  ].join("; ");

/** A fresh nonce: 16 random bytes, base64. Works in the proxy's runtime (Web Crypto). */
export const newNonce = () => {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return btoa(String.fromCharCode(...bytes));
};

/**
 * Same-origin check for state-changing requests (CSRF). The Origin header must name this host
 * (x-forwarded-host first, as behind the tunnel); without Origin, Sec-Fetch-Site must say
 * same-origin. Requests with neither are refused.
 */
export const isSameOrigin = (headers: Headers) => {
  const host = (headers.get("x-forwarded-host") ?? headers.get("host") ?? "").split(",")[0]!.trim();
  const origin = headers.get("origin");
  if (origin && origin !== "null") {
    try {
      return new URL(origin).host === host;
    } catch {
      return false;
    }
  }
  return headers.get("sec-fetch-site") === "same-origin";
};
