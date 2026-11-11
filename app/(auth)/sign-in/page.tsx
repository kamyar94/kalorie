import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { getCurrentUser } from "@/lib/auth/session";

import { SignInForm } from "./sign-in-form";

export const metadata: Metadata = { title: "Sign in" };

export default async function SignInPage() {
  if (await getCurrentUser()) redirect("/today");
  return (
    <>
      <h1 className="text-title">Sign in</h1>
      <p className="text-muted mt-1 mb-6">Welcome back. Your meals are waiting.</p>
      <SignInForm />
      <p className="text-caption text-muted mt-6">
        New here? Ask the person who runs this Kal server for an invite code. Forgot your password?
        They can make you a reset code.
      </p>
    </>
  );
}
