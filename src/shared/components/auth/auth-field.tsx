import { forwardRef, type InputHTMLAttributes } from "react";
import { cn } from "@/shared/lib/utils";

type AuthFieldProps = InputHTMLAttributes<HTMLInputElement> & {
  label: string;
  hint?: string;
};

export const AuthField = forwardRef<HTMLInputElement, AuthFieldProps>(
  ({ label, hint, id, className, ...rest }, ref) => {
    const inputId = id || rest.name || `field-${label.toLowerCase().replace(/\s+/g, "-")}`;
    return (
      <div className="space-y-1">
        <label
          htmlFor={inputId}
          className="block text-[11px] font-medium text-foreground/70 tracking-tight"
        >
          {label}
        </label>
        <input
          ref={ref}
          id={inputId}
          className={cn(
            "w-full h-10 px-3.5 rounded-lg border border-border/60 bg-muted/20 text-[13px] text-foreground placeholder:text-muted-foreground/50 transition-all duration-200",
            "hover:border-border",
            "focus-visible:outline-none focus-visible:border-brand/60 focus-visible:bg-background focus-visible:ring-2 focus-visible:ring-brand/15",
            className,
          )}
          {...rest}
        />
        {hint ? <p className="text-[11px] text-muted-foreground/70">{hint}</p> : null}
      </div>
    );
  },
);
AuthField.displayName = "AuthField";

export function AuthError({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <p className="text-[12px] text-rose-500 bg-rose-500/[0.06] border border-rose-500/20 rounded-lg px-3 py-2">
      {message}
    </p>
  );
}
