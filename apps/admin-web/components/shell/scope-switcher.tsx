'use client';

import Link from 'next/link';
import type { Scope } from './scope';
import { scopeHome } from './scope';
import { cn } from '@/lib/utils';

export function ScopeSwitcher({ scope }: { scope: Scope }) {
  const options: Array<{ id: Scope; label: string; sub: string }> = [
    { id: 'workspace', label: 'Workspace', sub: 'Build & manage machines' },
    { id: 'admin', label: 'Admin', sub: 'Cluster, vendor, capacity' },
  ];
  return (
    <div className="grid grid-cols-2 gap-1 rounded-[10px] border border-border bg-bg p-1">
      {options.map((opt) => {
        const active = scope === opt.id;
        return (
          <Link
            key={opt.id}
            href={scopeHome(opt.id)}
            className={cn(
              'flex flex-col items-start gap-0.5 rounded-[7px] px-2.5 py-1.5 text-[12px] transition-colors',
              active ? 'bg-fg text-bg' : 'text-fg-muted hover:bg-bg-2 hover:text-fg',
            )}
            data-scope={opt.id}
            data-active={active ? 'true' : 'false'}
          >
            <span className="font-semibold tracking-tight">{opt.label}</span>
          </Link>
        );
      })}
    </div>
  );
}
