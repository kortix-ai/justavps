import type { HTMLAttributes, ReactNode } from 'react';
import { cn } from '@/lib/utils';

export type CardProps = HTMLAttributes<HTMLDivElement> & { compact?: boolean };

export function Card({ className, compact, children, ...rest }: CardProps) {
  return (
    <div
      className={cn(
        'flex min-w-0 flex-col gap-4 rounded-[12px] border border-border bg-bg-1',
        compact ? 'p-3.5' : 'p-5',
        className,
      )}
      {...rest}
    >
      {children}
    </div>
  );
}

export function CardHeader({
  title,
  desc,
  actions,
}: {
  title: ReactNode;
  desc?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div className="min-w-0">
        <h2 className="text-[14px] font-semibold tracking-tight">{title}</h2>
        {desc ? <div className="mt-0.5 text-[12.5px] text-fg-muted">{desc}</div> : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  );
}
