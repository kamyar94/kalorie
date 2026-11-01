import { NextResponse, type NextRequest } from "next/server";

import { buildCsp, isSameOrigin, newNonce } from "@/lib/security/csp";

// First gate for every page and API request:
//  1. state-changing requests must come from Cal's own pages (CSRF);
//  2. without a session cookie, pages redirect to sign-in and API routes answer 401 (every page
//     and route still checks the session itself against the database);
//  3. a fresh CSP nonce for the page render.
const SESSION_COOKIE = "cal_session";
const PUBLIC_PAGES = new Set(["/", "/sign-in", "/invite", "/reset", "/offline"]);
const PUBLIC_API = new Set(["/api/health"]);
const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

export function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;
  const isApi = pathname.startsWith("/api/");

  if (!SAFE_METHODS.has(req.method) && !isSameOrigin(req.headers))
    return NextResponse.json({ error: "Cross-site request refused." }, { status: 403 });

  const signedIn = req.cookies.has(SESSION_COOKIE);
  if (!signedIn && !(isApi ? PUBLIC_API.has(pathname) : PUBLIC_PAGES.has(pathname))) {
    if (isApi) return NextResponse.json({ error: "Sign in first." }, { status: 401 });
    // Built from the forwarded protocol and host, so it stays on https behind the tunnel.
    const proto =
      req.headers.get("x-forwarded-proto")?.split(",")[0] || req.nextUrl.protocol.replace(":", "");
    const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host") ?? req.nextUrl.host;
    return NextResponse.redirect(new URL("/sign-in", `${proto}://${host}`));
  }

  const nonce = newNonce();
  const csp = buildCsp(nonce, {
    dev: process.env.NODE_ENV === "development",
    upgrade: process.env.COOKIE_SECURE !== "false",
  });
  const requestHeaders = new Headers(req.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("Content-Security-Policy", csp);
  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set("Content-Security-Policy", csp);
  return response;
}

export const config = {
  matcher: [
    // Everything except build assets, icons and the files the browser fetches on its own.
    "/((?!_next/static|_next/image|icons/|vendor/|favicon.ico|sw.js|manifest.webmanifest|robots.txt).*)",
  ],
};
