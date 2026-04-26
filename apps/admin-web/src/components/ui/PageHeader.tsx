import type { ReactNode } from 'react';
import { cx } from '../../lib/utils';

export function PageHeader({
  title,
  description,
  actions,
  tabs,
}: {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  tabs?: ReactNode;
}) {
  return (
    <header className="page-header">
      <div className="page-header-row">
        <div>
          <h1>{title}</h1>
          {description ? <div className="desc">{description}</div> : null}
        </div>
        {actions ? <div className="actions">{actions}</div> : null}
      </div>
      {tabs ? <div className="page-tabs">{tabs}</div> : null}
    </header>
  );
}

export function Tab({
  active,
  onClick,
  children,
}: {
  active?: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button type="button" className={cx('tab', active && 'is-active')} onClick={onClick}>
      {children}
    </button>
  );
}
