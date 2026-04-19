"use client";

import Link from "next/link";
import { useState } from "react";
import { usePathname } from "next/navigation";
import { useSession, signOut } from "next-auth/react";
import { cn } from "@/shared/lib/utils";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
} from "@/shared/ui/sidebar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/shared/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/shared/ui/dialog";
import { Avatar, AvatarFallback } from "@/shared/ui/avatar";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { Label } from "@/shared/ui/label";
import { useTheme } from "@/shared/hooks/use-theme";
import { Logo } from "@/shared/components/logo";
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
  MailOpen,
  X,
} from "lucide-react";
import {
  useAccount,
  useMe,
  useSwitchAccount,
  useCreateOrganization,
  useMyPendingInvitations,
  useAcceptMyInvitation,
  useDeclineMyInvitation,
} from "@/shared/hooks/use-account";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { detectUiVersionFromPath, pathForVersion, type UiVersion } from "@/shared/lib/versioning";

const navigation = [
  { name: "Machines", href: "/machines", icon: Server },
  { name: "Images", href: "/images", icon: HardDrive },
  { name: "Keys", href: "/keys", icon: KeyRound },
  { name: "API Reference", href: "/api/docs/v2", icon: Code2 },
  { name: "Docs", href: "/docs", icon: FileText },
  { name: "Billing", href: "/billing", icon: CreditCard },
  { name: "Webhooks", href: "/webhooks", icon: Webhook },
  { name: "Settings", href: "/settings", icon: Settings },
];

const adminNavigationV2 = [
  { name: "All Machines", href: "/admin/machines", icon: Server },
  { name: "Fleet", href: "/v2/admin/fleet", icon: HardDrive },
  { name: "Routing", href: "/admin/routing", icon: ShieldCheck },
];

const versionSwitchItems: Array<{ label: string; version: UiVersion }> = [
  { label: "V1", version: "v1" },
  { label: "V2", version: "v2" },
];

