"use client";

import { useState } from "react";
import { Button, buttonVariants } from "@/shared/ui/button";
import { cn, timeAgo, relativeTime } from "@/shared/lib/utils";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/shared/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/shared/ui/dialog";
import { Input } from "@/shared/ui/input";
import { Label } from "@/shared/ui/label";
import { Textarea } from "@/shared/ui/textarea";
import { Skeleton } from "@/shared/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/shared/ui/select";
import { toast } from "sonner";
import { useSSHKeys, useCreateSSHKey, useDeleteSSHKey } from "@/v1/hooks/use-ssh-keys";
import { useAPIKeys, useCreateAPIKey, useDeleteAPIKey } from "@/v1/hooks/use-api-keys";
import { useMachines } from "@/v1/hooks/use-machines";
import { useConfirm } from "@/shared/hooks/use-confirm";
import { ProxyTokenManager } from "@/shared/components/dashboard/proxy-token-manager";
import type { ApiKeyPermission } from "@/shared/lib/types";
import { Plus, Trash2, Copy, Check, Key, KeyRound, Loader2, Clock, ShieldCheck, Globe, Server, AlertTriangle, Share2 } from "lucide-react";

const API_KEY_EXPIRY_OPTIONS = [
  { label: "Never expires", value: "never" },
  { label: "30 days", value: String(60 * 60 * 24 * 30) },
  { label: "90 days", value: String(60 * 60 * 24 * 90) },
  { label: "1 year", value: String(60 * 60 * 24 * 365) },
] as const;

const API_KEY_PERMISSIONS: Array<{ value: Exclude<ApiKeyPermission, "*">; label: string; description: string }> = [
  { value: "read", label: "Read", description: "List and inspect machines, images, keys, account info" },
  { value: "write", label: "Write", description: "Create and update machines, files, and settings" },
  { value: "delete", label: "Delete", description: "Destroy machines, keys, images, and webhooks" },
  { value: "exec", label: "Execute", description: "Run commands, code, and agent workflows" },
  { value: "proxy", label: "Proxy", description: "Access proxied machine services and shared links" },
];

export default function KeysPage() {
  return (
    <div className="space-y-6">
      <h1 className="font-heading text-3xl tracking-tight">Keys</h1>

      <Tabs defaultValue="api" className="space-y-6">
        <TabsList>
          <TabsTrigger value="api">API Keys</TabsTrigger>
          <TabsTrigger value="proxy">Proxy Tokens</TabsTrigger>
          <TabsTrigger value="ssh">SSH Keys</TabsTrigger>
        </TabsList>

        <TabsContent value="api">
          <APIKeysSection />
        </TabsContent>

        <TabsContent value="proxy">
          <ProxyTokensSection />
        </TabsContent>

        <TabsContent value="ssh">
          <SSHKeysSection />
        </TabsContent>
      </Tabs>
    </div>
  );
}

// ─── SSH Keys ────────────────────────────────────────────────────────────────

