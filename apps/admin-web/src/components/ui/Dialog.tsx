import { useEffect } from 'react';
import type { ReactNode } from 'react';

export type DialogProps = {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  description?: ReactNode;
  footer?: ReactNode;
  children: ReactNode;
  testId?: string;
};

export function Dialog({ open, onClose, title, description, footer, children, testId }: DialogProps) {
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <>
      <div className="scrim" onClick={onClose} aria-hidden />
      <div className="dialog" role="dialog" aria-modal="true">
        <div className="dialog-card" data-testid={testId} onClick={(event) => event.stopPropagation()}>
          <header className="dialog-head">
            <h3 className="dialog-title">{title}</h3>
            {description ? <div className="dialog-desc">{description}</div> : null}
          </header>
          <div className="dialog-body">{children}</div>
          {footer ? <footer className="dialog-foot">{footer}</footer> : null}
        </div>
      </div>
    </>
  );
}
