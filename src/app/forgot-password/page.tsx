"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import { AuthLayout } from "@/shared/components/auth/auth-layout";
import { AuthButton } from "@/shared/components/auth/auth-button";
import { AuthError, AuthField } from "@/shared/components/auth/auth-field";

type Status = "idle" | "submitting" | "sent";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!email) return;
    setStatus("submitting");
    setError(null);

    try {
      const response = await fetch("/api/auth/forgot-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });

      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        setError(data.message || "Something went wrong. Try again.");
        setStatus("idle");
        return;
      }

      setStatus("sent");
    } catch {
      setError("Something went wrong. Try again.");
      setStatus("idle");
    }
  }

  if (status === "sent") {
    return (
      <AuthLayout
        eyebrow="Email sent"
        title="Check your inbox"
        description={
          <>
            If an account exists for{" "}
            <span className="text-foreground font-medium">{email}</span>, we sent a password reset
            link. The link expires in 1 hour.
          </>
        }
        footer={
          <Link
            href="/login"
            className="text-foreground underline underline-offset-4 decoration-foreground/30 hover:decoration-foreground transition-colors"
          >
            Back to sign in
          </Link>
        }
      >
        <p className="text-sm text-muted-foreground">
          Didn&apos;t receive it? Check your spam folder, or{" "}
          <button
            type="button"
            onClick={() => setStatus("idle")}
            className="text-foreground underline underline-offset-4 decoration-foreground/30 hover:decoration-foreground"
          >
            try a different email
          </button>
          .
        </p>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout
      eyebrow="Forgot password"
      title="Reset your password"
      description="Enter the email on your account and we'll send you a reset link."
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
          label="Email"
          name="email"
          type="email"
          placeholder="you@example.com"
          autoComplete="email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          required
        />
        <AuthError message={error} />
        <AuthButton type="submit" disabled={status === "submitting"}>
          {status === "submitting" ? "Sending…" : "Send reset link"}
        </AuthButton>
      </form>
    </AuthLayout>
  );
}
