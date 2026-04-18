"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { Label } from "@/shared/ui/label";
import { useAccount, useSetAccountPassword } from "@/shared/hooks/use-account";

export default function WelcomePage() {
  const router = useRouter();
  const { data: account, isLoading } = useAccount();
  const setAccountPassword = useSetAccountPassword();
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");

  useEffect(() => {
    if (account?.has_password) {
      router.replace("/machines?checkout=success");
    }
  }, [account, router]);

  const handleSubmit = () => {
    if (password.length < 8) {
      toast.error("Password must be at least 8 characters.");
      return;
    }
    if (password !== confirmPassword) {
      toast.error("Passwords do not match.");
      return;
    }

    setAccountPassword.mutate(password, {
      onSuccess: () => {
        toast.success("Password saved.");
        router.replace("/machines?checkout=success");
      },
      onError: (error) => {
        toast.error(error.message);
      },
    });
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-background px-6 py-12">
      <div className="w-full max-w-lg rounded-2xl border bg-card p-8">
        <h1 className="text-3xl font-semibold tracking-tight">Your machine is being prepared</h1>
        <p className="mt-3 text-sm text-muted-foreground">
          Checkout is done and your account is unlocked. Set a password now so you can get back into this account anytime.
        </p>

        {isLoading ? (
          <div className="mt-8 flex items-center gap-3 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" />
            Loading your account...
          </div>
        ) : (
          <div className="mt-8 space-y-4">
            <div className="space-y-2">
              <Label htmlFor="welcome-password">Password</Label>
              <Input
                id="welcome-password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="At least 8 characters"
                autoComplete="new-password"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="welcome-password-confirm">Confirm password</Label>
              <Input
                id="welcome-password-confirm"
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder="Repeat your password"
                autoComplete="new-password"
              />
            </div>

            <Button className="w-full" onClick={handleSubmit} disabled={setAccountPassword.isPending}>
              {setAccountPassword.isPending ? (
                <>
                  <Loader2 className="mr-2 size-4 animate-spin" />
                  Saving...
                </>
              ) : (
                "Save password and open dashboard"
              )}
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
