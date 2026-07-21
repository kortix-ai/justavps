"use client";

import Link from "next/link";
import { useSession } from "next-auth/react";
import { cn } from "@/shared/lib/utils";
import { buttonVariants } from "@/shared/ui/button";
import { useTheme } from "@/shared/hooks/use-theme";
import { Logo } from "@/shared/components/logo";
import { PLATINUM_URL } from "@/shared/lib/sunset";

function ThemeToggle() {
  const { theme, toggleTheme } = useTheme();
  return (
    <button
      onClick={toggleTheme}
      className="size-8 flex items-center justify-center rounded-lg text-muted-foreground/70 hover:text-foreground hover:bg-muted/50 transition-all duration-150"
      aria-label="Toggle theme"
    >
      {theme === "dark" ? (
        <svg className="size-[15px]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="5" /><path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42" /></svg>
      ) : (
        <svg className="size-[15px]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z" /></svg>
      )}
    </button>
  );
}


export function DocsShell({ children }: { children: React.ReactNode }) {
  const { status } = useSession();
  const isLoggedIn = status === "authenticated";

  return (
    <div className="flex h-screen flex-col bg-background text-foreground">
      {/* ── Navbar ── */}
      <nav className="sticky top-0 shrink-0 z-50 w-full border-b border-border/50 bg-background/80 backdrop-blur-xl">
        <div className="max-w-screen-2xl mx-auto flex items-center justify-between h-12 px-6">
          <Logo />

          {/* Right: utility + auth */}
          <div className="flex items-center gap-1">
            <ThemeToggle />
            <div className="w-px h-4 bg-border/60 mx-1.5 hidden sm:block" />
            {isLoggedIn ? (
              <Link
                href="/machines"
                className={cn(
                  buttonVariants({ variant: "ghost", size: "sm" }),
                  "h-7 text-[12.5px] px-2.5 text-muted-foreground hover:text-foreground"
                )}
              >
                Dashboard
              </Link>
            ) : (
              <>
                <Link
                  href="/login"
                  className={cn(
                    buttonVariants({ variant: "ghost", size: "sm" }),
                    "h-7 text-[12.5px] px-2.5 text-muted-foreground hover:text-foreground hidden sm:inline-flex"
                  )}
                >
                  Log in
                </Link>
                <Link
                  href="/machines"
                  className={cn(
                    buttonVariants({ size: "sm" }),
                    "h-7 text-[12.5px] px-3"
                  )}
                >
                  Get started
                </Link>
              </>
            )}
          </div>
        </div>
      </nav>

      {/* ── Sunset cross-reference (static, crawlable) ── */}
      <div className="shrink-0 w-full border-b border-border/50 bg-muted/30">
        <p className="max-w-screen-2xl mx-auto px-6 py-2 text-xs text-muted-foreground">
          justavps.com is becoming{" "}
          <a
            href={PLATINUM_URL}
            className="text-foreground underline underline-offset-2 hover:opacity-80 transition-opacity"
          >
            platinum.dev
          </a>{" "}
          — the most affordable AI agent sandbox cloud.
        </p>
      </div>

      {/* ── Content ── */}
      <div className="flex-1 min-h-0">
        <div className="max-w-screen-2xl mx-auto h-full px-6">{children}</div>
      </div>
    </div>
  );
}
