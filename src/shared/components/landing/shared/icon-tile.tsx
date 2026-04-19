import type { ReactNode } from "react";
import { cn } from "@/shared/lib/utils";

const SIZE_MAP = {
  sm: "size-9 rounded-lg [&_svg]:size-4",
  md: "size-11 rounded-xl [&_svg]:size-5",
  lg: "size-14 rounded-[14px] [&_svg]:size-6",
} as const;

export function IconTile({
  children,
  className,
  size = "md",
}: {
  children: ReactNode;
  className?: string;
  size?: keyof typeof SIZE_MAP;
}) {
  return (
    <div
      className={cn(
        "relative flex items-center justify-center shrink-0 overflow-hidden",
        "border bg-muted",
        "text-foreground/75",
        SIZE_MAP[size],
        className,
      )}
    >
      {children}
    </div>
  );
}