function SSHKeysSection() {
  const { data: sshKeys, isLoading } = useSSHKeys();
  const createSSHKey = useCreateSSHKey();
  const deleteSSHKey = useDeleteSSHKey();
  const [confirm, ConfirmDialog] = useConfirm();
  const [sshKeyName, setSSHKeyName] = useState("");
  const [sshKeyContent, setSSHKeyContent] = useState("");
  const [dialogOpen, setDialogOpen] = useState(false);

  const handleCreate = () => {
    if (!sshKeyName || !sshKeyContent) { toast.error("Provide both name and public key"); return; }
    createSSHKey.mutate(
      { name: sshKeyName, public_key: sshKeyContent },
      {
        onSuccess: () => { setSSHKeyName(""); setSSHKeyContent(""); setDialogOpen(false); toast.success("SSH key added"); },
        onError: (err) => toast.error(err.message),
      },
    );
  };

  const handleDelete = async (id: string, name: string) => {
    const ok = await confirm({
      title: "Delete SSH Key",
      description: `Delete "${name}"? This will remove it from all providers. This cannot be undone.`,
      confirmLabel: "Delete Key",
      variant: "destructive",
      icon: <Trash2 className="size-4 text-destructive" />,
    });
    if (!ok) return;
    deleteSSHKey.mutate(id, {
      onSuccess: () => toast.success("SSH key deleted"),
      onError: (err) => toast.error(err.message),
    });
  };

  return (
    <>
      <div className="flex items-center justify-between mb-4">
        <p className="text-sm text-muted-foreground">SSH keys for secure access to your machines.</p>
        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogTrigger className={cn(buttonVariants())}>
            <Plus className="size-4" />
            Add SSH Key
          </DialogTrigger>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>Add SSH Key</DialogTitle>
              <DialogDescription>Paste your public key to enable SSH access to machines.</DialogDescription>
            </DialogHeader>
            <div className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="ssh-name">Name</Label>
                <Input id="ssh-name" placeholder="My Laptop" value={sshKeyName} onChange={(e) => setSSHKeyName(e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="ssh-key">Public Key</Label>
                <Textarea id="ssh-key" placeholder="ssh-ed25519 AAAA..." value={sshKeyContent} onChange={(e) => setSSHKeyContent(e.target.value)} rows={3} className="font-mono text-xs" />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setDialogOpen(false)}>Cancel</Button>
              <Button onClick={handleCreate} disabled={createSSHKey.isPending || !sshKeyName || !sshKeyContent}>
                {createSSHKey.isPending ? <><Loader2 className="size-4 animate-spin" />Adding...</> : "Add Key"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      {isLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 2 }).map((_, i) => (
            <div key={i} className="p-4 rounded-xl border bg-card space-y-2">
              <Skeleton className="h-4 w-28" />
              <Skeleton className="h-3 w-48" />
            </div>
          ))}
        </div>
      ) : sshKeys?.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16">
          <div className="rounded-2xl bg-muted p-5 mb-6">
            <KeyRound className="size-10 text-muted-foreground/50" strokeWidth={1.5} />
          </div>
          <h2 className="font-heading text-xl mb-1.5">No SSH keys configured</h2>
          <p className="text-sm text-muted-foreground text-center max-w-xs">
            Add an SSH key to enable secure access to your machines.
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {sshKeys?.map((key) => (
            <div key={key.id} className="group flex items-center justify-between p-4 rounded-xl border bg-card transition-colors hover:bg-muted/40">
              <div className="flex items-center gap-3 min-w-0">
                <KeyRound className="size-4 text-muted-foreground shrink-0" />
                <div className="min-w-0">
                  <div className="text-sm font-medium">{key.name}</div>
                  <div className="text-xs text-muted-foreground font-mono truncate">{key.fingerprint}</div>
                </div>
              </div>
              <div className="flex items-center gap-3 shrink-0">
                <span className="text-xs text-muted-foreground hidden sm:block">{timeAgo(key.created_at)}</span>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  className="opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-destructive"
                  onClick={() => handleDelete(key.id, key.name)}
                >
                  <Trash2 className="size-3.5" />
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}

      <ConfirmDialog />
    </>
  );
}

// ─── API Keys ────────────────────────────────────────────────────────────────

function APIKeysSection() {
  const { data: apiKeys, isLoading } = useAPIKeys();
  const { data: machines } = useMachines();
  const createAPIKey = useCreateAPIKey();
  const deleteAPIKey = useDeleteAPIKey();
  const [confirm, ConfirmDialog] = useConfirm();
  const [apiKeyName, setAPIKeyName] = useState("");
  const [apiKeyScope, setAPIKeyScope] = useState<"account" | "machine">("account");
  const [selectedMachineIds, setSelectedMachineIds] = useState<string[]>([]);
  const [fullAccess, setFullAccess] = useState(true);
  const [selectedPermissions, setSelectedPermissions] = useState<ApiKeyPermission[]>([]);
  const [expiryPreset, setExpiryPreset] = useState<string>("never");
  const [newAPIKey, setNewAPIKey] = useState<string | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    if (!newAPIKey) return;
    navigator.clipboard.writeText(newAPIKey);
    setCopied(true);
    toast.success("API key copied to clipboard");
    setTimeout(() => setCopied(false), 2000);
  };

  const togglePermission = (permission: Exclude<ApiKeyPermission, "*">) => {
    setSelectedPermissions((current) => current.includes(permission)
      ? current.filter((p) => p !== permission)
      : [...current, permission]);
  };

  const resetForm = () => {
    setAPIKeyName("");
    setAPIKeyScope("account");
    setSelectedMachineIds([]);
    setFullAccess(true);
    setSelectedPermissions([]);
    setExpiryPreset("never");
  };

  const handleCreate = () => {
    if (!apiKeyName) { toast.error("Provide a name"); return; }
    if (apiKeyScope === "machine" && selectedMachineIds.length === 0) {
      toast.error("Select at least one machine for a machine-scoped key");
      return;
    }
    const permissions = fullAccess ? ["*"] as ApiKeyPermission[] : selectedPermissions;
    if (!fullAccess && permissions.length === 0) {
      toast.error("Select at least one permission, or use full access");
      return;
    }
    createAPIKey.mutate({
      name: apiKeyName,
      scope: apiKeyScope,
      machine_ids: apiKeyScope === "machine" ? selectedMachineIds : undefined,
      permissions,
      expires_in_seconds: expiryPreset === "never" ? null : Number(expiryPreset),
    }, {
      onSuccess: (key) => {
        setNewAPIKey(key.key ?? null);
        resetForm();
        setDialogOpen(false);
        toast.success("API key created");
      },
      onError: (err) => toast.error(err.message),
    });
  };

  const handleDelete = async (id: string, name: string) => {
    const ok = await confirm({
      title: "Delete API Key",
      description: `Delete "${name}"? This will break any integrations using this key. This cannot be undone.`,
      confirmLabel: "Delete Key",
      variant: "destructive",
      icon: <Trash2 className="size-4 text-destructive" />,
    });
    if (!ok) return;
    deleteAPIKey.mutate(id, {
      onSuccess: () => toast.success("API key deleted"),
      onError: (err) => toast.error(err.message),
    });
  };

  return (
    <>
      {/* New key banner */}
      {newAPIKey && (
        <div className="mb-6 rounded-xl border border-emerald-500/20 bg-emerald-500/5 overflow-hidden">
          <div className="flex items-center gap-2.5 px-4 py-3 border-b border-emerald-500/15">
            <ShieldCheck className="size-4 text-emerald-500 shrink-0" />
            <span className="text-sm font-medium text-emerald-600 dark:text-emerald-400">API Key Created</span>
            <span className="ml-auto text-xs text-muted-foreground">Save it now — it won&apos;t be shown again</span>
          </div>
          <div className="p-4">
            <button
              onClick={handleCopy}
              className="w-full flex items-center justify-between gap-3 px-4 py-3 rounded-lg bg-background/60 border border-border/60 hover:bg-muted/60 hover:border-border transition-all cursor-pointer group"
            >
              <span className="font-mono text-sm text-foreground truncate">{newAPIKey}</span>
              <span className="shrink-0 flex items-center gap-1.5 text-xs text-muted-foreground group-hover:text-foreground transition-colors">
                {copied ? (
                  <><Check className="size-3.5 text-emerald-500" /><span className="text-emerald-500">Copied</span></>
                ) : (
                  <><Copy className="size-3.5" />Copy</>
                )}
              </span>
            </button>
            <button
              onClick={() => { setNewAPIKey(null); setCopied(false); }}
              className="mt-3 text-xs text-muted-foreground hover:text-foreground transition-colors"
            >
              Dismiss
            </button>
          </div>
        </div>
      )}

      <div className="flex items-center justify-between mb-4">
        <p className="text-sm text-muted-foreground">API keys for programmatic access to JustAVPS.</p>
        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogTrigger className={cn(buttonVariants())}>
            <Plus className="size-4" />
            Create API Key
          </DialogTrigger>
          <DialogContent className="sm:max-w-xl">
            <DialogHeader>
              <DialogTitle>Create API Key</DialogTitle>
              <DialogDescription>Choose what this key can access, what it can do, and when it expires.</DialogDescription>
            </DialogHeader>
            <div className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="api-name">Name</Label>
                <Input id="api-name" placeholder="CI/CD Pipeline" value={apiKeyName} onChange={(e) => setAPIKeyName(e.target.value)} />
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label>Scope</Label>
                  <Select value={apiKeyScope} onValueChange={(value) => setAPIKeyScope((value as "account" | "machine") ?? "account")}>
                    <SelectTrigger className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="account">Full account access</SelectItem>
                      <SelectItem value="machine">Specific machines only</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Expiration</Label>
                  <Select value={expiryPreset} onValueChange={(value) => setExpiryPreset(value ?? "never")}>
                    <SelectTrigger className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {API_KEY_EXPIRY_OPTIONS.map((option) => (
                        <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              {apiKeyScope === "machine" && (
                <div className="space-y-2">
                  <Label>Allowed Machines</Label>
                  <div className="rounded-lg border max-h-44 overflow-y-auto divide-y">
                    {(machines ?? []).length === 0 ? (
                      <div className="px-3 py-4 text-sm text-muted-foreground">No machines available.</div>
                    ) : (machines ?? []).map((machine) => {
                      const checked = selectedMachineIds.includes(machine.id);
                      return (
                        <label key={machine.id} className="flex items-start gap-3 px-3 py-3 cursor-pointer hover:bg-muted/40">
                          <input
                            type="checkbox"
                            className="mt-0.5"
                            checked={checked}
                            onChange={() => setSelectedMachineIds((current) => checked ? current.filter((id) => id !== machine.id) : [...current, machine.id])}
                          />
                          <div className="min-w-0">
                            <div className="text-sm font-medium">{machine.name}</div>
                            <div className="text-xs text-muted-foreground font-mono">{machine.slug}</div>
                          </div>
                        </label>
                      );
                    })}
                  </div>
                </div>
              )}

              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <Label>Permissions</Label>
                  <label className="flex items-center gap-2 text-sm text-muted-foreground cursor-pointer">
                    <input type="checkbox" checked={fullAccess} onChange={(e) => setFullAccess(e.target.checked)} />
                    Full access
                  </label>
                </div>
                <div className={cn("grid gap-2 sm:grid-cols-2", fullAccess && "opacity-50 pointer-events-none")}>
                  {API_KEY_PERMISSIONS.map((permission) => {
                    const checked = selectedPermissions.includes(permission.value);
                    return (
                      <label key={permission.value} className="flex items-start gap-3 rounded-lg border px-3 py-3 cursor-pointer hover:bg-muted/40">
                        <input type="checkbox" className="mt-0.5" checked={checked} onChange={() => togglePermission(permission.value)} />
                        <div>
                          <div className="text-sm font-medium">{permission.label}</div>
                          <div className="text-xs text-muted-foreground">{permission.description}</div>
                        </div>
                      </label>
                    );
                  })}
                </div>
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setDialogOpen(false)}>Cancel</Button>
              <Button onClick={handleCreate} disabled={createAPIKey.isPending || !apiKeyName}>
                {createAPIKey.isPending ? <><Loader2 className="size-4 animate-spin" />Creating...</> : "Create Key"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      {isLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 2 }).map((_, i) => (
            <div key={i} className="p-4 rounded-xl border bg-card space-y-2">
              <Skeleton className="h-4 w-28" />
              <Skeleton className="h-3 w-48" />
            </div>
          ))}
        </div>
      ) : apiKeys?.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16">
          <div className="rounded-2xl bg-muted p-5 mb-6">
            <Key className="size-10 text-muted-foreground/50" strokeWidth={1.5} />
          </div>
          <h2 className="font-heading text-xl mb-1.5">No API keys created</h2>
          <p className="text-sm text-muted-foreground text-center max-w-xs">
            Create an API key for programmatic access to JustAVPS.
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {apiKeys?.map((key) => (
            <div key={key.id} className="group flex items-center justify-between p-4 rounded-xl border bg-card transition-colors hover:bg-muted/40">
              <div className="flex items-center gap-3 min-w-0">
                <Key className="size-4 text-muted-foreground shrink-0" />
                <div className="min-w-0">
                  <div className="text-sm font-medium">{key.name}</div>
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <span className="font-mono">{key.key_prefix}...</span>
                    <span>&middot;</span>
                    <span>{timeAgo(key.created_at)}</span>
                    {key.scope === "machine" && (
                      <>
                        <span>&middot;</span>
                        <span className="flex items-center gap-1 text-blue-500 dark:text-blue-400">
                          <Server className="size-3" />
                          {key.machine_ids?.length ?? 0} machine{(key.machine_ids?.length ?? 0) !== 1 ? "s" : ""}
                        </span>
                      </>
                    )}
                    {key.scope === "account" && (
                      <>
                        <span>&middot;</span>
                        <span className="flex items-center gap-1">
                          <Globe className="size-3" />Account
                        </span>
                      </>
                    )}
                    {key.permissions && !key.permissions.includes("*") && (
                      <>
                        <span>&middot;</span>
                        <span>{key.permissions.join(", ")}</span>
                      </>
                    )}
                    {key.expires_at && (
                      <>
                        <span>&middot;</span>
                        {new Date(key.expires_at) < new Date() ? (
                          <span className="flex items-center gap-1 text-destructive">
                            <AlertTriangle className="size-3" />Expired
                          </span>
                        ) : (
                          <span className="flex items-center gap-1">
                            <Clock className="size-3" />Expires {relativeTime(key.expires_at)}
                          </span>
                        )}
                      </>
                    )}
                    {key.last_used && (
                      <>
                        <span>&middot;</span>
                        <span className="flex items-center gap-1"><Clock className="size-3" />Used {timeAgo(key.last_used)}</span>
                      </>
                    )}
                  </div>
                </div>
              </div>
              <Button
                variant="ghost"
                size="icon-sm"
                className="shrink-0 opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-destructive"
                onClick={() => handleDelete(key.id, key.name)}
              >
                <Trash2 className="size-3.5" />
              </Button>
            </div>
          ))}
        </div>
      )}

      <ConfirmDialog />
    </>
  );
}

function ProxyTokensSection() {
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Share2 className="size-4" />
        Share temporary machine access without creating a user account.
      </div>
      <ProxyTokenManager />
    </div>
  );
}
