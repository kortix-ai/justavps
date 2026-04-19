import type { ReactNode } from "react";
import { cn } from "@/shared/lib/utils";

export function PageFrame({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "relative mx-auto w-full max-w-6xl border-x border-border",
        className,
      )}
    >
      <PlusMark className="absolute -left-[5px] -top-[5px]" />
      <PlusMark className="absolute -right-[5px] -top-[5px]" />
      <PlusMark className="absolute -left-[5px] -bottom-[5px]" />
      <PlusMark className="absolute -right-[5px] -bottom-[5px]" />
      {children}
    </div>
  );
}

export function PlusMark({ className }: { className?: string }) {
  return (
    <svg
      aria-hidden
      viewBox="0 0 10 10"
      className={cn("size-[10px] text-foreground/40 pointer-events-none", className)}
      fill="none"
      stroke="currentColor"
      strokeWidth="1"
    >
      <line x1="5" y1="0" x2="5" y2="10" />
      <line x1="0" y1="5" x2="10" y2="5" />
    </svg>
  );
}
