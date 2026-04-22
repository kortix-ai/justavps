import type { LucideIcon } from "lucide-react";
import {
  Activity,
  Boxes,
  CircuitBoard,
  CreditCard,
  Globe2,
  Image,
  KeyRound,
  LayoutDashboard,
  Network,
  Plug,
  Server,
  ShieldCheck,
  ShoppingBag,
  Users,
  Webhook,
} from "lucide-react";

export type AdminNavItem = {
  label: string;
  href: string;
  icon: LucideIcon;
  description: string;
  group: "core" | "operations" | "diagnostics";
};

export const ADMIN_NAV: AdminNavItem[] = [
  {
    label: "Overview",
    href: "/v2/admin",
    icon: LayoutDashboard,
    description: "What needs your attention right now",
    group: "core",
  },
  {
    label: "Regions",
    href: "/v2/admin/regions",
    icon: Globe2,
    description: "Geographic regions, admission, reserves",
    group: "core",
  },
  {
    label: "Clusters",
    href: "/v2/admin/clusters",
    icon: CircuitBoard,
    description: "Incus clusters grouped inside each region",
    group: "core",
  },
  {
    label: "Hosts",
    href: "/v2/admin/hosts",
    icon: Server,
    description: "Bare-metal inventory, lifecycle, validation",
    group: "core",
  },
  {
    label: "Machines",
    href: "/v2/admin/machines",
    icon: Boxes,
    description: "User VMs — search, filter, batch operations",
    group: "core",
  },
  {
    label: "Accounts",
    href: "/v2/admin/accounts",
    icon: Users,
    description: "Customers, orgs, memberships",
    group: "core",
  },
  {
    label: "Procurements",
    href: "/v2/admin/procurements",
    icon: ShoppingBag,
    description: "Hetzner orders, recommendations, Robot sync",
    group: "operations",
  },
  {
    label: "Images",
    href: "/v2/admin/images",
    icon: Image,
    description: "User snapshots, templates, backups across the fleet",
    group: "operations",
  },
  {
    label: "Billing",
    href: "/v2/admin/billing",
    icon: CreditCard,
    description: "Customer subscriptions, MRR, payment health",
    group: "operations",
  },
  {
    label: "Activity",
    href: "/v2/admin/activity",
    icon: Activity,
    description: "Unified event timeline across the fleet",
    group: "diagnostics",
  },
  {
    label: "Audit",
    href: "/v2/admin/audit",
    icon: ShieldCheck,
    description: "Config audit, validation, drift",
    group: "diagnostics",
  },
  {
    label: "Integrations",
    href: "/v2/admin/integrations",
    icon: Plug,
    description: "Stripe, Hetzner, Cloudflare — upstream reachability",
    group: "diagnostics",
  },
  {
    label: "Webhooks",
    href: "/v2/admin/webhooks",
    icon: Webhook,
    description: "Customer webhook configs + delivery history",
    group: "diagnostics",
  },
  {
    label: "Keys & Security",
    href: "/v2/admin/keys",
    icon: KeyRound,
    description: "SSH keys, API keys, proxy tokens — audit + revoke",
    group: "diagnostics",
  },
  {
    label: "Control Plane",
    href: "/v2/admin/control-plane",
    icon: CircuitBoard,
    description: "Reconciler leases and last-run state",
    group: "diagnostics",
  },
  {
    label: "Edge routing",
    href: "/v2/admin/routing",
    icon: Network,
    description: "DNS / KV / Worker routing drift — click to scan and repair",
    group: "diagnostics",
  },
];

export const ADMIN_NAV_GROUPS: Array<{ id: AdminNavItem["group"]; label: string }> = [
  { id: "core", label: "Fleet" },
  { id: "operations", label: "Operations" },
  { id: "diagnostics", label: "Diagnostics" },
];

export { CircuitBoard };
