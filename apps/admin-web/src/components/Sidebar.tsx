import { NavLink } from 'react-router-dom';
import { useStore } from '../lib/store';

const NAV_ITEMS = [
  { to: '/', icon: '◆', label: 'Dashboard', end: true, route: 'dashboard' },
  { to: '/topology', icon: '⌬', label: 'Topology', route: 'topology' },
  { to: '/machines', icon: '#', label: 'Machines', route: 'machines' },
  { to: '/artifacts', icon: '~', label: 'Artifacts', route: 'artifacts' },
  { to: '/vendor', icon: '$', label: 'Vendor', route: 'vendor' },
  { to: '/procurement', icon: '+', label: 'Procurement', route: 'procurement' },
  { to: '/console', icon: '>', label: 'API Console', route: 'console' },
];

export function Sidebar() {
  const { state } = useStore();
  return (
    <aside className="sidebar">
      <div className="brand">
        <div className="brand-mark" />
        <div>
          <div className="brand-name">JustAVPS V2</div>
          <div className="brand-sub">Incus Control</div>
        </div>
      </div>

      <div>
        <div className="sidebar-section">Workspace</div>
        <nav id="primary-nav" className="nav">
          {NAV_ITEMS.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              data-route={item.route}
              className={({ isActive }) => `nav-link${isActive ? ' active' : ''}`}
            >
              <span className="nav-icon" aria-hidden="true">
                {item.icon}
              </span>
              {item.label}
            </NavLink>
          ))}
        </nav>
      </div>

      <div>
        <div className="sidebar-section">Live</div>
        <div className="chip-row">
          <span className="pill" id="chip-health">
            health {state.health?.status ?? '-'}
          </span>
          <span className="pill" id="chip-clusters">
            clusters {state.clusters.length}
          </span>
          <span className="pill" id="chip-machines">
            machines {state.machines.length}
          </span>
        </div>
      </div>

      <div className="sidebar-foot">
        <span className="pill" id="last-refresh">
          {state.lastRefreshAt ? `updated ${state.lastRefreshAt}` : 'never refreshed'}
        </span>
        <span className="pill" id="token-state">
          {state.token ? 'token set' : 'token unset'}
        </span>
      </div>
    </aside>
  );
}
