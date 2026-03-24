"use client";

import Link from "next/link";
import { useState } from "react";
import { usePathname } from "next/navigation";
import { useSession, signOut } from "next-auth/react";
import { cn } from "@/lib/utils";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
} from "@/components/ui/sidebar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useTheme } from "@/hooks/use-theme";
import { Logo } from "@/components/logo";
import {
  Server,
  HardDrive,
  KeyRound,
  CreditCard,
  FileText,
  Code2,
  Settings,
  ChevronsUpDown,
  LogOut,
  Sun,
  Moon,
  Webhook,
  ShieldCheck,
  Check,
  Building2,
  User,
  Plus,
} from "lucide-react";
import { useAccount, useMe, useSwitchAccount, useCreateOrganization } from "@/hooks/use-account";
import { toast } from "sonner";

const navigation = [
  { name: "Machines", href: "/machines", icon: Server },
  { name: "Images", href: "/images", icon: HardDrive },
  { name: "Keys", href: "/keys", icon: KeyRound },
  { name: "API Reference", href: "/api/docs", icon: Code2 },
  { name: "Docs", href: "/docs", icon: FileText },
  { name: "Billing", href: "/billing", icon: CreditCard },
  { name: "Webhooks", href: "/webhooks", icon: Webhook },
  { name: "Settings", href: "/settings", icon: Settings },
];

const adminNavigation = [
  { name: "Routing", href: "/admin/routing", icon: ShieldCheck },
];

export function AppSidebar() {
  const pathname = usePathname();
  const { data: session } = useSession();
  const { theme, toggleTheme } = useTheme();
  const { data: account } = useAccount();
  const { data: me } = useMe();
  const switchAccount = useSwitchAccount();
  const createOrganization = useCreateOrganization();
  const [orgDialogOpen, setOrgDialogOpen] = useState(false);
  const [orgName, setOrgName] = useState("");

  const email = session?.user?.email || "user";
  const name = session?.user?.name || email.split("@")[0];
  const initial = name[0]?.toUpperCase() || "U";
  const isAdmin = account?.is_admin ?? false;
  const allNavigation = isAdmin ? [...navigation, ...adminNavigation] : navigation;
  const activeAccount = me?.active_account;

  function handleCreateOrganization(e: React.FormEvent) {
    e.preventDefault();
    if (!orgName.trim()) return;

    createOrganization.mutate(orgName.trim(), {
      onSuccess: () => {
        toast.success("Organization created");
        setOrgDialogOpen(false);
        setOrgName("");
        window.location.reload();
      },
      onError: (error: Error) => {
        toast.error(error.message);
      },
    });
  }

  function handleSwitchAccount(accountId: string) {
    if (accountId === activeAccount?.id) return;
    switchAccount.mutate(accountId, {
      onSuccess: () => {
        window.location.reload();
      },
      onError: (error: Error) => {
        toast.error(error.message);
      },
    });
  }

  return (
    <>
      <Sidebar variant="inset" collapsible="icon">
        <SidebarHeader>
          <div className="flex items-center px-2 py-1 group-data-[collapsible=icon]:justify-center">
            <Logo className="group-data-[collapsible=icon]:hidden" />
            <div className="hidden group-data-[collapsible=icon]:flex shrink-0 items-center justify-center">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/kortix-symbol.svg" alt="Kortix" className="h-[14px] w-auto dark:invert flex-shrink-0" />
            </div>
          </div>
        </SidebarHeader>
        <SidebarContent>
          <nav className="space-y-0.5 px-2 pt-2">
            {allNavigation.map((item) => {
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
                <Avatar className="size-7 rounded-md shrink-0">
                  <AvatarFallback className="rounded-md bg-muted text-muted-foreground text-xs">
                    {initial}
                  </AvatarFallback>
                </Avatar>
                <div className="flex-1 text-left min-w-0 group-data-[collapsible=icon]:hidden">
                  <div className="flex items-center gap-1.5">
                    <span className="truncate text-sm font-medium leading-tight">{name}</span>
                    {isAdmin && (
                      <ShieldCheck className="size-3 text-violet-500 shrink-0" />
                    )}
                  </div>
                  <div className="truncate text-xs text-sidebar-foreground/50 leading-tight">
                    {account?.type === "organization"
                      ? account.name
                      : activeAccount?.type === "organization"
                        ? activeAccount.name
                        : email}
                  </div>
                </div>
                <ChevronsUpDown className="size-3.5 text-sidebar-foreground/40 shrink-0 group-data-[collapsible=icon]:hidden" />
              </DropdownMenuTrigger>
              <DropdownMenuContent
                side="top"
                align="start"
                sideOffset={6}
                className="w-56"
              >
                {/* Theme toggle */}
                <DropdownMenuItem onClick={toggleTheme}>
                  {theme === "dark" ? <Sun className="size-4" /> : <Moon className="size-4" />}
                  {theme === "dark" ? "Light mode" : "Dark mode"}
                </DropdownMenuItem>

                {/* Account switcher */}
                {me?.memberships && me.memberships.length > 0 && (
                  <>
                    <DropdownMenuSeparator />
                    <div className="px-2 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                      Accounts
                    </div>
                    {me.memberships.map((membership) => {
                      const isActive = membership.account.id === activeAccount?.id;
                      return (
                        <DropdownMenuItem
                          key={membership.account.id}
                          onClick={() => handleSwitchAccount(membership.account.id)}
                          disabled={switchAccount.isPending}
                          className="gap-2"
                        >
                          <div className="flex size-5 items-center justify-center rounded bg-muted shrink-0">
                            {membership.account.type === "organization" ? (
                              <Building2 className="size-3 text-muted-foreground" />
                            ) : (
                              <User className="size-3 text-muted-foreground" />
                            )}
                          </div>
                          <span className="truncate flex-1">{membership.account.name}</span>
                          {isActive && <Check className="size-3.5 text-primary shrink-0" />}
                        </DropdownMenuItem>
                      );
                    })}
                    <DropdownMenuItem onClick={() => setOrgDialogOpen(true)} className="gap-2">
                      <div className="flex size-5 items-center justify-center rounded border border-dashed border-muted-foreground/40 shrink-0">
                        <Plus className="size-3 text-muted-foreground" />
                      </div>
                      <span className="text-muted-foreground">Create organization</span>
                    </DropdownMenuItem>
                  </>
                )}

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

      {/* Create Organization Dialog */}
      <Dialog open={orgDialogOpen} onOpenChange={setOrgDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Create organization</DialogTitle>
            <DialogDescription>
              Organizations let you share machines, images, and billing with your team.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleCreateOrganization}>
            <div className="space-y-2 py-2">
              <Label htmlFor="org-name">Organization name</Label>
              <Input
                id="org-name"
                placeholder="Acme Inc."
                value={orgName}
                onChange={(e) => setOrgName(e.target.value)}
                required
                minLength={2}
                maxLength={120}
                autoFocus
              />
            </div>
            <DialogFooter className="mt-4">
              <Button type="submit" disabled={createOrganization.isPending || !orgName.trim()}>
                {createOrganization.isPending ? "Creating..." : "Create organization"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
