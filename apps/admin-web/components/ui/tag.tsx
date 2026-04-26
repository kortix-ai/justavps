import type { HTMLAttributes, ReactNode } from 'react';
import { cn } from '@/lib/utils';

type Tone = 'neutral' | 'ok' | 'warn' | 'bad' | 'info' | 'violet' | 'ghost';

const tones: Record<Tone, string> = {
  neutral: 'border-border-strong bg-bg-1 text-fg',
  ok: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-400',
  warn: 'border-amber-500/30 bg-amber-500/10 text-amber-400',
  bad: 'border-red-500/30 bg-red-500/10 text-red-400',
  info: 'border-blue-500/30 bg-blue-500/10 text-blue-400',
  violet: 'border-violet-500/30 bg-violet-500/10 text-violet-400',
  ghost: 'border-border bg-transparent text-fg-muted',
};

export type TagProps = HTMLAttributes<HTMLSpanElement> & { tone?: Tone; children?: ReactNode };

export function Tag({ className, tone = 'neutral', children, ...rest }: TagProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full border px-2 py-[1.5px] text-[11px] font-medium',
        tones[tone],
        className,
      )}
      {...rest}
    >
      {children}
    </span>
  );
}
