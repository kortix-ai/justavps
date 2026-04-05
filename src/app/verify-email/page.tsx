"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { signIn } from "next-auth/react";
import { AuthLayout } from "@/components/auth/auth-layout";
import { AuthButton } from "@/components/auth/auth-button";

type VerifyStatus = "verifying" | "error";

const DEFAULT_REDIRECT = "/machines";

export default function VerifyEmailPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen flex items-center justify-center bg-background">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-foreground/20 border-t-foreground" />
        </div>
      }
    >
      <VerifyEmailScreen />
    </Suspense>
  );
}

function VerifyEmailScreen() {
  const searchParams = useSearchParams();
  const token = searchParams.get("token");
  const [status, setStatus] = useState<VerifyStatus>("verifying");
  const [message, setMessage] = useState<string | null>(null);
  const hasRequestedRef = useRef(false);

  useEffect(() => {
    if (hasRequestedRef.current) return;
    hasRequestedRef.current = true;

    if (!token) {
      setStatus("error");
      setMessage("This verification link is missing a token.");
      return;
    }

    (async () => {
      try {
        const result = await signIn("verification-link", {
          token,
          redirect: false,
        });

        if (result?.ok) {
          window.history.replaceState(null, "", "/verify-email");
          window.location.href = DEFAULT_REDIRECT;
          return;
        }

        setStatus("error");
        setMessage("This verification link is invalid or has expired.");
      } catch {
        setStatus("error");
        setMessage("Something went wrong verifying your email.");
      }
    })();
  }, [token]);

  if (status === "verifying") {
    return (
      <AuthLayout eyebrow="Verifying" title="Confirming your email…">
        <div className="flex justify-center">
          <div className="h-6 w-6 animate-spin rounded-full border-2 border-foreground/20 border-t-foreground" />
        </div>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout
      eyebrow="Verification failed"
      title="Link invalid or expired"
      description={message || "This verification link is invalid or has expired."}
      footer={
        <Link
          href="/login"
          className="text-foreground underline underline-offset-4 decoration-foreground/30 hover:decoration-foreground transition-colors"
        >
          Back to sign in
        </Link>
      }
    >
      <Link href="/login">
        <AuthButton type="button" variant="secondary">
          Request new link
        </AuthButton>
      </Link>
    </AuthLayout>
  );
}
