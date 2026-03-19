"use client";

import Link from "next/link";
import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";

type AccessState =
  | { kind: "loading" }
  | { kind: "error"; message: string };

function CheckoutSuccessContent() {
  const searchParams = useSearchParams();
  const sessionId = searchParams.get("session_id");
  const [state, setState] = useState<AccessState>({ kind: "loading" });

  useEffect(() => {
    if (!sessionId) return;

    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch("/api/checkout/access", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ session_id: sessionId }),
        });
        const data = await res.json().catch(() => ({ message: "Unable to unlock your account." }));

        if (!res.ok) {
          if (!cancelled) {
            setState({ kind: "error", message: data.message || "Unable to unlock your account." });
          }
          return;
        }

        window.location.href = data.redirect_to;
      } catch {
        if (!cancelled) {
          setState({ kind: "error", message: "Unable to unlock your account right now." });
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [sessionId]);

  const effectiveState = sessionId
    ? state
    : { kind: "error", message: "Missing Stripe session id." } as const;

  return (
    <div className="min-h-screen flex items-center justify-center bg-background px-6">
      <div className="w-full max-w-md rounded-2xl border bg-card p-8 text-center">
        {effectiveState.kind === "loading" ? (
          <>
            <Loader2 className="mx-auto size-8 animate-spin text-muted-foreground" />
            <h1 className="mt-5 text-2xl font-semibold tracking-tight">Checkout complete</h1>
            <p className="mt-2 text-sm text-muted-foreground">
              Unlocking your account and machine access now.
            </p>
          </>
        ) : (
          <>
            <h1 className="text-2xl font-semibold tracking-tight">We hit a snag</h1>
            <p className="mt-2 text-sm text-muted-foreground">{effectiveState.message}</p>
            <div className="mt-6 flex items-center justify-center gap-3">
              <Link href="/login">
                <Button variant="outline">Log in</Button>
              </Link>
              <Link href="/">
                <Button>Back home</Button>
              </Link>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

export default function CheckoutSuccessPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen flex items-center justify-center bg-background px-6">
          <div className="w-full max-w-md rounded-2xl border bg-card p-8 text-center">
            <Loader2 className="mx-auto size-8 animate-spin text-muted-foreground" />
            <h1 className="mt-5 text-2xl font-semibold tracking-tight">Checkout complete</h1>
            <p className="mt-2 text-sm text-muted-foreground">
              Unlocking your account and machine access now.
            </p>
          </div>
        </div>
      }
    >
      <CheckoutSuccessContent />
    </Suspense>
  );
}
