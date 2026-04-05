"use client";

import { useState } from "react";
import { AuthButton } from "@/components/auth/auth-button";

const COOLDOWN_SECONDS = 30;

type Status = "idle" | "sending" | "sent" | "error";

export function ResendVerificationPrompt({ email }: { email: string }) {
  const [status, setStatus] = useState<Status>("idle");
  const [cooldown, setCooldown] = useState(0);

  async function handleResend() {
    if (status === "sending" || cooldown > 0) return;
    setStatus("sending");
    try {
      const response = await fetch("/api/auth/resend-verification", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      if (!response.ok) throw new Error("resend failed");
      setStatus("sent");
      startCooldown();
    } catch {
      setStatus("error");
    }
  }

  function startCooldown() {
    setCooldown(COOLDOWN_SECONDS);
    const interval = setInterval(() => {
      setCooldown((current) => {
        if (current <= 1) {
          clearInterval(interval);
          return 0;
        }
        return current - 1;
      });
    }, 1000);
  }

  const label = (() => {
    if (status === "sending") return "Sending…";
    if (cooldown > 0) return `Resend in ${cooldown}s`;
    return "Resend verification email";
  })();

  return (
    <div className="space-y-4">
      <AuthButton
        type="button"
        variant="secondary"
        disabled={status === "sending" || cooldown > 0}
        onClick={handleResend}
      >
        {label}
      </AuthButton>
      {status === "sent" && (
        <p className="text-[12px] text-muted-foreground text-center">
          Sent. Check your inbox (and spam folder).
        </p>
      )}
      {status === "error" && (
        <p className="text-[12px] text-rose-500 text-center">
          We couldn&apos;t resend right now. Try again in a moment.
        </p>
      )}
    </div>
  );
}
