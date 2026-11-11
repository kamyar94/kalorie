import type { ReactNode } from "react";

import { Logo } from "@/components/app/logo";

/** Sign-in, invite and reset pages: one centred column with the logo. */
export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <main
      id="main"
      className="mx-auto flex min-h-dvh w-full max-w-sm flex-col justify-center px-4 pt-[max(env(safe-area-inset-top),2rem)] pb-[max(env(safe-area-inset-bottom),2rem)]"
    >
      <div className="mb-8 flex items-center gap-3">
        <Logo className="size-11" />
        <span className="text-title">Kal</span>
      </div>
      {children}
    </main>
  );
}
