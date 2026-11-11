"use client";

import { BarChart3, CirclePlus, Settings, Sun } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";

import { cn } from "@/components/ui/cn";

const ITEMS = [
  { href: "/today", label: "Today", icon: Sun, also: ["/meals"] },
  { href: "/add", label: "Add", icon: CirclePlus, also: [] },
  { href: "/trends", label: "Trends", icon: BarChart3, also: [] },
  // Favorites and Medicines are opened from Settings for now.
  { href: "/settings", label: "Settings", icon: Settings, also: ["/admin", "/favorites"] },
] as const;

/**
 * The four main places. A bar at the bottom on phones (thumb reach), a rail on the left from
 * tablet width up.
 */
export const BottomNav = () => {
  const pathname = usePathname();
  return (
    <nav
      aria-label="Main"
      className={cn(
        "border-border bg-surface/95 safe-bottom fixed inset-x-0 bottom-0 z-30 border-t backdrop-blur-md",
        "md:inset-y-0 md:right-auto md:w-24 md:border-t-0 md:border-r md:pt-6",
      )}
    >
      <ul className="mx-auto grid h-[var(--spacing-nav)] max-w-md grid-cols-4 md:h-auto md:grid-cols-1 md:gap-2">
        {ITEMS.map(({ href, label, icon: Icon, also }) => {
          const active = [href, ...also].some(
            (base) => pathname === base || pathname.startsWith(`${base}/`),
          );
          return (
            <li key={href} className="contents md:block">
              <Link
                href={href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "text-caption flex min-h-11 flex-col items-center justify-center gap-1 font-medium transition-colors",
                  "md:mx-2 md:rounded-2xl md:py-3",
                  active ? "text-primary" : "text-muted hover:text-text",
                )}
              >
                <span
                  className={cn(
                    "grid h-8 w-14 place-items-center rounded-full transition-colors",
                    active && "bg-primary-soft text-on-primary-soft",
                  )}
                >
                  <Icon aria-hidden className="size-5" strokeWidth={active ? 2.4 : 2} />
                </span>
                {label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
};
