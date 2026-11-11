import {
  BarChart3,
  CalendarDays,
  ChevronRight,
  CirclePlus,
  Pill,
  Settings,
  ShieldCheck,
  Smartphone,
  Star,
} from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import { requireUser } from "@/lib/auth/session";
import { integrationConfig } from "@/lib/integrations/config";

export const metadata: Metadata = { title: "More" };

/** More (board 9's bottom bar): everything that is not Today, Move or Body. */
export default async function MorePage() {
  const user = await requireUser();
  const items = [
    {
      href: "/trends",
      label: "Trends",
      hint: "Calories, nutrients and weight over time",
      icon: BarChart3,
    },
    {
      href: "/add",
      label: "Add food",
      hint: "Search, scan a barcode or photograph a label",
      icon: CirclePlus,
    },
    { href: "/favorites", label: "Favorites", hint: "Meals to log again", icon: Star },
    { href: "/medicines", label: "Medicines", hint: "Your list and what you took", icon: Pill },
    ...(integrationConfig().mealieBaseUrl
      ? [
          {
            href: "/plan",
            label: "Plan meals",
            hint: "Meal plans from your Mealie recipes",
            icon: CalendarDays,
          },
        ]
      : []),
    {
      href: "/more/android",
      label: "Kal for Android",
      hint: "The app, with your watch, phone and scale through Health Connect",
      icon: Smartphone,
    },
    {
      href: "/settings",
      label: "Settings",
      hint: "Profile, AI keys, connected apps, your data",
      icon: Settings,
    },
    ...(user.role === "admin"
      ? [
          {
            href: "/admin",
            label: "Admin",
            hint: "Invites, accounts and usage",
            icon: ShieldCheck,
          },
        ]
      : []),
  ];
  return (
    <>
      <h1 className="text-title">More</h1>
      <ul className="mt-4 flex max-w-xl flex-col gap-2" data-testid="more-list">
        {items.map(({ href, label, hint, icon: Icon }) => (
          <li key={href}>
            <Link
              href={href}
              className="border-border bg-surface shadow-card hover:bg-surface-2/40 flex min-h-16 items-center gap-3 rounded-[var(--radius-card)] border px-4 py-3"
            >
              <span
                aria-hidden
                className="bg-primary-soft text-on-primary-soft grid size-10 shrink-0 place-items-center rounded-xl"
              >
                <Icon className="size-5" />
              </span>
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="text-body font-semibold">{label}</span>
                <span className="text-caption text-muted">{hint}</span>
              </span>
              <ChevronRight aria-hidden className="text-muted size-5 shrink-0" />
            </Link>
          </li>
        ))}
      </ul>
    </>
  );
}
