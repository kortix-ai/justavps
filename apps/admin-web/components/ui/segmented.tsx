'use client';

import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

export type SegmentedItem<T extends string> = {
  id: T;
  label: ReactNode;
  testKey?: string;
  disabled?: boolean;
};

export function Segmented<T extends string>({
  items,
  value,
  onChange,
  ariaLabel,
}: {
  items: SegmentedItem<T>[];
  value: T;
  onChange: (id: T) => void;
  ariaLabel?: string;
}) {
  return (
    <div className="inline-flex gap-0.5 rounded-[8px] border border-border-strong bg-bg-1 p-0.5" role="tablist" aria-label={ariaLabel}>
      {items.map((item) => (
        <button
          key={item.id}
          type="button"
          role="tab"
          aria-selected={value === item.id}
          data-source-tab={item.testKey ?? item.id}
          disabled={item.disabled}
          onClick={() => onChange(item.id)}
          className={cn(
            'inline-flex h-7 items-center gap-1.5 rounded-[6px] border border-transparent px-2.5 text-[12px] font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50',
            value === item.id ? 'bg-surface-active text-fg' : 'text-fg-muted hover:text-fg hover:bg-bg-2',
          )}
        >
          {item.label}
        </button>
      ))}
    </div>
  );
}
