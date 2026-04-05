"use client";

import { Suspense, useState, type FormEvent } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { AuthLayout } from "@/components/auth/auth-layout";
import { AuthButton } from "@/components/auth/auth-button";
import { AuthError, AuthField } from "@/components/auth/auth-field";

type Status = "idle" | "submitting" | "success";

export default function ResetPasswordPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen flex items-center justify-center bg-background">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-foreground/20 border-t-foreground" />
        </div>
      }
    >
      <ResetPasswordScreen />
    </Suspense>
  );
}

function ResetPasswordScreen() {
  const searchParams = useSearchParams();
  const token = searchParams.get("token");

  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState<string | null>(null);

  if (!token) {
    return (
      <AuthLayout
        eyebrow="Invalid link"
        title="Missing reset token"
        description="This link is missing the information we need to reset your password. Please request a new reset link."
        footer={
          <Link
            href="/forgot-password"
            className="text-foreground underline underline-offset-4 decoration-foreground/30 hover:decoration-foreground transition-colors"
          >
            Request new link
          </Link>
        }
      >
        <div />
      </AuthLayout>
    );
  }

  if (status === "success") {
    return (
      <AuthLayout
        eyebrow="Password updated"
        title="You're all set"
        description="Your password has been reset. You can now sign in with your new password."
      >
        <Link href="/login">
          <AuthButton type="button">Continue to sign in</AuthButton>
        </Link>
      </AuthLayout>
    );
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!password || !confirm) return;
    if (password !== confirm) {
      setError("Passwords do not match.");
      return;
    }
    if (password.length < 8) {
      setError("Password must be at least 8 characters.");
      return;
    }

    setStatus("submitting");
    setError(null);

    try {
      const response = await fetch("/api/auth/reset-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, password }),
      });
      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        setStatus("idle");
        setError(data.message || "This link is invalid or has expired.");
        return;
      }

      setStatus("success");
    } catch {
      setStatus("idle");
      setError("Something went wrong. Try again.");
    }
  }

  return (
    <AuthLayout
      eyebrow="Reset password"
      title="Choose a new password"
      description="Pick something you'll remember. Minimum 8 characters."
      footer={
        <Link
          href="/login"
          className="text-muted-foreground hover:text-foreground transition-colors"
        >
          Back to sign in
        </Link>
      }
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        <AuthField
          label="New password"
          name="password"
          type="password"
          placeholder="Min. 8 characters"
          autoComplete="new-password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          required
        />
        <AuthField
          label="Confirm password"
          name="confirm-password"
          type="password"
          placeholder="Re-enter password"
          autoComplete="new-password"
          value={confirm}
          onChange={(event) => setConfirm(event.target.value)}
          required
        />
        <AuthError message={error} />
        <AuthButton type="submit" disabled={status === "submitting"}>
          {status === "submitting" ? "Updating…" : "Update password"}
        </AuthButton>
      </form>
    </AuthLayout>
  );
}
