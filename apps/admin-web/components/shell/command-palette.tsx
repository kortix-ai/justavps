'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { useStore } from '@/lib/store';
import { useFullWorkflow } from '@/lib/use-full-workflow';
import { cn, shortId } from '@/lib/utils';
import { ArrowRight, Search } from 'lucide-react';
import { KbdRow } from '@/components/ui/kbd';

type Ctx = { isOpen: boolean; open: () => void; close: () => void; toggle: () => void };
const PaletteContext = createContext<Ctx | null>(null);

export function CommandPaletteProvider({ children }: { children: ReactNode }) {
  const [isOpen, setOpen] = useState(false);
  const open = useCallback(() => setOpen(true), []);
  const close = useCallback(() => setOpen(false), []);
  const toggle = useCallback(() => setOpen((p) => !p), []);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const isMod = event.metaKey || event.ctrlKey;
      if (isMod && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        toggle();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [toggle]);
  const value = useMemo(() => ({ isOpen, open, close, toggle }), [isOpen, open, close, toggle]);
  return (
    <PaletteContext.Provider value={value}>
      {children}
      <CommandPalette />
    </PaletteContext.Provider>
  );
}

export function useCommandPalette() {
  const ctx = useContext(PaletteContext);
  if (!ctx) throw new Error('CommandPaletteProvider missing');
  return ctx;
}

type Item = {
  id: string;
  group: string;
  label: string;
  hint?: string;
  perform: () => void | Promise<void>;
  keywords?: string;
};

