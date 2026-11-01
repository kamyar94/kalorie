"use client";

import { Field } from "@/components/ui/field";

import { acceptInviteAction } from "../actions";
import { AuthForm } from "../auth-form";

export const InviteForm = ({ code }: { code: string }) => (
  <AuthForm action={acceptInviteAction} submit="Create my account">
    {(values) => (
      <>
        <Field
          label="Invite code"
          name="code"
          autoComplete="off"
          autoCapitalize="characters"
          spellCheck={false}
          required
          defaultValue={values.code ?? code}
          placeholder="XXXX-XXXX-XXXX-XXXX"
        />
        <Field
          label="Your name"
          name="displayName"
          autoComplete="name"
          required
          maxLength={40}
          defaultValue={values.displayName}
        />
        <Field
          label="Username"
          name="username"
          autoComplete="username"
          autoCapitalize="none"
          spellCheck={false}
          required
          hint="3 to 32 characters: lowercase letters, numbers, dot, dash or underscore."
          defaultValue={values.username}
        />
        <Field
          label="Password"
          name="password"
          type="password"
          autoComplete="new-password"
          required
          minLength={10}
          hint="At least 10 characters."
        />
        <Field
          label="Password again"
          name="confirm"
          type="password"
          autoComplete="new-password"
          required
        />
      </>
    )}
  </AuthForm>
);
