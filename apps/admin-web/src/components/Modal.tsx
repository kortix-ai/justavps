import { useEffect } from 'react';
import type { ReactNode } from 'react';

export type ModalProps = {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  footer?: ReactNode;
  children: ReactNode;
  testId?: string;
};

export function Modal({ open, onClose, title, description, footer, children, testId }: ModalProps) {
  useEffect(() => {
    if (!open) return;
    const handler = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="modal-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="modal" role="dialog" aria-modal="true" data-testid={testId}>
        <h3>{title}</h3>
        {description ? <div className="desc">{description}</div> : null}
        {children}
        {footer ? <div className="modal-foot">{footer}</div> : null}
      </div>
    </div>
  );
}