function CommandPalette() {
  const ctx = useContext(PaletteContext);
  const router = useRouter();
  const { state, refreshAll, setSelectedMachineId } = useStore();
  const { run: runWorkflow } = useFullWorkflow();
  const [query, setQuery] = useState('');
  const [activeIdx, setActiveIdx] = useState(0);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const isOpen = ctx?.isOpen ?? false;
  const close = ctx?.close ?? (() => {});

  useEffect(() => {
    if (isOpen) {
      setQuery('');
      setActiveIdx(0);
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [isOpen]);

  const items: Item[] = useMemo(() => {
    const base: Item[] = [
      { id: 'go-dashboard', group: 'Navigation', label: 'Go to Dashboard', perform: () => router.push('/'), keywords: 'home overview' },
      { id: 'go-topology', group: 'Navigation', label: 'Go to Topology', perform: () => router.push('/topology'), keywords: 'cluster region host' },
      { id: 'go-machines', group: 'Navigation', label: 'Go to Machines', perform: () => router.push('/machines'), keywords: 'instances vm container' },
      { id: 'go-artifacts', group: 'Navigation', label: 'Go to Artifacts', perform: () => router.push('/artifacts'), keywords: 'images snapshots' },
      { id: 'go-vendor', group: 'Navigation', label: 'Go to Vendor', perform: () => router.push('/vendor'), keywords: 'hetzner robot' },
      { id: 'go-procurement', group: 'Navigation', label: 'Go to Procurement', perform: () => router.push('/procurement'), keywords: 'order bootstrap' },
      { id: 'go-console', group: 'Navigation', label: 'Go to API Console', perform: () => router.push('/console'), keywords: 'request raw http' },
      { id: 'go-settings', group: 'Navigation', label: 'Go to Settings', perform: () => router.push('/settings'), keywords: 'token api url' },
      { id: 'act-refresh', group: 'Actions', label: 'Refresh everything', perform: () => refreshAll(), keywords: 'sync reload' },
      { id: 'act-workflow', group: 'Actions', label: 'Run full E2E workflow', perform: () => runWorkflow(), keywords: 'live test e2e' },
    ];
    for (const machine of state.machines.slice(0, 50)) {
      base.push({
        id: `m-${machine.id}`,
        group: 'Machines',
        label: machine.name || machine.id,
        hint: machine.id,
        perform: () => {
          setSelectedMachineId(machine.id);
          router.push(`/machines?id=${encodeURIComponent(machine.id)}`);
        },
        keywords: `${machine.id} ${machine.region ?? ''} ${machine.cluster?.region ?? ''} ${machine.status ?? ''}`,
      });
    }
    return base;
  }, [router, refreshAll, runWorkflow, setSelectedMachineId, state.machines]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return items;
    return items.filter((item) => `${item.label} ${item.hint ?? ''} ${item.keywords ?? ''}`.toLowerCase().includes(q));
  }, [items, query]);

  const grouped = useMemo(() => {
    const map = new Map<string, Item[]>();
    for (const item of filtered) {
      if (!map.has(item.group)) map.set(item.group, []);
      map.get(item.group)!.push(item);
    }
    return Array.from(map.entries());
  }, [filtered]);

  useEffect(() => {
    if (activeIdx >= filtered.length) setActiveIdx(0);
  }, [activeIdx, filtered.length]);

  if (!isOpen) return null;

  function selectIndex(idx: number) {
    const item = filtered[idx];
    if (!item) return;
    Promise.resolve(item.perform()).catch(() => {});
    close();
  }

  function onKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setActiveIdx((i) => Math.min(filtered.length - 1, i + 1));
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActiveIdx((i) => Math.max(0, i - 1));
    } else if (event.key === 'Enter') {
      event.preventDefault();
      selectIndex(activeIdx);
    } else if (event.key === 'Escape') {
      event.preventDefault();
      close();
    }
  }

  let runningIdx = -1;
  return (
    <>
      <div className="fixed inset-0 z-[60] bg-black/60 backdrop-blur-[2px] [animation:fade-in_120ms_ease]" onClick={close} aria-hidden />
      <div className="fixed inset-0 z-[61] grid place-items-start justify-center pt-[12vh]" role="dialog" aria-modal="true">
        <div className="flex max-h-[70vh] w-[min(640px,92%)] flex-col overflow-hidden rounded-[16px] border border-border-strong bg-bg-1 shadow-[0_16px_64px_rgba(0,0,0,0.6)] [animation:pop-in_160ms_cubic-bezier(0.2,0.8,0.2,1)]">
          <div className="flex items-center gap-2.5 border-b border-border px-3.5 py-3">
            <Search className="size-4 text-fg-disabled" />
            <input
              ref={inputRef}
              className="flex-1 border-0 bg-transparent text-[15px] tracking-tight text-fg outline-none placeholder:text-fg-disabled"
              placeholder="Type a command, machine name, or page…"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={onKeyDown}
              data-testid="v2-cmdk-input"
            />
            <KbdRow keys={['esc']} />
          </div>
          <div className="overflow-auto p-1.5">
            {filtered.length === 0 ? (
              <div className="px-3.5 py-7 text-center text-[13px] text-fg-muted">No results for “{query}”</div>
            ) : (
              grouped.map(([group, groupItems]) => (
                <div key={group}>
                  <div className="px-2.5 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-[0.12em] text-fg-subtle">{group}</div>
                  {groupItems.map((item) => {
                    runningIdx += 1;
                    const idx = runningIdx;
                    return (
                      <div
                        key={item.id}
                        className={cn(
                          'flex cursor-pointer items-center gap-2.5 rounded-[8px] px-2.5 py-2 text-[13.5px] transition-colors',
                          activeIdx === idx ? 'bg-bg-2 text-fg' : 'text-fg-muted hover:bg-bg-2 hover:text-fg',
                        )}
                        onMouseEnter={() => setActiveIdx(idx)}
                        onClick={() => selectIndex(idx)}
                      >
                        <div className="min-w-0 flex flex-col">
                          <span className="truncate">{item.label}</span>
                          {item.hint ? <span className="truncate font-mono text-[12px] text-fg-subtle">{shortId(item.hint, 26)}</span> : null}
                        </div>
                        <span className="ml-auto inline-flex">
                          <ArrowRight className="size-3.5" />
                        </span>
                      </div>
                    );
                  })}
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </>
  );
}
