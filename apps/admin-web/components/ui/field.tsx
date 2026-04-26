import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

export function Field({
  label,
  htmlFor,
  help,
  error,
  className,
  span,
  children,
}: {
  label?: ReactNode;
  htmlFor?: string;
  help?: ReactNode;
  error?: ReactNode;
  className?: string;
  span?: 'full' | 'span-2';
  children: ReactNode;
}) {
  return (
    <div className={cn('grid gap-1.5', span === 'full' && 'col-span-full', span === 'span-2' && 'col-span-2', className)}>
      {label ? (
        <label className="text-[12px] font-medium text-fg-muted tracking-tight" htmlFor={htmlFor}>
          {label}
        </label>
      ) : null}
      {children}
      {error ? <div className="text-[12px] text-bad leading-relaxed">{error}</div> : help ? <div className="text-[12px] text-fg-subtle leading-relaxed">{help}</div> : null}
    </div>
  );
}