export function AppSidebarV2() {
  const pathname = usePathname();
  const { data: session } = useSession();
  const { theme, toggleTheme } = useTheme();
  const { data: account } = useAccount();
  const { data: me } = useMe();
  const switchAccount = useSwitchAccount();
  const createOrganization = useCreateOrganization();
  const { data: pendingInvitations = [] } = useMyPendingInvitations();
  const acceptInvitation = useAcceptMyInvitation();
  const declineInvitation = useDeclineMyInvitation();
  const queryClient = useQueryClient();
  const [orgDialogOpen, setOrgDialogOpen] = useState(false);
  const [orgName, setOrgName] = useState("");

  const email = session?.user?.email || "user";
  const name = session?.user?.name || email.split("@")[0];
  const initial = name[0]?.toUpperCase() || "U";
  const uiVersion = detectUiVersionFromPath(pathname);
  const isAdmin = account?.is_admin ?? false;
  const activeAccount = me?.active_account;
  const currentAdminNavigation = adminNavigationV2;
  const allNavigation = isAdmin
    ? [...navigation, { name: "__admin_separator__", href: "", icon: ShieldCheck }, ...currentAdminNavigation]
    : navigation;

  function versionedHref(href: string) {
    return uiVersion === "v2" ? pathForVersion(href, "v2") : href;
  }

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

  function handleAcceptInvitation(invitationId: string, accountName: string) {
    acceptInvitation.mutate(invitationId, {
      onSuccess: () => {
        toast.success(`Joined ${accountName}`);
        queryClient.invalidateQueries({ queryKey: ["account"] });
        window.location.reload();
      },
      onError: (error: Error) => {
        toast.error(error.message);
      },
    });
  }

  function handleDeclineInvitation(invitationId: string) {
    // Optimistic removal from cache
    queryClient.setQueryData<typeof pendingInvitations>(
      ["account", "me", "invitations"],
      (old) => (old ?? []).filter((inv) => inv.id !== invitationId),
    );
    declineInvitation.mutate(invitationId, {
      onSuccess: () => {
        toast.success("Invitation declined");
        queryClient.invalidateQueries({ queryKey: ["account", "me", "invitations"] });
      },
      onError: (error: Error) => {
        toast.error(error.message);
        // Revert on error
        queryClient.invalidateQueries({ queryKey: ["account", "me", "invitations"] });
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
            <div className="mb-3 px-2.5 group-data-[collapsible=icon]:px-0">
              <div className="flex items-center justify-between gap-2 rounded-md border border-sidebar-border bg-sidebar-accent/30 p-1 text-xs group-data-[collapsible=icon]:justify-center">
                {versionSwitchItems.map((item) => {
                  const active = item.version === uiVersion;
                  const target = pathForVersion(pathname || "/machines", item.version);
                  return (
                    <Link
                      key={item.version}
                      href={target}
                      className={cn(
                        "flex-1 rounded px-2 py-1 text-center transition-colors group-data-[collapsible=icon]:hidden",
                        active ? "bg-sidebar-background text-sidebar-foreground font-medium shadow-sm" : "text-sidebar-foreground/60 hover:text-sidebar-foreground"
                      )}
                    >
                      {item.label}
                    </Link>
                  );
                })}
                <span className="hidden text-[10px] font-semibold uppercase tracking-wide text-sidebar-foreground/60 group-data-[collapsible=icon]:block">
                  {uiVersion}
                </span>
              </div>
            </div>
            {allNavigation.map((item) => {
              if (item.name === "__admin_separator__") {
                return (
                  <div key="admin-sep" className="pt-3 pb-1 px-2.5 group-data-[collapsible=icon]:px-0">
                    <div className="border-t border-sidebar-border" />
                    <span className="mt-2 block text-[10px] font-semibold uppercase tracking-wider text-sidebar-foreground/40 group-data-[collapsible=icon]:hidden">
                      Admin
                    </span>
                  </div>
                );
              }
              const isActive = pathname.startsWith(versionedHref(item.href));
              return (
                <Link
                  key={item.href}
                  href={versionedHref(item.href)}
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

          {/* Pending invitations */}
          {pendingInvitations.length > 0 && (
            <div className="px-2 pt-4 group-data-[collapsible=icon]:hidden">
              <div className="rounded-lg border border-primary/20 bg-primary/5">
                <div className="flex items-center gap-2 px-3 py-2 border-b border-primary/10">
                  <MailOpen className="size-3.5 text-primary shrink-0" />
                  <span className="text-xs font-semibold text-primary">
                    {pendingInvitations.length} pending {pendingInvitations.length === 1 ? "invite" : "invites"}
                  </span>
                </div>
                <div className="divide-y divide-primary/10">
                  {pendingInvitations.map((invite) => (
                    <div key={invite.id} className="px-3 py-2.5 space-y-1.5">
                      <div className="flex items-center gap-1.5">
                        <Building2 className="size-3 text-muted-foreground shrink-0" />
                        <span className="text-sm font-medium truncate">{invite.account_name}</span>
                      </div>
                      <div className="text-[11px] text-muted-foreground">
                        Role: <span className="capitalize">{invite.role}</span>
                      </div>
                      <div className="flex gap-1.5">
                        <Button
                          size="sm"
                          variant="default"
                          className="h-6 text-xs px-2 flex-1"
                          disabled={acceptInvitation.isPending}
                          onClick={() => handleAcceptInvitation(invite.id, invite.account_name)}
                        >
                          {acceptInvitation.isPending ? "..." : "Accept"}
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-6 w-6 p-0 shrink-0 text-muted-foreground hover:text-destructive"
                          disabled={declineInvitation.isPending}
                          onClick={() => handleDeclineInvitation(invite.id)}
                        >
                          <X className="size-3" />
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* Collapsed icon badge for invitations */}
          {pendingInvitations.length > 0 && (
            <div className="hidden group-data-[collapsible=icon]:flex justify-center pt-3">
              <div className="relative">
                <MailOpen className="size-4 text-primary" />
                <span className="absolute -top-1.5 -right-1.5 flex size-3.5 items-center justify-center rounded-full bg-primary text-[9px] font-bold text-primary-foreground">
                  {pendingInvitations.length}
                </span>
              </div>
            </div>
          )}
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
