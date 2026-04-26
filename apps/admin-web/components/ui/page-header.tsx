'use client';

import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

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
    <header className="flex flex-col gap-1 pb-1">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="min-w-0">
          <h1 className="m-0 text-[28px] font-semibold leading-[1.05] tracking-[-0.04em]">{title}</h1>
          {description ? <div className="mt-0.5 text-[14px] text-fg-muted">{description}</div> : null}
        </div>
        {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
      </div>
      {tabs ? <div className="mt-2 flex gap-0.5 overflow-x-auto border-b border-border">{tabs}</div> : null}
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
    <button
      type="button"
      className={cn(
        'relative whitespace-nowrap border-0 bg-transparent px-3 py-2.5 text-[13px] font-medium transition-colors',
        active ? 'text-fg' : 'text-fg-muted hover:text-fg',
      )}
      onClick={onClick}
    >
      {children}
      {active ? <span aria-hidden className="absolute inset-x-0 -bottom-px h-[2px] rounded-t-[2px] bg-fg" /> : null}
    </button>
  );
}
