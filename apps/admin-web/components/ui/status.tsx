import { cn } from '@/lib/utils';

type Tone = 'neutral' | 'ok' | 'warn' | 'bad' | 'info';

const dotMap: Record<Tone, string> = {
  neutral: 'bg-fg-disabled',
  ok: 'bg-emerald-400 shadow-[0_0_0_3px_rgba(34,197,94,0.18)]',
  warn: 'bg-amber-400 shadow-[0_0_0_3px_rgba(245,158,11,0.18)]',
  bad: 'bg-red-400 shadow-[0_0_0_3px_rgba(239,68,68,0.18)]',
  info: 'bg-blue-400 shadow-[0_0_0_3px_rgba(59,130,246,0.18)]',
};

export function StatusDot({ tone = 'neutral', className }: { tone?: Tone; className?: string }) {
  return <span aria-hidden className={cn('inline-block size-2 flex-shrink-0 rounded-full', dotMap[tone], className)} />;
}

export function Status({
  tone = 'neutral',
  label,
  className,
}: {
  tone?: Tone;
  label: string | null | undefined;
  className?: string;
}) {
  return (
    <span className={cn('inline-flex items-center gap-1.5 whitespace-nowrap text-[12px]', className)}>
      <StatusDot tone={tone} />
      <span className="text-fg capitalize">{label ?? '—'}</span>
    </span>
  );
}
