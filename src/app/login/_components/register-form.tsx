"use client";

import { useState, type FormEvent } from "react";
import { AuthButton } from "@/components/auth/auth-button";
import { AuthError, AuthField } from "@/components/auth/auth-field";

type RegisterFormProps = {
  onRegistered: (email: string) => void;
};

export function RegisterForm({ onRegistered }: RegisterFormProps) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!email || !password) return;
    setLoading(true);
    setError(null);

    try {
      const response = await fetch("/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password, name: name || undefined }),
      });
      const data = await response.json();

      if (!response.ok) {
        setLoading(false);
        setError(data.message || "Registration failed.");
        return;
      }

      onRegistered(email);
    } catch {
      setLoading(false);
      setError("Something went wrong. Please try again.");
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      <AuthField
        label="Name"
        name="name"
        type="text"
        placeholder="Your name"
        autoComplete="name"
        value={name}
        onChange={(event) => setName(event.target.value)}
      />
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
        placeholder="Min. 8 characters"
        autoComplete="new-password"
        value={password}
        onChange={(event) => setPassword(event.target.value)}
        required
      />

      <AuthError message={error} />

      <AuthButton type="submit" disabled={loading}>
        {loading ? "Creating account…" : "Create account"}
      </AuthButton>
    </form>
  );
}
