import type { ReactNode } from 'react';
import { cx } from '../../lib/utils';

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
    <div className={cx('field', span === 'full' && 'span-full', span === 'span-2' && 'span-2', className)}>
      {label ? (
        <label className="field-label" htmlFor={htmlFor}>
          {label}
        </label>
      ) : null}
      {children}
      {error ? <div className="field-error">{error}</div> : help ? <div className="field-help">{help}</div> : null}
    </div>
  );
}
