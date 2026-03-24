"use client";

import Link from "next/link";
import { useEffect, useRef } from "react";
import { useParams, useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { Loader2, CheckCircle2, XCircle, Building2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useRedeemInvitation } from "@/hooks/use-account";

export default function InviteRedeemPage() {
  const params = useParams<{ token: string }>();
  const router = useRouter();
  const { status } = useSession();
  const redeemInvitation = useRedeemInvitation();
  const token = typeof params.token === "string" ? params.token : "";
  const attemptedRef = useRef(false);

  useEffect(() => {
    if (!token) return;
    if (status === "unauthenticated") {
      router.replace(`/login?callbackUrl=${encodeURIComponent(`/invite/${token}`)}`);
      return;
    }
    if (status === "authenticated" && !attemptedRef.current) {
      attemptedRef.current = true;
      redeemInvitation.mutate(token, {
        onSuccess: (data) => {
          // Small delay so user sees the success state
          setTimeout(() => {
            window.location.href = data.redirect_to;
          }, 1500);
        },
      });
    }
  }, [token, status, router, redeemInvitation]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-background px-6">
      <div className="w-full max-w-sm">
        <div className="rounded-2xl border bg-card p-8 text-center shadow-sm">
          {/* Loading / Pending */}
          {(status === "loading" || redeemInvitation.isPending) && (
            <>
              <div className="mx-auto flex size-14 items-center justify-center rounded-full bg-primary/10 mb-5">
                <Loader2 className="size-7 animate-spin text-primary" />
              </div>
              <h1 className="text-xl font-semibold tracking-tight">
                Accepting invitation
              </h1>
              <p className="mt-2 text-sm text-muted-foreground">
                Verifying your invite and joining the account...
              </p>
            </>
          )}

          {/* Error */}
          {redeemInvitation.isError && (
            <>
              <div className="mx-auto flex size-14 items-center justify-center rounded-full bg-destructive/10 mb-5">
                <XCircle className="size-7 text-destructive" />
              </div>
              <h1 className="text-xl font-semibold tracking-tight">
                Unable to accept invitation
              </h1>
              <p className="mt-2 text-sm text-muted-foreground">
                {redeemInvitation.error.message}
              </p>
              <div className="mt-6 flex items-center justify-center gap-3">
                <Link href="/settings">
                  <Button variant="outline" size="sm">Settings</Button>
                </Link>
                <Link href="/machines">
                  <Button size="sm">Dashboard</Button>
                </Link>
              </div>
            </>
          )}

          {/* Success */}
          {redeemInvitation.isSuccess && (
            <>
              <div className="mx-auto flex size-14 items-center justify-center rounded-full bg-emerald-500/10 mb-5">
                <CheckCircle2 className="size-7 text-emerald-500" />
              </div>
              <h1 className="text-xl font-semibold tracking-tight">
                You&apos;re in!
              </h1>
              <p className="mt-2 text-sm text-muted-foreground">
                Invitation accepted. Redirecting to your dashboard...
              </p>
              <div className="mt-4 flex items-center justify-center">
                <div className="inline-flex items-center gap-2 rounded-full bg-muted px-3 py-1.5 text-xs font-medium text-muted-foreground">
                  <Building2 className="size-3" />
                  Organization joined
                </div>
              </div>
            </>
          )}

          {/* Idle — shouldn't normally be visible */}
          {status === "authenticated" && !redeemInvitation.isPending && !redeemInvitation.isSuccess && !redeemInvitation.isError && (
            <>
              <div className="mx-auto flex size-14 items-center justify-center rounded-full bg-muted mb-5">
                <Building2 className="size-7 text-muted-foreground" />
              </div>
              <h1 className="text-xl font-semibold tracking-tight">
                Processing invitation
              </h1>
              <p className="mt-2 text-sm text-muted-foreground">
                Please wait...
              </p>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
