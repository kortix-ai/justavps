"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { Logo } from "@/components/logo";
import { ThemeToggle } from "@/components/landing/nav/theme-toggle";

const NAV_ITEMS = [
  { href: "#infrastructure", id: "infrastructure", label: "Infrastructure" },
  { href: "#api", id: "api", label: "API" },
  { href: "#pricing", id: "pricing", label: "Pricing" },
  { href: "#about", id: "about", label: "About" },
];

export function LandingNav({ onDeploy }: { onDeploy: () => void }) {
  const [activeSection, setActiveSection] = useState("");
  const [scrolled, setScrolled] = useState(false);
  const { data: session } = useSession();
  const isLoggedIn = !!session?.user;

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 12);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  useEffect(() => {
    const ids = NAV_ITEMS.map((item) => item.id);
    const obs = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) setActiveSection(entry.target.id);
        }
      },
      { rootMargin: "-40% 0px -55% 0px" },
    );
    for (const id of ids) {
      const el = document.getElementById(id);
      if (el) obs.observe(el);
    }
    return () => obs.disconnect();
  }, []);

  return (
    <div className="fixed top-4 inset-x-0 z-50 px-4 pointer-events-none">
      <nav
        className={cn(
          "pointer-events-auto relative mx-auto max-w-6xl h-12 flex items-center justify-between rounded-full pl-5 pr-2 transition-all duration-300",
          scrolled
            ? "border border-border/60 bg-background/70 backdrop-blur-xl"
            : "border border-transparent",
        )}
      >
        <Logo />
        <div className="hidden md:flex items-center gap-0.5 absolute left-1/2 -translate-x-1/2">
          {NAV_ITEMS.map((item) => (
            <a
              key={item.id}
              href={item.href}
              className={cn(
                "px-3.5 py-1.5 text-[13px] rounded-full transition-all duration-200",
                activeSection === item.id
                  ? "text-foreground bg-foreground/[0.06]"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {item.label}
            </a>
          ))}
          <Link
            href="/docs"
            className="px-3.5 py-1.5 text-[13px] text-muted-foreground hover:text-foreground rounded-full transition-colors"
          >
            Docs
          </Link>
        </div>
        <div className="flex items-center gap-1.5">
          <ThemeToggle />
          {isLoggedIn ? (
            <Link
              href="/machines"
              className={cn(buttonVariants({ size: "sm" }), "h-8 text-[13px] px-4 rounded-full")}
            >
              Dashboard
            </Link>
          ) : (
            <>
              <Link
                href="/login"
                className="text-[13px] text-muted-foreground hover:text-foreground px-3 py-1.5 hidden sm:inline-flex transition-colors"
              >
                Log in
              </Link>
              <button
                onClick={onDeploy}
                className={cn(
                  buttonVariants({ size: "sm" }),
                  "h-8 text-[13px] px-4 rounded-full hidden sm:inline-flex",
                )}
              >
                Deploy
              </button>
            </>
          )}
        </div>
      </nav>
    </div>
  );
}
