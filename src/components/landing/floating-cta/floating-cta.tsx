"use client";

import { useEffect, useState } from "react";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export function FloatingCta({
  onDeploy,
  startingPrice,
}: {
  onDeploy: () => void;
  startingPrice: number;
}) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const handleScroll = () => setVisible(window.scrollY > 400);
    window.addEventListener("scroll", handleScroll, { passive: true });
    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

  return (
    <div
      className={cn(
        "fixed bottom-6 left-1/2 -translate-x-1/2 z-50 flex items-center gap-3 px-2 pl-5 py-2 rounded-full border border-white/[0.08] bg-background/90 backdrop-blur-xl shadow-2xl shadow-black/20 transition-all duration-500",
        visible ? "translate-y-0 opacity-100" : "translate-y-20 opacity-0 pointer-events-none",
      )}
    >
      <span className="text-xs text-muted-foreground/60 hidden sm:inline">
        From <strong className="text-foreground">${startingPrice}/mo</strong>
      </span>
      <button
        onClick={onDeploy}
        className={cn(buttonVariants({ size: "sm" }), "rounded-full h-8 px-5 text-xs font-medium")}
      >
        DEPLOY
      </button>
    </div>
  );
}
