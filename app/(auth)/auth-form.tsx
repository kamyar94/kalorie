"use client";

import { useActionState, type ReactNode } from "react";

import { Button } from "@/components/ui/button";

import type { AuthState } from "./actions";

/**
 * A form wired to an auth server action: shows the action's error above the button and keeps
 * the typed values (passwords excepted) after a failed try.
 */
export const AuthForm = ({
  action,
  submit,
  children,
}: {
  action: (state: AuthState, form: FormData) => Promise<AuthState>;
  submit: string;
  children: (values: Record<string, string>) => ReactNode;
}) => {
  const [state, formAction, pending] = useActionState(action, {});
  return (
    <form action={formAction} className="flex flex-col gap-4" noValidate>
      {children(state.values ?? {})}
      {state.error && (
        <p
          role="alert"
          className="bg-danger-soft text-label text-on-danger-soft rounded-xl px-3.5 py-3"
        >
          {state.error}
        </p>
      )}
      <Button type="submit" size="lg" fullWidth loading={pending} className="mt-2">
        {submit}
      </Button>
    </form>
  );
};
