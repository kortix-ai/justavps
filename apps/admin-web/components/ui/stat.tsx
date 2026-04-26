import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

export function Stat({
  label,
  value,
  meta,
  className,
}: {
  label: ReactNode;
  value: ReactNode;
  meta?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('flex flex-col gap-1.5 rounded-[12px] border border-border bg-bg-1 p-4', className)}>
      <div className="flex items-center justify-between text-[12px] font-medium text-fg-muted">{label}</div>
      <div className="text-[26px] font-semibold leading-none tracking-[-0.04em]">{value}</div>
      <div className="min-h-[14px] text-[12px] text-fg-subtle">{meta ?? ' '}</div>
    </div>
  );
}
