"use client";

import { Field } from "@/components/ui/field";

import { resetPasswordAction } from "../actions";
import { AuthForm } from "../auth-form";

export const ResetForm = ({ code }: { code: string }) => (
  <AuthForm action={resetPasswordAction} submit="Set new password">
    {(values) => (
      <>
        <Field
          label="Reset code"
          name="code"
          autoComplete="off"
          autoCapitalize="characters"
          spellCheck={false}
          required
          defaultValue={values.code ?? code}
          placeholder="XXXX-XXXX-XXXX-XXXX"
        />
        <Field
          label="New password"
          name="password"
          type="password"
          autoComplete="new-password"
          required
          minLength={10}
          hint="At least 10 characters. Every other sign-in of your account ends."
        />
        <Field
          label="New password again"
          name="confirm"
          type="password"
          autoComplete="new-password"
          required
        />
      </>
    )}
  </AuthForm>
);
