import type { NextConfig } from "next";

// Security headers for every response. The Content-Security-Policy needs a fresh nonce per
// request, so proxy.ts sets it.
const SECURITY_HEADERS = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "same-origin" },
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
  { key: "Cross-Origin-Resource-Policy", value: "same-origin" },
  { key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" },
  {
    // The camera and microphone are for Kal's own pages only (capture and dictated notes).
    key: "Permissions-Policy",
    value:
      "camera=(self), microphone=(self), geolocation=(), payment=(), usb=(), bluetooth=(), interest-cohort=()",
  },
];

const nextConfig: NextConfig = {
  output: "standalone",
  poweredByHeader: false,
  reactStrictMode: true,
  devIndicators: false,
  images: { unoptimized: true },
  serverExternalPackages: ["sharp"],
  experimental: {
    // Uploads are up to 25 MB (3 photos); the proxy must let them through to the route.
    proxyClientMaxBodySize: "26mb",
  },
  outputFileTracingExcludes: {
    "/*": ["./docs/**/*", "./tests/**/*", "./deploy/**/*", "./data/**/*", "./.worktrees/**/*"],
  },
  headers: async () => [
    { source: "/(.*)", headers: SECURITY_HEADERS },
    {
      // The service worker must always be fetched fresh so updates reach installed apps.
      source: "/sw.js",
      headers: [
        { key: "Cache-Control", value: "no-cache, no-store, must-revalidate" },
        { key: "Service-Worker-Allowed", value: "/" },
      ],
    },
    {
      source: "/icons/(.*)",
      headers: [{ key: "Cache-Control", value: "public, max-age=604800" }],
    },
  ],
};

export default nextConfig;
