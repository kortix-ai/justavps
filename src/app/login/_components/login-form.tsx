"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import { signIn } from "next-auth/react";
import { AuthButton } from "@/components/auth/auth-button";
import { AuthError, AuthField } from "@/components/auth/auth-field";

type LoginFormProps = {
  redirectTo: string;
  onUnverified: (email: string) => void;
};

export function LoginForm({ redirectTo, onUnverified }: LoginFormProps) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!email || !password) return;
    setLoading(true);
    setError(null);

    const result = await signIn("credentials", {
      email,
      password,
      redirect: false,
    });

    if (result?.error) {
      setLoading(false);
      if (result.error.includes("EMAIL_NOT_VERIFIED")) {
        onUnverified(email);
        return;
      }
      setError("Invalid email or password.");
      return;
    }

    if (result?.ok) {
      window.location.href = redirectTo;
      return;
    }

    setLoading(false);
    setError("Invalid email or password.");
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
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
      <AuthField
        label="Password"
        name="password"
        type="password"
        placeholder="Your password"
        autoComplete="current-password"
        value={password}
        onChange={(event) => setPassword(event.target.value)}
        required
      />

      <div className="flex justify-end -mt-1">
        <Link
          href="/forgot-password"
          className="text-[11px] text-muted-foreground hover:text-foreground transition-colors"
        >
          Forgot password?
        </Link>
      </div>

      <AuthError message={error} />

      <AuthButton type="submit" disabled={loading}>
        {loading ? "Signing in…" : "Sign in"}
      </AuthButton>
    </form>
  );
}
