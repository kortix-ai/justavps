'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useStore } from '@/lib/store';
import { Tag } from '@/components/ui/tag';
import { cn } from '@/lib/utils';
import {
  LayoutDashboard,
  Network,
  Boxes,
  ImageIcon,
  Building2,
  ShoppingCart,
  Terminal,
  Settings,
} from 'lucide-react';

type NavItem = {
  to: string;
  label: string;
  icon: typeof LayoutDashboard;
  route: string;
  match?: (p: string) => boolean;
};

const NAV_ITEMS: NavItem[] = [
  { to: '/', label: 'Dashboard', icon: LayoutDashboard, route: 'dashboard', match: (p) => p === '/' },
  { to: '/topology', label: 'Topology', icon: Network, route: 'topology' },
  { to: '/machines', label: 'Machines', icon: Boxes, route: 'machines' },
  { to: '/artifacts', label: 'Artifacts', icon: ImageIcon, route: 'artifacts' },
  { to: '/vendor', label: 'Vendor', icon: Building2, route: 'vendor' },
  { to: '/procurement', label: 'Procurement', icon: ShoppingCart, route: 'procurement' },
  { to: '/console', label: 'API Console', icon: Terminal, route: 'console' },
  { to: '/settings', label: 'Settings', icon: Settings, route: 'settings' },
];

function isActive(item: NavItem, pathname: string) {
  const stripped = pathname.replace(/\/$/, '') || '/';
  if (item.match) return item.match(stripped);
  return stripped === item.to || stripped.startsWith(`${item.to}/`);
}

export function Sidebar() {
  const { state } = useStore();
  const pathname = usePathname();
  const tokenSet = Boolean(state.token);
  const healthOk = state.health?.status === 'ok';
  return (
    <aside className="sticky top-0 flex h-screen flex-col gap-3.5 overflow-y-auto border-r border-border bg-bg-1 px-3 py-4">
      <div className="mb-1 flex items-center gap-2.5 border-b border-border px-2 pb-2">
        <div className="flex size-[26px] items-center justify-center rounded-[7px] bg-fg text-[13px] font-bold tracking-[-0.04em] text-bg">▲</div>
        <div>
          <div className="text-[13px] font-semibold tracking-tight">JustAVPS V2</div>
          <div className="text-[11px] text-fg-subtle">Incus control plane</div>
        </div>
      </div>

      <div>
        <div className="px-2.5 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-[0.12em] text-fg-subtle">Workspace</div>
        <nav id="primary-nav" className="flex flex-col gap-px">
          {NAV_ITEMS.map((item) => {
            const active = isActive(item, pathname || '/');
            const Icon = item.icon;
            return (
              <Link
                key={item.to}
                href={item.to}
                data-route={item.route}
                className={cn(
                  'flex items-center gap-2.5 rounded-[8px] border border-transparent px-2.5 py-1.5 text-[13px] font-medium transition-colors',
                  active ? 'bg-surface-active text-fg' : 'text-fg-muted hover:bg-bg-2 hover:text-fg',
                )}
              >
                <Icon className="size-3.5 shrink-0 opacity-90" />
                {item.label}
              </Link>
            );
          })}
        </nav>
      </div>

      <div className="mt-auto border-t border-border pt-2">
        <div className="flex items-center justify-between gap-1.5 px-1 py-1.5">
          <Tag tone={healthOk ? 'ok' : state.health ? 'warn' : 'ghost'}>{state.health?.status ?? 'no health'}</Tag>
          <Tag tone={tokenSet ? 'violet' : 'ghost'}>{tokenSet ? 'token set' : 'no token'}</Tag>
        </div>
        <div className="px-2 pb-1 text-[12px] text-fg-subtle">
          {state.lastRefreshAt ? `synced ${state.lastRefreshAt}` : 'awaiting sync'}
        </div>
      </div>
    </aside>
  );
}
