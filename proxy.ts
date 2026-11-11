import { NextResponse, type NextRequest } from "next/server";

import { buildCsp, isSameOrigin, newNonce } from "@/lib/security/csp";

// First gate for every page and API request:
//  1. state-changing requests must come from Kal's own pages (CSRF);
//  2. without a session cookie, pages redirect to sign-in and API routes answer 401 (every page
//     and route still checks the session itself against the database);
//  3. a fresh CSP nonce for the page render.
const SESSION_COOKIE = "cal_session";
// Public too: the Digital Asset Links file and the Android app's update check (lib/android).
const PUBLIC_PAGES = new Set([
  "/",
  "/sign-in",
  "/invite",
  "/reset",
  "/offline",
  "/.well-known/assetlinks.json",
  "/android/version.json",
]);
// The Android app's own calls (lib/devices/http.ts) carry a one-time code or the phone's device
// token instead of the session cookie. A page elsewhere cannot add that token, so they need neither
// the cookie nor the same-origin check (the routes check the token themselves).
const DEVICE_API = new Set(["/api/devices/claim", "/api/devices/self", "/api/health-connect/sync"]);
const PUBLIC_API = new Set(["/api/health", ...DEVICE_API]);
const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

export function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;
  const isApi = pathname.startsWith("/api/");

  if (!SAFE_METHODS.has(req.method) && !DEVICE_API.has(pathname) && !isSameOrigin(req.headers))
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
