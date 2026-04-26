import { useEffect } from 'react';
import type { ReactNode } from 'react';

export type SheetProps = {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  description?: ReactNode;
  footer?: ReactNode;
  children: ReactNode;
  testId?: string;
};

export function Sheet({ open, onClose, title, description, footer, children, testId }: SheetProps) {
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
      <aside className="sheet" role="dialog" aria-modal="true" data-testid={testId}>
        <header className="sheet-head">
          <div>
            <h3 className="sheet-title">{title}</h3>
            {description ? <div className="text-muted text-sm" style={{ marginTop: 2 }}>{description}</div> : null}
          </div>
          <button type="button" className="btn btn--ghost btn--sm btn--icon" aria-label="Close" onClick={onClose}>
            ×
          </button>
        </header>
        <div className="sheet-body">{children}</div>
        {footer ? <footer className="sheet-foot">{footer}</footer> : null}
      </aside>
    </>
  );
}
