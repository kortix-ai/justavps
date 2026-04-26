'use client';

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
      <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-[2px] [animation:fade-in_120ms_ease]" onClick={onClose} aria-hidden />
      <div className="pointer-events-none fixed inset-0 z-[51] grid place-items-center p-8" role="dialog" aria-modal="true">
        <div
          data-testid={testId}
          className="pointer-events-auto flex max-h-[86vh] w-full max-w-[640px] flex-col overflow-auto rounded-[16px] border border-border-strong bg-bg-1 shadow-[0_16px_64px_rgba(0,0,0,0.6)] [animation:pop-in_160ms_cubic-bezier(0.2,0.8,0.2,1)]"
          onClick={(event) => event.stopPropagation()}
        >
          <header className="flex flex-col gap-0.5 px-5 pt-4 pb-2">
            <h3 className="m-0 text-[17px] font-semibold tracking-tight">{title}</h3>
            {description ? <div className="text-[13px] text-fg-muted">{description}</div> : null}
          </header>
          <div className="flex flex-col gap-3.5 px-5 pb-4">{children}</div>
          {footer ? <footer className="sticky bottom-0 mt-auto flex items-center justify-end gap-2 border-t border-border bg-bg-1 px-5 py-3.5">{footer}</footer> : null}
        </div>
      </div>
    </>
  );
}
