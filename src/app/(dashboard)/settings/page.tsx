"use client";

import type { ComponentType } from "react";
import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Progress } from "@/components/ui/progress";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  useAccount,
  useMe,
  useAccountLimits,
  useAccountMembers,
  useAccountInvitations,
  useInviteAccountMember,
  useUpdateMemberRole,
  useRemoveMember,
  useRevokeInvitation,
  useCreateOrganization,
} from "@/hooks/use-account";
import { formatLimit, isUnlimitedLimit } from "@/lib/account-limits";
import type { AccountInvitation } from "@/lib/types";
import {
  Server,
  HardDrive,
  AlertTriangle,
  Users,
  Mail,
  Building2,
  User,
  Crown,
  Shield,
  UserMinus,
  MoreHorizontal,
  Send,
  Clock,
  X,
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

// ─── Limit Card ──────────────────────────────────────────────────────────────

function LimitCard({
  icon: Icon,
  label,
  current,
  max,
}: {
  icon: ComponentType<{ className?: string }>;
  label: string;
  current: number;
  max: number;
}) {
  const unlimited = isUnlimitedLimit(max);
  const pct = !unlimited && max > 0 ? Math.round((current / max) * 100) : 0;
  const isAtLimit = !unlimited && current >= max;
  const isNearLimit = !unlimited && pct >= 80 && !isAtLimit;

  return (
    <div className="p-5 rounded-xl border bg-card space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Icon className="size-4" />
          {label}
        </div>
        {isAtLimit && (
          <div className="flex items-center gap-1 text-xs text-destructive font-medium">
            <AlertTriangle className="size-3" />
            At limit
          </div>
        )}
        {isNearLimit && (
          <div className="flex items-center gap-1 text-xs text-amber-500 font-medium">
            <AlertTriangle className="size-3" />
            Near limit
          </div>
        )}
      </div>
      <div className="flex items-baseline gap-1.5">
        <span className="text-3xl font-semibold tracking-tight">{current}</span>
        <span className="text-sm text-muted-foreground">/ {formatLimit(max)}</span>
      </div>
      {!unlimited && (
        <Progress
          value={pct}
          className={`h-2 ${isAtLimit ? "[&_div[data-slot=progress-indicator]]:bg-destructive" : isNearLimit ? "[&_div[data-slot=progress-indicator]]:bg-amber-500" : ""}`}
        />
      )}
    </div>
  );
}

// ─── Role Badge ──────────────────────────────────────────────────────────────

function RoleBadge({ role }: { role: string }) {
  if (role === "owner") {
    return (
      <Badge variant="outline" className="gap-0.5 text-amber-600 border-amber-200 dark:border-amber-800/40 dark:text-amber-400">
        <Crown className="size-2.5" />
        Owner
      </Badge>
    );
  }
  if (role === "admin") {
    return (
      <Badge variant="outline" className="gap-0.5 text-blue-600 border-blue-200 dark:border-blue-800/40 dark:text-blue-400">
        <Shield className="size-2.5" />
        Admin
      </Badge>
    );
  }
  return (
    <Badge variant="secondary" className="gap-0.5">
      <User className="size-2.5" />
      Member
    </Badge>
  );
}

// ─── General Tab ─────────────────────────────────────────────────────────────

function GeneralTab() {
  const { data: me, isLoading: meLoading } = useMe();
  const { data: account } = useAccount();
  const { data: limits, isLoading: limitsLoading } = useAccountLimits();
  const createOrganization = useCreateOrganization();
  const [orgDialogOpen, setOrgDialogOpen] = useState(false);
  const [orgName, setOrgName] = useState("");

  const email = me?.user.email || "user@example.com";
  const name = me?.user.name || email.split("@")[0];
  const initial = name[0]?.toUpperCase() || "U";
  const activeAccount = me?.active_account;

  function handleCreateOrg(e: React.FormEvent) {
    e.preventDefault();
    if (!orgName.trim()) return;
    createOrganization.mutate(orgName.trim(), {
      onSuccess: () => {
        toast.success("Organization created");
        setOrgDialogOpen(false);
        setOrgName("");
        window.location.reload();
      },
      onError: (error: Error) => toast.error(error.message),
    });
  }

  return (
    <div className="space-y-6">
      {/* Profile + Account */}
      <div className="grid gap-4 lg:grid-cols-2">
        {/* Profile */}
        <div className="p-5 rounded-xl border bg-card">
          <h2 className="text-sm font-medium text-muted-foreground mb-4">Profile</h2>
          {meLoading ? (
            <Skeleton className="h-14 w-full" />
          ) : (
            <div className="flex items-center gap-4">
              <Avatar className="size-12 rounded-lg">
                <AvatarFallback className="rounded-lg bg-primary/10 text-primary text-lg font-semibold">
                  {initial}
                </AvatarFallback>
              </Avatar>
              <div className="min-w-0">
                <div className="font-medium truncate">{name}</div>
                <div className="text-sm text-muted-foreground truncate">{email}</div>
              </div>
            </div>
          )}
        </div>

        {/* Active Account */}
        <div className="p-5 rounded-xl border bg-card">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-medium text-muted-foreground">Active Account</h2>
            <Button variant="outline" size="sm" onClick={() => setOrgDialogOpen(true)} className="h-7 gap-1.5 text-xs">
              <Building2 className="size-3" />
              New org
            </Button>
          </div>
          {meLoading ? (
            <Skeleton className="h-14 w-full" />
          ) : activeAccount ? (
            <div className="flex items-start gap-3">
              <div className="flex size-10 items-center justify-center rounded-lg bg-muted shrink-0">
                {activeAccount.type === "organization" ? (
                  <Building2 className="size-5 text-muted-foreground" />
                ) : (
                  <User className="size-5 text-muted-foreground" />
                )}
              </div>
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="font-medium truncate">{activeAccount.name}</span>
                  <RoleBadge role={activeAccount.role ?? "member"} />
                </div>
                <div className="text-sm text-muted-foreground mt-0.5">
                  {activeAccount.type === "personal" ? "Personal account" : "Organization"}
                  {activeAccount.slug && <span className="text-muted-foreground/60"> &middot; {activeAccount.slug}</span>}
                </div>
              </div>
            </div>
          ) : null}
          {account?.can_manage_billing === false && activeAccount?.type === "organization" && (
            <p className="text-xs text-muted-foreground mt-3 px-0.5">
              Billing and invite management are restricted to account owners and admins.
            </p>
          )}
        </div>
      </div>

      {/* Resource Limits */}
      <div>
        <h2 className="text-sm font-medium text-muted-foreground mb-3">Resource Limits</h2>
        {limitsLoading ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {[1, 2].map((i) => (
              <div key={i} className="p-5 rounded-xl border bg-card space-y-3">
                <Skeleton className="h-4 w-24" />
                <Skeleton className="h-8 w-20" />
                <Skeleton className="h-2 w-full" />
              </div>
            ))}
          </div>
        ) : limits ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <LimitCard icon={Server} label="Machines" current={limits.usage.machines} max={limits.limits.max_machines} />
            <LimitCard icon={HardDrive} label="Images" current={limits.usage.images} max={limits.limits.max_images} />
          </div>
        ) : null}
      </div>

      {/* Create Org Dialog */}
      <Dialog open={orgDialogOpen} onOpenChange={setOrgDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Create organization</DialogTitle>
            <DialogDescription>
              Organizations let you share machines, images, and billing with your team.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleCreateOrg}>
            <div className="space-y-2 py-2">
              <Label htmlFor="settings-org-name">Organization name</Label>
              <Input
                id="settings-org-name"
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
    </div>
  );
}

