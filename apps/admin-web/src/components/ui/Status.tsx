import { cx } from '../../lib/utils';

type Tone = 'neutral' | 'ok' | 'warn' | 'bad' | 'info';

const dotClass: Record<Tone, string> = {
  neutral: '',
  ok: 'dot--ok',
  warn: 'dot--warn',
  bad: 'dot--bad',
  info: 'dot--info',
};

export function StatusDot({ tone = 'neutral' }: { tone?: Tone }) {
  return <span className={cx('dot', dotClass[tone])} aria-hidden />;
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
    <span className={cx('status', className)}>
      <StatusDot tone={tone} />
      <span className="label">{label ?? '—'}</span>
    </span>
  );
}
