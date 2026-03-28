"use client";

import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Logo } from "@/components/logo";

export default function VerifyEmailPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen flex items-center justify-center bg-background">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
        </div>
      }
    >
      <VerifyEmailForm />
    </Suspense>
  );
}

function VerifyEmailForm() {
  const searchParams = useSearchParams();
  const userId = searchParams.get("userId") || "";
  const email = searchParams.get("email") || "";
  const next = searchParams.get("next") || "/machines";

  const [digits, setDigits] = useState<string[]>(["", "", "", "", "", ""]);
  const [loading, setLoading] = useState(false);
  const [resending, setResending] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);
  const [resendCooldown, setResendCooldown] = useState(0);
  const inputRefs = useRef<(HTMLInputElement | null)[]>([]);

  // Resend cooldown timer
  useEffect(() => {
    if (resendCooldown <= 0) return;
    const timer = setTimeout(() => setResendCooldown((c) => c - 1), 1000);
    return () => clearTimeout(timer);
  }, [resendCooldown]);

  // Auto-focus first input
  useEffect(() => {
    inputRefs.current[0]?.focus();
  }, []);

  function handleDigitChange(index: number, value: string) {
    // Only allow single digits
    const digit = value.replace(/\D/g, "").slice(-1);
    const newDigits = [...digits];
    newDigits[index] = digit;
    setDigits(newDigits);
    setError("");

    // Auto-advance to next input
    if (digit && index < 5) {
      inputRefs.current[index + 1]?.focus();
    }

    // Auto-submit when all 6 digits filled
    if (digit && index === 5 && newDigits.every((d) => d)) {
      handleVerify(newDigits.join(""));
    }
  }

  function handleKeyDown(index: number, e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Backspace" && !digits[index] && index > 0) {
      inputRefs.current[index - 1]?.focus();
    }
  }

  function handlePaste(e: React.ClipboardEvent) {
    e.preventDefault();
    const pasted = e.clipboardData.getData("text").replace(/\D/g, "").slice(0, 6);
    if (pasted.length === 6) {
      const newDigits = pasted.split("");
      setDigits(newDigits);
      inputRefs.current[5]?.focus();
      handleVerify(pasted);
    }
  }

  async function handleVerify(code?: string) {
    const verifyCode = code || digits.join("");
    if (verifyCode.length !== 6 || !userId) return;

    setLoading(true);
    setError("");

    try {
      const res = await fetch("/api/auth/verify-email", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId, code: verifyCode }),
      });

      const data = await res.json();

      if (!res.ok) {
        setLoading(false);
        setError(data.message || "Verification failed.");
        setDigits(["", "", "", "", "", ""]);
        inputRefs.current[0]?.focus();
        return;
      }

      setSuccess(true);

      // Auto sign-in — the user just registered, so we stored email in URL params
      // but we need password. Instead, redirect to login with a success message.
      window.location.href = `/login?verified=true&next=${encodeURIComponent(next)}`;
    } catch {
      setLoading(false);
      setError("Something went wrong. Please try again.");
    }
  }

  async function handleResend() {
    if (resendCooldown > 0 || !userId) return;
    setResending(true);
    setError("");

    try {
      const res = await fetch("/api/auth/resend-verification", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId }),
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.message || "Failed to resend code.");
      } else {
        setResendCooldown(60); // 60s cooldown
      }
    } catch {
      setError("Failed to resend code.");
    } finally {
      setResending(false);
    }
  }

  if (!userId) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-background px-4">
        <div className="mb-8">
          <Logo />
        </div>
        <p className="text-sm text-muted-foreground">Invalid verification link.</p>
        <a href="/login" className="text-sm text-primary underline-offset-4 hover:underline mt-4">
          Back to login
        </a>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-background px-4">
      <div className="mb-8">
        <Logo />
      </div>

      <div className="w-full max-w-xs text-center">
        <h1 className="text-lg font-semibold mb-2">Check your email</h1>
        <p className="text-sm text-muted-foreground mb-6">
          We sent a 6-digit code to{" "}
          <span className="font-medium text-foreground">{email || "your email"}</span>
        </p>

        {/* 6-digit OTP input */}
        <div className="flex justify-center gap-2 mb-4" onPaste={handlePaste}>
          {digits.map((digit, i) => (
            <Input
              key={i}
              ref={(el) => { inputRefs.current[i] = el; }}
              type="text"
              inputMode="numeric"
              pattern="[0-9]*"
              maxLength={1}
              value={digit}
              onChange={(e) => handleDigitChange(i, e.target.value)}
              onKeyDown={(e) => handleKeyDown(i, e)}
              disabled={loading || success}
              className="w-11 h-12 text-center text-lg font-mono font-semibold"
              autoComplete="one-time-code"
            />
          ))}
        </div>

        {error && <p className="text-sm text-destructive mb-4">{error}</p>}
        {success && (
          <p className="text-sm text-green-600 mb-4">
            Email verified! Redirecting to login...
          </p>
        )}

        <Button
          onClick={() => handleVerify()}
          className="w-full h-10 mb-3"
          disabled={loading || success || digits.some((d) => !d)}
        >
          {loading ? "Verifying..." : "Verify email"}
        </Button>

        <button
          type="button"
          onClick={handleResend}
          disabled={resending || resendCooldown > 0}
          className="text-sm text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50"
        >
          {resendCooldown > 0
            ? `Resend code in ${resendCooldown}s`
            : resending
              ? "Sending..."
              : "Didn\u2019t get the code? Resend"}
        </button>
      </div>

      <p className="text-xs text-muted-foreground mt-8">
        <a href="/login" className="text-primary underline-offset-4 hover:underline">
          Back to login
        </a>
      </p>
    </div>
  );
}
