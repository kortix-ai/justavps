import { useEffect } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useStore } from '../lib/store';
import { cx } from '../lib/utils';
import { Button } from './ui/Button';
import { KbdRow } from './ui/Kbd';
import { Tag } from './ui/Tag';
import { IconCommand, IconRefresh, IconChevronRight, IconBolt } from './ui/icons';
import { useFullWorkflow } from '../features/workflow/useFullWorkflow';
import { useCommandPalette } from './CommandPaletteContext';

const PAGE_TITLES: Record<string, string> = {
  '/': 'Dashboard',
  '/topology': 'Topology',
  '/machines': 'Machines',
  '/artifacts': 'Artifacts',
  '/vendor': 'Vendor',
  '/procurement': 'Procurement',
  '/console': 'API Console',
  '/settings': 'Settings',
};

function pageTitle(pathname: string): string {
  if (PAGE_TITLES[pathname]) return PAGE_TITLES[pathname];
  for (const [prefix, value] of Object.entries(PAGE_TITLES)) {
    if (prefix !== '/' && pathname.startsWith(prefix)) return value;
  }
  return PAGE_TITLES['/'];
}

export function Topbar() {
  const { state, refreshAll } = useStore();
  const { run: runWorkflow, running: workflowRunning } = useFullWorkflow();
  const { open: openCommandPalette } = useCommandPalette();
  const location = useLocation();
  const title = pageTitle(location.pathname);

  useEffect(() => {
    document.title = `${title} · JustAVPS V2 Admin`;
  }, [title]);

  const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.userAgent);
  const modKey = isMac ? '⌘' : 'Ctrl';

  return (
    <header className="topbar" id="topbar">
      <div className="topbar-left">
        <nav className="breadcrumbs" aria-label="Breadcrumb">
          <Link to="/" className="crumb">JustAVPS V2</Link>
          <IconChevronRight className="separator" width={14} height={14} />
          <span className={cx('crumb', 'is-leaf')}>{title}</span>
        </nav>
        <span className="spacer" />
        {state.busy ? (
          <Tag tone="info" data-testid="v2-busy">
            <span className="dot dot--info" />
            <span>{state.status.label}</span>
          </Tag>
        ) : null}
      </div>

      <div className="topbar-right">
        <Button
          variant="secondary"
          size="sm"
          leftIcon={<IconCommand />}
          onClick={openCommandPalette}
          aria-label="Command palette"
          data-testid="v2-cmdk"
        >
          <span className="text-muted">Search</span>
          <KbdRow keys={[modKey, 'K']} />
        </Button>

        <Button
          variant="secondary"
          size="sm"
          leftIcon={<IconRefresh />}
          disabled={state.busy}
          onClick={() => refreshAll().catch(() => {})}
          data-testid="v2-refresh-all"
          id="refresh-all"
        >
          Refresh
        </Button>

        <Button
          size="sm"
          variant="primary"
          leftIcon={<IconBolt />}
          disabled={state.busy || workflowRunning}
          onClick={() => runWorkflow().catch(() => {})}
          data-testid="v2-run-workflow"
          id="full-workflow"
        >
          {workflowRunning ? 'Running…' : 'Run E2E'}
        </Button>

        <span
          id="status"
          className={cx('tag', state.status.tone === 'ok' && 'tag--ok', state.status.tone === 'bad' && 'tag--bad', state.status.tone === 'warn' && 'tag--warn')}
          data-testid="v2-status"
        >
          {state.status.label}
        </span>
      </div>
    </header>
  );
}
