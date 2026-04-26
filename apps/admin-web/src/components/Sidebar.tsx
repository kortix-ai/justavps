import { NavLink } from 'react-router-dom';
import { useStore } from '../lib/store';
import { cx } from '../lib/utils';
import { Tag } from './ui/Tag';
import {
  IconHome,
  IconNetwork,
  IconBox,
  IconImage,
  IconBuilding,
  IconShoppingCart,
  IconTerminal,
  IconSettings,
} from './ui/icons';

const NAV_ITEMS = [
  { to: '/', label: 'Dashboard', icon: IconHome, route: 'dashboard', end: true },
  { to: '/topology', label: 'Topology', icon: IconNetwork, route: 'topology' },
  { to: '/machines', label: 'Machines', icon: IconBox, route: 'machines' },
  { to: '/artifacts', label: 'Artifacts', icon: IconImage, route: 'artifacts' },
  { to: '/vendor', label: 'Vendor', icon: IconBuilding, route: 'vendor' },
  { to: '/procurement', label: 'Procurement', icon: IconShoppingCart, route: 'procurement' },
  { to: '/console', label: 'API Console', icon: IconTerminal, route: 'console' },
  { to: '/settings', label: 'Settings', icon: IconSettings, route: 'settings' },
];

export function Sidebar() {
  const { state } = useStore();
  const tokenSet = Boolean(state.token);
  const healthOk = state.health?.status === 'ok';
  return (
    <aside className="sidebar">
      <div className="sidebar-brand">
        <div className="sidebar-brand-mark">▲</div>
        <div>
          <div className="sidebar-brand-name">JustAVPS V2</div>
          <div className="sidebar-brand-sub">Incus control plane</div>
        </div>
      </div>

      <div>
        <div className="sidebar-section">Workspace</div>
        <nav id="primary-nav" className="sidebar-nav">
          {NAV_ITEMS.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              data-route={item.route}
              className={({ isActive }) => cx('nav-link', isActive && 'is-active')}
            >
              <span className="nav-icon">
                <item.icon />
              </span>
              {item.label}
            </NavLink>
          ))}
        </nav>
      </div>

      <div className="sidebar-foot">
        <div className="toolbar" style={{ gap: 6, justifyContent: 'space-between', padding: '6px 4px' }}>
          <Tag tone={healthOk ? 'ok' : state.health ? 'warn' : 'ghost'}>
            {state.health?.status ?? 'no health'}
          </Tag>
          <Tag tone={tokenSet ? 'violet' : 'ghost'}>{tokenSet ? 'token set' : 'no token'}</Tag>
        </div>
        <div className="text-subtle text-sm" style={{ padding: '0 6px 4px' }}>
          {state.lastRefreshAt ? `synced ${state.lastRefreshAt}` : 'awaiting sync'}
        </div>
      </div>
    </aside>
  );
}
