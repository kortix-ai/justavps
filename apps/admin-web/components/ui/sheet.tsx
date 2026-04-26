'use client';

import { useEffect } from 'react';
import type { ReactNode } from 'react';
import { Button } from './button';
import { X } from 'lucide-react';

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
      <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-[2px] [animation:fade-in_120ms_ease]" onClick={onClose} aria-hidden />
      <aside
        className="fixed inset-y-0 right-0 z-[51] flex w-full max-w-[560px] flex-col border-l border-border bg-bg-1 shadow-[0_16px_64px_rgba(0,0,0,0.6)] [animation:slide-in-right_180ms_cubic-bezier(0.2,0.8,0.2,1)]"
        role="dialog"
        aria-modal="true"
        data-testid={testId}
      >
        <header className="flex items-center justify-between gap-3 border-b border-border px-5 py-3.5">
          <div className="min-w-0">
            <h3 className="m-0 text-[15px] font-semibold tracking-tight">{title}</h3>
            {description ? <div className="mt-0.5 text-[12.5px] text-fg-muted">{description}</div> : null}
          </div>
          <Button size="icon" variant="ghost" aria-label="Close" onClick={onClose}>
            <X className="size-4" />
          </Button>
        </header>
        <div className="flex flex-1 flex-col gap-4 overflow-auto p-5">{children}</div>
        {footer ? <footer className="flex items-center justify-end gap-2 border-t border-border bg-bg-1 px-5 py-3">{footer}</footer> : null}
      </aside>
    </>
  );
}
