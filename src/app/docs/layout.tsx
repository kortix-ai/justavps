"use client";

import Link from "next/link";
import { useSession } from "next-auth/react";
import { cn } from "@/lib/utils";
import { buttonVariants } from "@/components/ui/button";
import { useTheme } from "@/hooks/use-theme";

function ThemeToggle() {
  const { theme, toggleTheme } = useTheme();
  return (
    <button
      onClick={toggleTheme}
      className="size-8 flex items-center justify-center rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-colors"
      aria-label="Toggle theme"
    >
      {theme === "dark" ? (
        <svg className="size-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="5" /><path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42" /></svg>
      ) : (
        <svg className="size-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z" /></svg>
      )}
    </button>
  );
}

export default function DocsLayout({ children }: { children: React.ReactNode }) {
  const { status } = useSession();
  const isLoggedIn = status === "authenticated";

  return (
    <div className="flex h-screen flex-col bg-background text-foreground">
      {/* ── Navbar ── */}
      <nav className="shrink-0 z-50 w-full border-b border-border/40 bg-background/80 backdrop-blur-lg">
        <div className="max-w-screen-2xl mx-auto flex items-center justify-between h-14 px-6">
          <div className="flex items-center gap-6">
            <Link href="/" className="flex items-center gap-2">
              <div className="size-6 rounded-md bg-foreground flex items-center justify-center">
                <svg className="size-3 text-background" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><rect x="2" y="3" width="20" height="14" rx="2" /><path d="M8 21h8M12 17v4" /></svg>
              </div>
              <span className="text-sm font-medium tracking-tight">justavps</span>
            </Link>
            <span className="text-border">|</span>
            <span className="text-sm text-muted-foreground font-medium">Docs</span>
          </div>
          <div className="flex items-center gap-2">
            <ThemeToggle />
            {isLoggedIn ? (
              <Link
                href="/machines"
                className={cn(buttonVariants({ variant: "ghost", size: "sm" }), "text-[13px]")}
              >
                Dashboard
              </Link>
            ) : (
              <>
                <Link
                  href="/login"
                  className={cn(buttonVariants({ variant: "ghost", size: "sm" }), "text-[13px]")}
                >
                  Log in
                </Link>
                <Link
                  href="/machines/new"
                  className={cn(buttonVariants({ size: "sm" }), "text-[13px]")}
                >
                  Get started
                </Link>
              </>
            )}
          </div>
        </div>
      </nav>

      {/* ── Content ── */}
      <div className="flex-1 min-h-0">{children}</div>
    </div>
  );
}
