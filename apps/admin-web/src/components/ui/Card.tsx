import type { HTMLAttributes, ReactNode } from 'react';
import { cx } from '../../lib/utils';

export type CardProps = HTMLAttributes<HTMLDivElement> & {
  compact?: boolean;
};

export function Card({ className, compact, children, ...rest }: CardProps) {
  return (
    <div className={cx('card', compact && 'card--compact', className)} {...rest}>
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
    <div className="card-header">
      <div>
        <h2 className="card-title">{title}</h2>
        {desc ? <div className="card-desc">{desc}</div> : null}
      </div>
      {actions ? <div className="toolbar">{actions}</div> : null}
    </div>
  );
}
