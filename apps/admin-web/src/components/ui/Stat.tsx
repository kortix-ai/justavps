import type { ReactNode } from 'react';
import { cx } from '../../lib/utils';

export function Stat({
  label,
  value,
  meta,
  testId,
  className,
}: {
  label: ReactNode;
  value: ReactNode;
  meta?: ReactNode;
  testId?: string;
  className?: string;
}) {
  return (
    <div className={cx('stat', className)} data-testid={testId}>
      <div className="stat-label">{label}</div>
      <div className="stat-value">{value}</div>
      <div className="stat-meta">{meta ?? ' '}</div>
    </div>
  );
}
