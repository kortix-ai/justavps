"use client";

import { Suspense, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { AuthLayout } from "@/components/auth/auth-layout";
import { GithubButton } from "./_components/github-button";
import { LoginForm } from "./_components/login-form";
import { RegisterForm } from "./_components/register-form";
import { ResendVerificationPrompt } from "../verify-email/_components/resend-verification-prompt";

type Mode = "login" | "register";

export default function LoginPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen flex items-center justify-center bg-background">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-foreground/20 border-t-foreground" />
        </div>
      }
    >
      <LoginScreen />
    </Suspense>
  );
}

function LoginScreen() {
  const searchParams = useSearchParams();
  const redirectTo =
    searchParams.get("callbackUrl") || searchParams.get("next") || "/machines";

  const [mode, setMode] = useState<Mode>("login");
  const [pendingVerification, setPendingVerification] = useState<string | null>(null);

  if (pendingVerification) {
    return (
      <AuthLayout
        eyebrow="Verify email"
        title="Check your inbox"
        description={
          <>
            We sent a verification link to{" "}
            <span className="text-foreground font-medium">{pendingVerification}</span>. Click it to
            finish signing in.
          </>
        }
        footer={
          <button
            type="button"
            onClick={() => setPendingVerification(null)}
            className="text-muted-foreground hover:text-foreground transition-colors"
          >
            Back to sign in
          </button>
        }
      >
        <ResendVerificationPrompt email={pendingVerification} />
      </AuthLayout>
    );
  }

  const copy = mode === "login"
    ? {
        eyebrow: "Welcome back",
        title: "Sign in",
        description: "Continue to your justavps dashboard.",
      }
    : {
        eyebrow: "Get started",
        title: "Create account",
        description: "Deploy persistent Linux machines for your agents.",
      };

  return (
    <AuthLayout
      eyebrow={copy.eyebrow}
      title={copy.title}
      description={copy.description}
      footer={
        <p>
          {mode === "login" ? "Don't have an account? " : "Already have an account? "}
          <button
            type="button"
            onClick={() => setMode(mode === "login" ? "register" : "login")}
            className="text-foreground underline underline-offset-4 decoration-foreground/30 hover:decoration-foreground transition-colors"
          >
            {mode === "login" ? "Create one" : "Sign in"}
          </button>
        </p>
      }
    >
      <div className="space-y-4">
        <GithubButton redirectTo={redirectTo} />
        {mode === "login" ? (
          <LoginForm
            redirectTo={redirectTo}
            onUnverified={(email) => setPendingVerification(email)}
          />
        ) : (
          <RegisterForm onRegistered={(email) => setPendingVerification(email)} />
        )}
      </div>
    </AuthLayout>
  );
}
