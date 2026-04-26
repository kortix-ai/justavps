import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

export function Kbd({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <span
      className={cn(
        'inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-[5px] border border-border-strong bg-bg-2 px-1 font-mono text-[10px] font-medium text-fg-muted',
        className,
      )}
    >
      {children}
    </span>
  );
}

export function KbdRow({ keys }: { keys: ReactNode[] }) {
  return (
    <span className="inline-flex items-center gap-[3px]">
      {keys.map((k, i) => (
        <Kbd key={i}>{k}</Kbd>
      ))}
    </span>
  );
}