// ─── Members Tab ─────────────────────────────────────────────────────────────

function MembersTab() {
  const { data: account } = useAccount();
  const { data: me } = useMe();
  const queryClient = useQueryClient();
  const { data: members = [], isLoading } = useAccountMembers(!!account);
  const updateMemberRole = useUpdateMemberRole();
  const removeMember = useRemoveMember();

  const activeAccount = me?.active_account;
  const canManageMembers = account?.can_manage_members && activeAccount?.type === "organization";
  const isPersonalAccount = activeAccount?.type === "personal";

  if (isPersonalAccount) {
    return (
      <div className="rounded-xl border bg-card p-8 text-center">
        <div className="mx-auto flex size-12 items-center justify-center rounded-full bg-muted mb-4">
          <Users className="size-6 text-muted-foreground" />
        </div>
        <h3 className="font-medium">Personal account</h3>
        <p className="text-sm text-muted-foreground mt-1 max-w-sm mx-auto">
          Create an organization to collaborate with your team and manage members.
        </p>
      </div>
    );
  }

  function handleRoleChange(membershipId: string, currentRole: string) {
    const newRole = currentRole === "member" ? "admin" : "member";
    updateMemberRole.mutate({ membershipId, role: newRole as "owner" | "admin" | "member" }, {
      onSuccess: () => {
        toast.success(`Role updated to ${newRole}`);
        queryClient.invalidateQueries({ queryKey: ["account", "members"] });
      },
      onError: (error: Error) => toast.error(error.message),
    });
  }

  function handleRemoveMember(membershipId: string, memberName: string) {
    if (!confirm(`Remove ${memberName} from this organization?`)) return;
    removeMember.mutate(membershipId, {
      onSuccess: () => {
        toast.success("Member removed");
        queryClient.invalidateQueries({ queryKey: ["account", "members"] });
      },
      onError: (error: Error) => toast.error(error.message),
    });
  }

  return (
    <div className="rounded-xl border bg-card overflow-hidden">
      <div className="px-5 py-4 border-b">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="font-medium text-sm">Members</h3>
            <p className="text-xs text-muted-foreground mt-0.5">
              {members.length} {members.length === 1 ? "member" : "members"} in {activeAccount?.name}
            </p>
          </div>
        </div>
      </div>

      {isLoading ? (
        <div className="p-5 space-y-3">
          {[1, 2, 3].map((i) => <Skeleton key={i} className="h-14 w-full" />)}
        </div>
      ) : members.length === 0 ? (
        <div className="p-8 text-center">
          <p className="text-sm text-muted-foreground">No members yet.</p>
        </div>
      ) : (
        <div className="divide-y">
          {members.map((member) => (
            <div key={member.id} className="flex items-center gap-3 px-5 py-3 hover:bg-muted/30 transition-colors">
              <Avatar className="size-8 rounded-md shrink-0">
                <AvatarFallback className="rounded-md bg-primary/10 text-primary text-xs font-medium">
                  {(member.user.name || member.user.email)[0]?.toUpperCase() || "?"}
                </AvatarFallback>
              </Avatar>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium truncate">
                    {member.user.name || member.user.email.split("@")[0]}
                  </span>
                  <RoleBadge role={member.role} />
                  {member.user.id === me?.user.id && (
                    <span className="text-[10px] text-muted-foreground">(you)</span>
                  )}
                </div>
                <div className="text-xs text-muted-foreground truncate">{member.user.email}</div>
              </div>
              {canManageMembers && member.role !== "owner" && member.user.id !== me?.user.id && (
                <DropdownMenu>
                  <DropdownMenuTrigger className="flex size-7 items-center justify-center rounded-md hover:bg-muted shrink-0 outline-none">
                    <MoreHorizontal className="size-4 text-muted-foreground" />
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-44">
                    <DropdownMenuItem onClick={() => handleRoleChange(member.id, member.role)}>
                      <Shield className="size-4" />
                      {member.role === "member" ? "Make admin" : "Make member"}
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                      className="text-destructive focus:text-destructive"
                      onClick={() => handleRemoveMember(member.id, member.user.name || member.user.email)}
                    >
                      <UserMinus className="size-4" />
                      Remove member
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Invitations Tab ─────────────────────────────────────────────────────────

function InvitationsTab() {
  const { data: account } = useAccount();
  const { data: me } = useMe();
  const queryClient = useQueryClient();
  const { data: invitations = [], isLoading } = useAccountInvitations(!!account?.can_manage_members);
  const inviteMember = useInviteAccountMember();
  const revokeInvitation = useRevokeInvitation();

  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<"owner" | "admin" | "member">("member");

  const activeAccount = me?.active_account;
  const canManageMembers = account?.can_manage_members && activeAccount?.type === "organization";
  const isPersonalAccount = activeAccount?.type === "personal";

  if (isPersonalAccount) {
    return (
      <div className="rounded-xl border bg-card p-8 text-center">
        <div className="mx-auto flex size-12 items-center justify-center rounded-full bg-muted mb-4">
          <Mail className="size-6 text-muted-foreground" />
        </div>
        <h3 className="font-medium">Personal account</h3>
        <p className="text-sm text-muted-foreground mt-1 max-w-sm mx-auto">
          Create an organization to invite team members.
        </p>
      </div>
    );
  }

  async function onInviteSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!inviteEmail.trim()) return;
    const emailToSend = inviteEmail.trim();
    inviteMember.mutate({ email: emailToSend, role: inviteRole }, {
      onSuccess: async (data) => {
        // Optimistically append to cache so it appears instantly
        queryClient.setQueryData<AccountInvitation[]>(["account", "invitations"], (old) => [
          ...(old ?? []),
          { id: data.id, email: data.email, role: data.role as AccountInvitation["role"], expires_at: data.expires_at, created_at: new Date().toISOString() },
        ]);
        toast.success(`Invitation sent to ${emailToSend}`);
        setInviteEmail("");
        setInviteRole("member");
        // Also refetch in background to ensure consistency
        await queryClient.invalidateQueries({ queryKey: ["account", "invitations"] });
      },
      onError: (error: Error) => toast.error(error.message),
    });
  }

  function handleRevoke(invitationId: string, email: string) {
    // Optimistically remove from cache
    queryClient.setQueryData<AccountInvitation[]>(["account", "invitations"], (old) =>
      (old ?? []).filter((inv) => inv.id !== invitationId),
    );
    revokeInvitation.mutate(invitationId, {
      onSuccess: async () => {
        toast.success(`Invitation to ${email} revoked`);
        await queryClient.invalidateQueries({ queryKey: ["account", "invitations"] });
      },
      onError: (error: Error) => {
        toast.error(error.message);
        // Revert optimistic update
        queryClient.invalidateQueries({ queryKey: ["account", "invitations"] });
      },
    });
  }

  return (
    <div className="space-y-4">
      {/* Invite Form */}
      {canManageMembers && (
        <div className="rounded-xl border bg-card p-5">
          <h3 className="font-medium text-sm mb-3">Invite a team member</h3>
          <form onSubmit={onInviteSubmit} className="flex flex-col sm:flex-row gap-3">
            <div className="flex-1">
              <Input
                type="email"
                value={inviteEmail}
                onChange={(e) => setInviteEmail(e.target.value)}
                placeholder="teammate@company.com"
                required
                className="h-9"
              />
            </div>
            <select
              className="flex h-9 rounded-md border bg-background px-3 py-1 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              value={inviteRole}
              onChange={(e) => setInviteRole(e.target.value as "owner" | "admin" | "member")}
            >
              <option value="member">Member</option>
              <option value="admin">Admin</option>
              <option value="owner">Owner</option>
            </select>
            <Button type="submit" size="sm" className="h-9 gap-1.5" disabled={inviteMember.isPending}>
              <Send className="size-3.5" />
              {inviteMember.isPending ? "Sending..." : "Send invite"}
            </Button>
          </form>
        </div>
      )}

      {/* Pending Invitations */}
      <div className="rounded-xl border bg-card overflow-hidden">
        <div className="px-5 py-4 border-b">
          <h3 className="font-medium text-sm">Pending invitations</h3>
          <p className="text-xs text-muted-foreground mt-0.5">
            {invitations.length} pending {invitations.length === 1 ? "invitation" : "invitations"}
          </p>
        </div>

        {isLoading ? (
          <div className="p-5 space-y-3">
            {[1, 2].map((i) => <Skeleton key={i} className="h-14 w-full" />)}
          </div>
        ) : invitations.length === 0 ? (
          <div className="p-8 text-center">
            <div className="mx-auto flex size-10 items-center justify-center rounded-full bg-muted mb-3">
              <Mail className="size-5 text-muted-foreground" />
            </div>
            <p className="text-sm text-muted-foreground">No pending invitations.</p>
          </div>
        ) : (
          <div className="divide-y">
            {invitations.map((invite) => (
              <div key={invite.id} className="flex items-center gap-3 px-5 py-3 hover:bg-muted/30 transition-colors">
                <div className="flex size-8 items-center justify-center rounded-md bg-muted shrink-0">
                  <Mail className="size-4 text-muted-foreground" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium truncate">{invite.email}</span>
                    <RoleBadge role={invite.role} />
                  </div>
                  <div className="flex items-center gap-1 text-xs text-muted-foreground mt-0.5">
                    <Clock className="size-3" />
                    Expires {new Date(invite.expires_at).toLocaleDateString()}
                  </div>
                </div>
                {canManageMembers && (
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    className="shrink-0 text-muted-foreground hover:text-destructive"
                    onClick={() => handleRevoke(invite.id, invite.email)}
                    disabled={revokeInvitation.isPending}
                  >
                    <X className="size-4" />
                  </Button>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Settings Page ───────────────────────────────────────────────────────────

export default function SettingsPage() {
  const { data: me } = useMe();
  const activeAccount = me?.active_account;
  const isOrg = activeAccount?.type === "organization";

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-heading text-3xl tracking-tight">Settings</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Manage your profile, account, and team settings.
        </p>
      </div>

      <Tabs defaultValue={0}>
        <TabsList variant="line">
          <TabsTrigger value={0}>General</TabsTrigger>
          <TabsTrigger value={1}>
            <Users className="size-3.5" />
            Members
            {isOrg && (
              <Badge variant="secondary" className="ml-1 h-4 px-1 text-[10px] leading-none">
                {activeAccount?.slug ? "org" : ""}
              </Badge>
            )}
          </TabsTrigger>
          <TabsTrigger value={2}>
            <Mail className="size-3.5" />
            Invitations
          </TabsTrigger>
        </TabsList>

        <TabsContent value={0}>
          <GeneralTab />
        </TabsContent>
        <TabsContent value={1}>
          <MembersTab />
        </TabsContent>
        <TabsContent value={2}>
          <InvitationsTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}
