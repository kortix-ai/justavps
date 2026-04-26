import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { useFullWorkflow } from '../features/workflow/useFullWorkflow';
import { useStore } from '../lib/store';
import { cx } from '../lib/utils';

const TITLES: Record<string, [string, string]> = {
  '/': ['Dashboard', 'Live system snapshot of the standalone V2 API.'],
  '/topology': ['Topology', 'Regions, clusters, hosts, and persisted inventory.'],
  '/machines': ['Machines', 'Create, inspect, and manage Incus-backed machines.'],
  '/artifacts': ['Artifacts', 'Image catalog across configured clusters.'],
  '/vendor': ['Vendor', 'Hetzner Robot servers and product catalog.'],
  '/procurement': ['Procurement', 'Order planning and IncusOS bootstrap pipeline.'],
  '/console': ['API Console', 'Send raw requests to any V2 API path.'],
};

function titleFor(pathname: string): [string, string] {
  if (TITLES[pathname]) return TITLES[pathname];
  for (const [prefix, value] of Object.entries(TITLES)) {
    if (prefix !== '/' && pathname.startsWith(prefix)) return value;
  }
  return TITLES['/'];
}

export function Topbar() {
  const { state, setBaseUrl, setToken, refreshAll } = useStore();
  const { run: runFullWorkflow, running: workflowRunning } = useFullWorkflow();
  const location = useLocation();
  const [title, sub] = titleFor(location.pathname);

  useEffect(() => {
    document.title = `${title} · JustAVPS V2 Admin`;
  }, [title]);

  return (
    <header className="topbar">
      <div>
        <h1 id="page-title">{title}</h1>
        <p id="page-sub">{sub}</p>
      </div>
      <div className="right">
        <input
          id="api-url"
          className="input compact"
          placeholder="V2 API URL"
          value={state.baseUrl}
          onChange={(e) => setBaseUrl(e.target.value)}
        />
        <input
          id="admin-token"
          className="input compact"
          placeholder="Admin token"
          type="password"
          autoComplete="off"
          value={state.token}
          onChange={(e) => setToken(e.target.value)}
        />
        <button
          type="button"
          id="refresh-all"
          className="button"
          data-testid="v2-refresh-all"
          disabled={state.busy}
          onClick={() => {
            refreshAll().catch(() => {
              /* surfaced via runAction */
            });
          }}
        >
          Refresh
        </button>
        <button
          type="button"
          id="full-workflow"
          className="button success"
          data-testid="v2-run-workflow"
          disabled={state.busy || workflowRunning}
          onClick={() => {
            runFullWorkflow().catch(() => {
              /* surfaced via store */
            });
          }}
        >
          {workflowRunning ? 'Running…' : 'Run Full E2E'}
        </button>
      </div>
      <div className="right">
        <span
          id="status"
          className={cx('pill', state.status.tone !== 'idle' && state.status.tone)}
          data-testid="v2-status"
        >
          {state.status.label}
        </span>
      </div>
    </header>
  );
}
