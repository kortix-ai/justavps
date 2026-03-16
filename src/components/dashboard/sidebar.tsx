"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useSession, signOut } from "next-auth/react";
import { cn } from "@/lib/utils";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  useSidebar,
} from "@/components/ui/sidebar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { useTheme } from "@/hooks/use-theme";
import {
  Server,
  HardDrive,
  KeyRound,
  CreditCard,
  Settings,
  FileText,
  ChevronsUpDown,
  LogOut,
  Sun,
  Moon,
} from "lucide-react";

const navigation = [
  { name: "Machines", href: "/machines", icon: Server },
  { name: "Snapshots", href: "/snapshots", icon: HardDrive },
  { name: "Keys", href: "/keys", icon: KeyRound },
  { name: "Billing", href: "/billing", icon: CreditCard },
  { name: "Docs", href: "/docs", icon: FileText },
];

export function AppSidebar() {
  const pathname = usePathname();
  const { data: session } = useSession();
  const { theme, toggleTheme } = useTheme();

  const email = session?.user?.email || "user";
  const name = session?.user?.name || email.split("@")[0];
  const initial = name[0]?.toUpperCase() || "U";

  return (
    <Sidebar variant="inset" collapsible="icon">
      <SidebarHeader>
        <div className="flex items-center gap-2.5 px-2 py-1 group-data-[collapsible=icon]:justify-center">
          <div className="flex size-8 shrink-0 items-center justify-center rounded-md bg-foreground text-background">
            <Server className="size-4" />
          </div>
          <span className="text-[15px] font-semibold tracking-tight group-data-[collapsible=icon]:hidden">
            JustAVPS.
          </span>
        </div>
      </SidebarHeader>
      <SidebarContent>
        <nav className="space-y-0.5 px-2 pt-2">
          {navigation.map((item) => {
            const isActive = pathname.startsWith(item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  "flex items-center gap-2.5 rounded-md px-2.5 py-2 text-sm transition-colors",
                  "group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:px-0",
                  isActive
                    ? "bg-sidebar-accent text-sidebar-accent-foreground font-medium"
                    : "text-sidebar-foreground/70 hover:bg-sidebar-accent/50 hover:text-sidebar-accent-foreground"
                )}
              >
                <item.icon className="size-4 shrink-0" />
                <span className="group-data-[collapsible=icon]:hidden">{item.name}</span>
              </Link>
            );
          })}
        </nav>
      </SidebarContent>

      <SidebarFooter>
        <div className="pb-1">
          <DropdownMenu>
            <DropdownMenuTrigger
              className="flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-sm transition-colors hover:bg-sidebar-accent/50 outline-none group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:px-0"
            >
              <Avatar className="size-7 shrink-0 rounded-md">
                <AvatarFallback className="rounded-md bg-muted text-muted-foreground text-xs">
                  {initial}
                </AvatarFallback>
              </Avatar>
              <div className="flex-1 text-left min-w-0 group-data-[collapsible=icon]:hidden">
                <div className="truncate text-sm font-medium leading-tight">{name}</div>
                <div className="truncate text-xs text-sidebar-foreground/50 leading-tight">{email}</div>
              </div>
              <ChevronsUpDown className="size-3.5 text-sidebar-foreground/40 shrink-0 group-data-[collapsible=icon]:hidden" />
            </DropdownMenuTrigger>
            <DropdownMenuContent
              side="top"
              align="start"
              sideOffset={6}
              className="w-52"
            >
              <DropdownMenuItem onClick={() => window.location.href = "/settings"}>
                <Settings className="size-4" />
                Settings
              </DropdownMenuItem>
              <DropdownMenuItem onClick={toggleTheme}>
                {theme === "dark" ? <Sun className="size-4" /> : <Moon className="size-4" />}
                {theme === "dark" ? "Light mode" : "Dark mode"}
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => signOut({ callbackUrl: "/" })}>
                <LogOut className="size-4" />
                Sign out
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </SidebarFooter>
    </Sidebar>
  );
}
