'use client';

import { useEffect } from 'react';
import { usePathname } from 'next/navigation';
import Link from 'next/link';
import { useStore } from '@/lib/store';
import { Button } from '@/components/ui/button';
import { KbdRow } from '@/components/ui/kbd';
import { Tag } from '@/components/ui/tag';
import { useFullWorkflow } from '@/lib/use-full-workflow';
import { useCommandPalette } from './command-palette';
import { ChevronRight, Command, RefreshCw, Zap } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { Scope } from './scope';
import { pageTitle, scopeHome } from './scope';

export function Topbar({ scope }: { scope: Scope }) {
  const { state, refreshAll } = useStore();
  const { run: runWorkflow, running: workflowRunning } = useFullWorkflow();
  const { open: openCmdK } = useCommandPalette();
  const pathname = usePathname() || '/';
  const title = pageTitle(scope, pathname);
  const showRunE2E = scope === 'admin';

  useEffect(() => {
    if (typeof document !== 'undefined') document.title = `${title} · JustAVPS V2`;
  }, [title]);

  const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.userAgent);
  const modKey = isMac ? '⌘' : 'Ctrl';

  return (
    <header
      id="topbar"
      className="sticky top-0 z-10 flex h-14 items-center gap-3 border-b border-border bg-bg-1/80 px-5 backdrop-blur-[12px]"
    >
      <nav className="flex min-w-0 flex-1 items-center gap-2 text-[13px] text-fg-muted" aria-label="Breadcrumb">
        <Link href={scopeHome(scope)} className="whitespace-nowrap font-medium text-fg-muted hover:text-fg">
          {scope === 'admin' ? 'Admin' : 'Workspace'}
        </Link>
        <ChevronRight className="size-3.5 text-fg-disabled" />
        <span className="truncate font-medium text-fg">{title}</span>
        <span className="flex-1" />
        {state.busy ? (
          <Tag tone="info">
            <span className="size-2 rounded-full bg-blue-400 shadow-[0_0_0_3px_rgba(59,130,246,0.18)]" />
            <span>{state.status.label}</span>
          </Tag>
        ) : null}
      </nav>

      <div className="flex items-center gap-2">
        <Button variant="secondary" size="sm" leftIcon={<Command className="size-3.5" />} onClick={openCmdK} aria-label="Command palette" data-testid="v2-cmdk">
          <span className="text-fg-muted">Search</span>
          <KbdRow keys={[modKey, 'K']} />
        </Button>

        <Button variant="secondary" size="sm" leftIcon={<RefreshCw className="size-3.5" />} disabled={state.busy} onClick={() => refreshAll().catch(() => {})} data-testid="v2-refresh-all" id="refresh-all">
          Refresh
        </Button>

        {showRunE2E ? (
          <Button variant="primary" size="sm" leftIcon={<Zap className="size-3.5" />} disabled={state.busy || workflowRunning} onClick={() => runWorkflow().catch(() => {})} data-testid="v2-run-workflow" id="full-workflow">
            {workflowRunning ? 'Running…' : 'Run E2E'}
          </Button>
        ) : null}

        <span
          id="status"
          data-testid="v2-status"
          className={cn(
            'inline-flex items-center gap-1.5 rounded-full border px-2 py-[1.5px] text-[11px] font-medium',
            state.status.tone === 'ok' && 'border-emerald-500/30 bg-emerald-500/10 text-emerald-400',
            state.status.tone === 'warn' && 'border-amber-500/30 bg-amber-500/10 text-amber-400',
            state.status.tone === 'bad' && 'border-red-500/30 bg-red-500/10 text-red-400',
            state.status.tone === 'idle' && 'border-border-strong bg-bg-1 text-fg-muted',
          )}
        >
          {state.status.label}
        </span>
      </div>
    </header>
  );
}
