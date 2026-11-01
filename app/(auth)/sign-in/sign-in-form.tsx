"use client";

import { Field } from "@/components/ui/field";

import { signInAction } from "../actions";
import { AuthForm } from "../auth-form";

export const SignInForm = () => (
  <AuthForm action={signInAction} submit="Sign in">
    {(values) => (
      <>
        <Field
          label="Username"
          name="username"
          autoComplete="username"
          autoCapitalize="none"
          spellCheck={false}
          required
          defaultValue={values.username}
        />
        <Field
          label="Password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
        />
      </>
    )}
  </AuthForm>
);
