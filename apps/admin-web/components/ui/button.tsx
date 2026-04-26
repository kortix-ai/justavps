'use client';

import { forwardRef } from 'react';
import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { cn } from '@/lib/utils';

type Variant = 'primary' | 'secondary' | 'outline' | 'ghost' | 'danger' | 'danger-ghost' | 'success';
type Size = 'sm' | 'md' | 'lg' | 'icon';

const variants: Record<Variant, string> = {
  primary: 'bg-fg text-accent-fg hover:bg-zinc-200 border-transparent',
  secondary: 'bg-bg-1 text-fg border-border-strong hover:bg-bg-2 hover:border-border-focus',
  outline: 'bg-transparent text-fg border-border-strong hover:bg-bg-2',
  ghost: 'bg-transparent text-fg-muted border-transparent hover:bg-bg-2 hover:text-fg',
  danger: 'bg-bad text-white border-transparent hover:bg-red-600',
  'danger-ghost': 'bg-transparent text-red-300 border-bad/40 hover:bg-bad-soft',
  success: 'bg-ok text-emerald-950 border-transparent hover:bg-emerald-500',
};

const sizes: Record<Size, string> = {
  sm: 'h-7 px-2.5 text-[12px] gap-1.5',
  md: 'h-8 px-3 text-[13px] gap-1.5',
  lg: 'h-10 px-4 text-[14px] gap-2',
  icon: 'size-8 p-0 justify-center',
};

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: Variant;
  size?: Size;
  leftIcon?: ReactNode;
  rightIcon?: ReactNode;
  loading?: boolean;
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { className, variant = 'primary', size = 'md', leftIcon, rightIcon, loading, disabled, children, type, ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type ?? 'button'}
      className={cn(
        'inline-flex select-none items-center justify-center whitespace-nowrap rounded-[8px] border font-medium tracking-tight transition-colors disabled:cursor-not-allowed disabled:opacity-50 active:translate-y-[0.5px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/30',
        variants[variant],
        sizes[size],
        className,
      )}
      disabled={disabled || loading}
      {...rest}
    >
      {leftIcon ? <span aria-hidden className="inline-flex size-3.5 items-center justify-center">{leftIcon}</span> : null}
      {children}
      {rightIcon ? <span aria-hidden className="inline-flex size-3.5 items-center justify-center">{rightIcon}</span> : null}
    </button>
  );
});
