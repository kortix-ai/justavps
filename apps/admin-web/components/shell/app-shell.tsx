'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useStore } from '@/lib/store';
import { useUiPrefs } from '@/lib/ui-prefs';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuTrigger,
  DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuRadioGroup, DropdownMenuRadioItem,
} from '@/components/ui/dropdown-menu';
import {
  Tooltip, TooltipContent, TooltipTrigger,
} from '@/components/ui/tooltip';
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarRail,
  SidebarSeparator,
  SidebarTrigger,
} from '@/components/ui/sidebar';
import { cn } from '@/lib/utils';
import {
  Network,
  Boxes, Flame, ImageIcon, Settings, RefreshCw, Building2, ReceiptText,
  Sun, Moon, Laptop,
} from 'lucide-react';

type NavItem = {
  to: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
};

const USER_NAV: NavItem[] = [
  { to: '/machines', label: 'Machines', icon: Boxes },
  { to: '/templates', label: 'Templates', icon: ImageIcon },
  { to: '/pools', label: 'Pools', icon: Flame },
];

const ADMIN_NAV: NavItem[] = [
  { to: '/accounts', label: 'Accounts', icon: Building2 },
  { to: '/billing', label: 'Billing', icon: ReceiptText },
  { to: '/admin/fleet', label: 'Fleet', icon: Network },
];

const TAIL_NAV: NavItem[] = [
  { to: '/settings', label: 'Settings', icon: Settings },
];

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname() || '';
  const { state, refreshAll } = useStore();
  const { theme, setTheme } = useUiPrefs();

  return (
    <SidebarProvider>
      <Sidebar collapsible="icon">
        <SidebarHeader>
          <div className="flex h-10 items-center gap-2 px-2 font-semibold tracking-tight group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:px-0">
            <span className="size-2 shrink-0 rounded-full bg-primary" />
            <span className="group-data-[collapsible=icon]:hidden">JustAVPS</span>
          </div>
        </SidebarHeader>

        <SidebarContent>
          <SidebarGroup>
            <SidebarGroupContent>
              <SidebarMenu>
                {USER_NAV.map((item) => (
                  <NavItemLink key={item.to} item={item} pathname={pathname} />
                ))}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>

          <SidebarGroup>
            <SidebarGroupLabel>Admin</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {ADMIN_NAV.map((item) => (
                  <NavItemLink key={item.to} item={item} pathname={pathname} />
                ))}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>

          <SidebarGroup className="mt-auto">
            <SidebarGroupContent>
              <SidebarMenu>
                {TAIL_NAV.map((item) => (
                  <NavItemLink key={item.to} item={item} pathname={pathname} />
                ))}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        </SidebarContent>

        <SidebarSeparator />
        <SidebarFooter>
          <div className="flex items-center gap-2 px-2 py-1 text-xs text-sidebar-foreground/60 group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:px-0">
            <span className={cn(
              'size-1.5 shrink-0 rounded-full',
              state.health?.status === 'ok' ? 'bg-emerald-500' : 'bg-amber-500',
            )} />
            <span className="truncate font-mono group-data-[collapsible=icon]:hidden">
              {state.baseUrl.replace(/^https?:\/\//, '')}
            </span>
          </div>
        </SidebarFooter>

        <SidebarRail />
      </Sidebar>

      <SidebarInset>
        <header className="sticky top-0 z-10 flex h-12 items-center justify-between border-b bg-background/80 px-4 backdrop-blur">
          <div className="flex items-center gap-3">
            <Tooltip>
              <TooltipTrigger asChild>
                <SidebarTrigger className="-ml-1" />
              </TooltipTrigger>
              <TooltipContent side="bottom">
                Toggle sidebar <kbd className="ml-1 rounded border bg-muted px-1 py-0.5 text-2xs font-mono">⌘B</kbd>
              </TooltipContent>
            </Tooltip>
            <div className="text-xs text-muted-foreground">
              {state.busy ? (
                <span className="inline-flex items-center gap-1.5 text-foreground">
                  <span className="size-1.5 animate-pulse rounded-full bg-amber-500" />
                  {state.status?.label ?? 'busy'}…
                </span>
              ) : (
                <span className="inline-flex items-center gap-1.5">
                  <span className="size-1.5 rounded-full bg-emerald-500" />
                  Ready
                </span>
              )}
            </div>
          </div>
          <div className="flex items-center gap-2">
            {state.health?.incus_clusters_configured !== undefined ? (
              <Badge variant="outline" className="text-xs font-normal">
                {state.health.incus_clusters_configured} cluster(s)
              </Badge>
            ) : null}
            <Button variant="ghost" size="sm" onClick={() => refreshAll().catch(() => {})} disabled={state.busy}>
              <RefreshCw className="size-3.5" /> Refresh
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon-sm" title="Theme">
                  {theme === 'light' ? <Sun className="size-4" /> : theme === 'system' ? <Laptop className="size-4" /> : <Moon className="size-4" />}
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuLabel>Theme</DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuRadioGroup value={theme} onValueChange={(v) => setTheme(v as 'dark' | 'light' | 'system')}>
                  <DropdownMenuRadioItem value="light">
                    <Sun className="size-3.5" /> Light
                  </DropdownMenuRadioItem>
                  <DropdownMenuRadioItem value="dark">
                    <Moon className="size-3.5" /> Dark
                  </DropdownMenuRadioItem>
                  <DropdownMenuRadioItem value="system">
                    <Laptop className="size-3.5" /> System
                  </DropdownMenuRadioItem>
                </DropdownMenuRadioGroup>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </header>
        <main className="flex-1 overflow-y-auto">
          <div className="mx-auto w-full max-w-6xl p-6">{children}</div>
        </main>
      </SidebarInset>
    </SidebarProvider>
  );
}

function NavItemLink({ item, pathname }: { item: NavItem; pathname: string }) {
  const stripped = pathname.replace(/\/$/, '') || '/';
  const active = stripped === item.to || stripped.startsWith(`${item.to}/`);
  const Icon = item.icon;
  return (
    <SidebarMenuItem>
      <SidebarMenuButton asChild isActive={active} tooltip={item.label}>
        <Link href={item.to}>
          <Icon />
          <span>{item.label}</span>
        </Link>
      </SidebarMenuButton>
    </SidebarMenuItem>
  );
}
