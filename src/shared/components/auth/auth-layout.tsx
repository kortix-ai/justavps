import Link from "next/link";
import type { ReactNode } from "react";
import { Logo } from "@/shared/components/logo";

// Note: Logo renders its own <Link href="/">. Don't wrap it in another Link
// or React will hydrate <a> inside <a>.

type AuthLayoutProps = {
  eyebrow?: string;
  title: string;
  description?: ReactNode;
  footer?: ReactNode;
  children: ReactNode;
};

export function AuthLayout({ eyebrow, title, description, footer, children }: AuthLayoutProps) {
  return (
    <div className="relative min-h-screen flex flex-col bg-background text-foreground overflow-hidden">
      <header className="relative z-10 px-6 py-4">
        <div className="max-w-5xl mx-auto">
          <Logo />
        </div>
      </header>

      <main className="relative z-10 flex-1 flex items-center justify-center px-6 py-4">
        <div className="w-full max-w-[380px]">
          <FormCard
            eyebrow={eyebrow}
            title={title}
            description={description}
            footer={footer}
          >
            {children}
          </FormCard>
        </div>
      </main>

      <footer className="relative z-10 px-6 py-4">
        <div className="max-w-5xl mx-auto text-[11px] text-muted-foreground/50 text-center">
          By continuing you agree to our{" "}
          <Link
            href="/terms"
            className="text-muted-foreground hover:text-foreground underline underline-offset-4 decoration-muted-foreground/40 hover:decoration-foreground transition-colors"
          >
            terms of service
          </Link>{" "}
          and{" "}
          <Link
            href="/privacy"
            className="text-muted-foreground hover:text-foreground underline underline-offset-4 decoration-muted-foreground/40 hover:decoration-foreground transition-colors"
          >
            privacy policy
          </Link>
          .
        </div>
      </footer>
    </div>
  );
}

type FormCardProps = {
  eyebrow?: string;
  title: string;
  description?: ReactNode;
  footer?: ReactNode;
  children: ReactNode;
};

function FormCard({ eyebrow, title, description, footer, children }: FormCardProps) {
  return (
    <div className="relative rounded-2xl bg-background/70">
      <div className="px-7 py-6">
        {eyebrow ? (
          <p className="text-[10px] text-brand uppercase tracking-[0.22em] mb-2.5 font-medium">
            {eyebrow}
          </p>
        ) : null}
        <h1 className="text-[22px] font-medium tracking-[-0.025em] leading-[1.15] text-foreground">
          {title}
        </h1>
        {description ? (
          <p className="mt-2 text-[13px] text-muted-foreground leading-snug">
            {description}
          </p>
        ) : null}

        <div className="mt-5">{children}</div>

        {footer ? (
          <div className="mt-5 pt-4 border-t border-border/40 text-[13px] text-muted-foreground">
            {footer}
          </div>
        ) : null}
      </div>
    </div>
  );
}

function CornerMarks() {
  return (
    <>
      <CornerMark className="-top-[5px] -left-[5px]" />
      <CornerMark className="-top-[5px] -right-[5px]" />
      <CornerMark className="-bottom-[5px] -left-[5px]" />
      <CornerMark className="-bottom-[5px] -right-[5px]" />
    </>
  );
}

function CornerMark({ className }: { className: string }) {
  return (
    <svg
      aria-hidden
      viewBox="0 0 10 10"
      className={`absolute size-[10px] text-foreground/35 pointer-events-none ${className}`}
      fill="none"
      stroke="currentColor"
      strokeWidth="1"
    >
      <line x1="5" y1="0" x2="5" y2="10" />
      <line x1="0" y1="5" x2="10" y2="5" />
    </svg>
  );
}
