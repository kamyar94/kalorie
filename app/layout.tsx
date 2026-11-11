import "./globals.css";

import type { Metadata, Viewport } from "next";
import { cookies } from "next/headers";
import type { ReactNode } from "react";

import { PwaRegister } from "@/components/app/pwa-register";
import { ToastProvider } from "@/components/ui/toast";
import { THEME_COOKIE, parseTheme } from "@/lib/ui/theme";

export const metadata: Metadata = {
  title: { default: "Kal", template: "%s · Kal" },
  description: "A photo-first food log.",
  applicationName: "Kal",
  manifest: "/manifest.webmanifest",
  icons: {
    icon: [
      { url: "/icons/favicon-32.png", sizes: "32x32", type: "image/png" },
      { url: "/icons/icon.svg", type: "image/svg+xml" },
    ],
    apple: [{ url: "/icons/apple-touch-icon.png", sizes: "180x180" }],
  },
  appleWebApp: { capable: true, title: "Kal", statusBarStyle: "default" },
  formatDetection: { telephone: false, email: false, address: false },
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f6f6f3" },
    { media: "(prefers-color-scheme: dark)", color: "#0e100f" },
  ],
};

// Every page reads the session, so rendering is per request (also needed for the CSP nonce).
export default async function RootLayout({ children }: { children: ReactNode }) {
  const theme = parseTheme((await cookies()).get(THEME_COOKIE)?.value);
  return (
    <html lang="en" data-theme={theme === "system" ? undefined : theme} suppressHydrationWarning>
      <body>
        <a
          href="#main"
          className="focus:bg-surface sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-[70] focus:rounded-lg focus:px-4 focus:py-3"
        >
          Skip to content
        </a>
        <ToastProvider>{children}</ToastProvider>
        <PwaRegister />
      </body>
    </html>
  );
}
