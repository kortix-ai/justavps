import {
  LayoutDashboard,
  Boxes,
  ImageIcon,
  Settings,
  Network,
  Building2,
  ShoppingCart,
  Terminal,
  ShieldCheck,
} from 'lucide-react';

export type Scope = 'workspace' | 'admin';

export type NavItem = {
  to: string;
  label: string;
  icon: typeof LayoutDashboard;
  route: string;
  match?: (p: string) => boolean;
};

export const WORKSPACE_NAV: NavItem[] = [
  { to: '/', label: 'Overview', icon: LayoutDashboard, route: 'dashboard', match: (p) => p === '/' },
  { to: '/machines', label: 'Machines', icon: Boxes, route: 'machines' },
  { to: '/images', label: 'Images', icon: ImageIcon, route: 'images' },
  { to: '/settings', label: 'Settings', icon: Settings, route: 'settings' },
];

export const ADMIN_NAV: NavItem[] = [
  { to: '/admin', label: 'Overview', icon: ShieldCheck, route: 'admin', match: (p) => p === '/admin' || p === '/admin/' },
  { to: '/admin/topology', label: 'Topology', icon: Network, route: 'topology' },
  { to: '/admin/vendor', label: 'Vendor', icon: Building2, route: 'vendor' },
  { to: '/admin/procurement', label: 'Procurement', icon: ShoppingCart, route: 'procurement' },
  { to: '/admin/console', label: 'API Console', icon: Terminal, route: 'console' },
];

export function navForScope(scope: Scope): NavItem[] {
  return scope === 'admin' ? ADMIN_NAV : WORKSPACE_NAV;
}

export function scopeHome(scope: Scope): string {
  return scope === 'admin' ? '/admin' : '/';
}

export function isActive(item: NavItem, pathname: string) {
  const stripped = pathname.replace(/\/$/, '') || '/';
  if (item.match) return item.match(stripped);
  return stripped === item.to || stripped.startsWith(`${item.to}/`);
}

export function pageTitle(scope: Scope, pathname: string): string {
  const items = navForScope(scope);
  const stripped = pathname.replace(/\/$/, '') || '/';
  for (const item of items) {
    if (isActive(item, stripped)) return item.label;
  }
  return scope === 'admin' ? 'Admin' : 'Workspace';
}
