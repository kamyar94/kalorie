"use client";

import { Activity, Camera, CircleDot, Ellipsis, PersonStanding } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";

import { useCapture } from "@/components/capture/capture-provider";
import { cn } from "@/components/ui/cn";

type NavLink = {
  href: string;
  label: string;
  icon: typeof Activity;
  /** Other pages that belong to this place (its link shows as current there). */
  also: string[];
};

const LEFT: NavLink[] = [
  { href: "/today", label: "Today", icon: CircleDot, also: ["/meals"] },
  { href: "/move", label: "Move", icon: Activity, also: [] },
];

const RIGHT: NavLink[] = [
  { href: "/body", label: "Body", icon: PersonStanding, also: [] },
  {
    href: "/more",
    label: "More",
    icon: Ellipsis,
    also: ["/trends", "/add", "/favorites", "/medicines", "/plan", "/settings", "/admin"],
  },
];

const NavItem = ({ item, pathname }: { item: NavLink; pathname: string }) => {
  const active = [item.href, ...item.also].some(
    (base) => pathname === base || pathname.startsWith(`${base}/`),
  );
  const Icon = item.icon;
  return (
    <li className="contents md:block">
      <Link
        href={item.href}
        aria-current={active ? "page" : undefined}
        className={cn(
          "flex min-h-11 flex-col items-center justify-center gap-1 text-[0.6875rem] font-semibold transition-colors",
          "md:text-caption md:mx-2 md:rounded-2xl md:py-3",
          active ? "text-primary" : "text-muted hover:text-text",
        )}
      >
        <span
          className={cn(
            "grid h-8 w-14 place-items-center rounded-full transition-colors",
            active && "bg-primary-soft text-on-primary-soft",
          )}
        >
          <Icon aria-hidden className="size-5.5" strokeWidth={active ? 2.4 : 2} />
        </span>
        {item.label}
      </Link>
    </li>
  );
};

/**
 * The main places (board 9): Today, Move, the camera, Body and More. A bar at the bottom on phones
 * with the camera in the middle, within thumb reach; a rail on the left from tablet width up, in
 * the same order. More holds Trends, Add food, Favorites, Medicines, Plan, Settings and Admin.
 */
export const BottomNav = () => {
  const pathname = usePathname();
  const { openCamera } = useCapture();
  return (
    <nav
      aria-label="Main"
      className={cn(
        "border-border bg-surface/95 safe-bottom fixed inset-x-0 bottom-0 z-30 border-t backdrop-blur-md",
        "md:inset-y-0 md:right-auto md:w-24 md:border-t-0 md:border-r md:pt-6",
      )}
    >
      <ul className="mx-auto grid h-[var(--spacing-nav)] max-w-md grid-cols-5 items-center md:h-auto md:grid-cols-1 md:gap-2">
        {LEFT.map((item) => (
          <NavItem key={item.href} item={item} pathname={pathname} />
        ))}
        <li className="flex justify-center md:my-1">
          <button
            type="button"
            aria-label="Open the camera"
            onClick={() => openCamera("meal")}
            className="bg-primary text-on-primary hover:bg-primary-hover shadow-raised grid size-15 place-items-center rounded-full transition-transform duration-150 active:scale-95"
          >
            <Camera aria-hidden className="size-6.5" strokeWidth={2.2} />
          </button>
        </li>
        {RIGHT.map((item) => (
          <NavItem key={item.href} item={item} pathname={pathname} />
        ))}
      </ul>
    </nav>
  );
};
