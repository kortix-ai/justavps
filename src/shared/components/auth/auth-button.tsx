import { forwardRef, type ButtonHTMLAttributes } from "react";
import { cn } from "@/shared/lib/utils";

type AuthButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary";
  fullWidth?: boolean;
};

export const AuthButton = forwardRef<HTMLButtonElement, AuthButtonProps>(
  ({ variant = "primary", fullWidth = true, className, children, ...rest }, ref) => {
    const base = "group relative inline-flex items-center justify-center h-10 px-5 rounded-full text-[13px] font-medium transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/30 focus-visible:ring-offset-2 focus-visible:ring-offset-background active:scale-[0.98] disabled:opacity-50 disabled:pointer-events-none disabled:active:scale-100";
    const styles =
      variant === "primary"
        ? "bg-foreground text-background border border-foreground hover:bg-foreground/85"
        : "border border-border/60 bg-muted/30 text-foreground hover:bg-muted/50 hover:border-border";

    return (
      <button
        ref={ref}
        className={cn(base, styles, fullWidth && "w-full", className)}
        {...rest}
      >
        {children}
      </button>
    );
  },
);
AuthButton.displayName = "AuthButton";
