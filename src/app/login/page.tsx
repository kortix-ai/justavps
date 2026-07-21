"use client";

import { ArrowUpRight } from "lucide-react";
import { AuthLayout } from "@/shared/components/auth/auth-layout";
import { PLATINUM_URL } from "@/shared/lib/sunset";

export default function LoginPage() {
  return (
    <AuthLayout
      eyebrow="We're moving"
      title="justavps.com is becoming platinum.dev"
      description={
        <>
          Sign-ins and sign-ups on justavps are disabled. Platinum is the most
          affordable AI agent sandbox cloud — it isn&apos;t generally available
          yet, but you can follow along at platinum.dev.
        </>
      }
      footer={
        <p className="text-muted-foreground">
          Existing customer with a question? Reach us at{" "}
          <a
            href="mailto:support@justavps.com"
            className="text-foreground underline underline-offset-4 decoration-foreground/30 hover:decoration-foreground transition-colors"
          >
            support@justavps.com
          </a>
        </p>
      }
    >
      <a
        href={PLATINUM_URL}
        className="inline-flex w-full items-center justify-center gap-1.5 rounded-md bg-foreground px-4 py-2.5 text-sm font-medium text-background hover:opacity-90 transition-opacity"
      >
        Visit platinum.dev
        <ArrowUpRight className="h-4 w-4" />
      </a>
    </AuthLayout>
  );
}
