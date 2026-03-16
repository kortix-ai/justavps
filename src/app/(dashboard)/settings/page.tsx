"use client";

import { useState } from "react";
import { Button, buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";
import { useSSHKeys, useCreateSSHKey, useDeleteSSHKey } from "@/hooks/use-ssh-keys";
import { useAPIKeys, useCreateAPIKey, useDeleteAPIKey } from "@/hooks/use-api-keys";
import { useUsage, useBillingPortal } from "@/hooks/use-account";
import { Plus, Trash2, Copy, ExternalLink, Key, KeyRound } from "lucide-react";

// ─── Billing Tab ─────────────────────────────────────────────────────────────

function BillingTab() {
  const { data: usage } = useUsage();
  const { data: billing, isLoading: billingLoading } = useBillingPortal();

  const totalMachines = usage?.current_period?.total_machines ?? 0;
  const estimatedCost = usage?.current_period?.estimated_cost ?? 0;

  return (
    <Card className="shadow-none">
      <CardHeader>
        <CardTitle className="text-sm font-medium">Billing & Usage</CardTitle>
        <CardDescription className="text-xs">Manage your subscription and billing</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex justify-between items-center p-3 border rounded-lg">
          <div>
            <h3 className="text-sm font-medium">Active Machines</h3>
            <p className="text-xs text-muted-foreground">{totalMachines} machine{totalMachines !== 1 ? "s" : ""} running</p>
          </div>
          <Badge variant="secondary" className="text-[10px]">{totalMachines > 0 ? "Active" : "None"}</Badge>
        </div>

        <div className="flex justify-between items-center p-3 border rounded-lg">
          <div>
            <h3 className="text-sm font-medium">Estimated Monthly Cost</h3>
            <p className="text-xs text-muted-foreground">Based on current machines</p>
          </div>
          <div className="text-right">
            <div className="font-mono text-lg font-semibold">${estimatedCost}</div>
            <div className="text-[10px] text-muted-foreground">/month</div>
          </div>
        </div>

        {usage?.current_period?.machines?.length ? (
          <div className="p-3 border rounded-lg">
            <h3 className="text-sm font-medium mb-2">Breakdown</h3>
            <div className="space-y-1.5">
              {usage.current_period.machines.map((m) => (
                <div key={m.id} className="flex justify-between text-xs">
                  <span className="text-muted-foreground font-mono">{m.slug} ({m.server_type})</span>
                  <Badge variant={m.status === "ready" ? "default" : "secondary"} className="text-[10px] px-1.5 py-0">{m.status}</Badge>
                </div>
              ))}
            </div>
          </div>
        ) : null}

        <div className="pt-2">
          {billing?.portal_url ? (
            <a href={billing.portal_url} target="_blank" rel="noopener noreferrer">
              <Button size="sm" className="w-full">
                <ExternalLink className="mr-2 size-3.5" />
                Manage Billing in Stripe
              </Button>
            </a>
          ) : (
            <Button size="sm" className="w-full" disabled={billingLoading}>
              {billingLoading ? "Loading..." : "Create a machine to start billing"}
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

// ─── SSH Keys Tab ────────────────────────────────────────────────────────────

function SSHKeysTab() {
  const { data: sshKeys, isLoading } = useSSHKeys();
  const createSSHKey = useCreateSSHKey();
  const deleteSSHKey = useDeleteSSHKey();
  const [sshKeyName, setSSHKeyName] = useState("");
  const [sshKeyContent, setSSHKeyContent] = useState("");

  const handleCreate = () => {
    if (!sshKeyName || !sshKeyContent) { toast.error("Provide both name and public key"); return; }
    createSSHKey.mutate(
      { name: sshKeyName, public_key: sshKeyContent },
      {
        onSuccess: () => { setSSHKeyName(""); setSSHKeyContent(""); toast.success("SSH key added"); },
        onError: (err) => toast.error(err.message),
      },
    );
  };

  return (
    <Card className="shadow-none">
      <CardHeader>
        <CardTitle className="text-sm font-medium">SSH Keys</CardTitle>
        <CardDescription className="text-xs">Manage SSH keys for secure access to your machines</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="space-y-2">
          {isLoading ? (
            Array.from({ length: 2 }).map((_, i) => (
              <div key={i} className="flex justify-between items-center p-3 border rounded-lg">
                <div className="space-y-1"><Skeleton className="h-4 w-28" /><Skeleton className="h-3 w-40" /></div>
                <Skeleton className="h-7 w-7" />
              </div>
            ))
          ) : sshKeys?.length === 0 ? (
            <div className="text-center py-6">
              <KeyRound className="mx-auto size-8 text-muted-foreground/50 mb-2" />
              <p className="text-sm text-muted-foreground">No SSH keys configured</p>
            </div>
          ) : (
            sshKeys?.map((key) => (
              <div key={key.id} className="flex justify-between items-center p-3 border rounded-lg">
                <div>
                  <h3 className="text-sm font-medium">{key.name}</h3>
                  <p className="text-xs text-muted-foreground font-mono">
                    {key.fingerprint}
                    <span className="font-sans"> &middot; {new Date(key.created_at).toLocaleDateString()}</span>
                  </p>
                </div>
                <Dialog>
                  <DialogTrigger render={<Button variant="ghost" size="sm" className="h-7 w-7 p-0 text-destructive hover:text-destructive" />}>
                    <Trash2 className="size-3.5" />
                  </DialogTrigger>
                  <DialogContent>
                    <DialogHeader>
                      <DialogTitle>Delete SSH Key</DialogTitle>
                      <DialogDescription>Delete &quot;{key.name}&quot;? This cannot be undone.</DialogDescription>
                    </DialogHeader>
                    <DialogFooter>
                      <Button variant="outline" size="sm">Cancel</Button>
                      <Button variant="destructive" size="sm" onClick={() => deleteSSHKey.mutate(key.id, { onSuccess: () => toast.success("Deleted"), onError: (err) => toast.error(err.message) })} disabled={deleteSSHKey.isPending}>
                        Delete
                      </Button>
                    </DialogFooter>
                  </DialogContent>
                </Dialog>
              </div>
            ))
          )}

          <div className="pt-3 border-t">
            <Dialog>
              <DialogTrigger render={<Button variant="outline" size="sm" />}>
                <Plus className="mr-2 size-3.5" />
                Add SSH Key
              </DialogTrigger>
              <DialogContent className="sm:max-w-md">
                <DialogHeader>
                  <DialogTitle>Add SSH Key</DialogTitle>
                </DialogHeader>
                <div className="space-y-4">
                  <div>
                    <Label htmlFor="ssh-name" className="text-xs">Name</Label>
                    <Input id="ssh-name" placeholder="My Laptop" value={sshKeyName} onChange={(e) => setSSHKeyName(e.target.value)} />
                  </div>
                  <div>
                    <Label htmlFor="ssh-key" className="text-xs">Public Key</Label>
                    <Textarea id="ssh-key" placeholder="ssh-ed25519 AAAA..." value={sshKeyContent} onChange={(e) => setSSHKeyContent(e.target.value)} rows={3} className="font-mono text-xs" />
                  </div>
                </div>
                <DialogFooter>
                  <Button size="sm" onClick={handleCreate} disabled={createSSHKey.isPending}>
                    {createSSHKey.isPending ? "Adding..." : "Add Key"}
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

// ─── API Keys Tab ────────────────────────────────────────────────────────────

function APIKeysTab() {
  const { data: apiKeys, isLoading } = useAPIKeys();
  const createAPIKey = useCreateAPIKey();
  const deleteAPIKey = useDeleteAPIKey();
  const [apiKeyName, setAPIKeyName] = useState("");
  const [newAPIKey, setNewAPIKey] = useState<string | null>(null);

  const handleCreate = () => {
    if (!apiKeyName) { toast.error("Provide a name"); return; }
    createAPIKey.mutate(apiKeyName, {
      onSuccess: (key) => { setNewAPIKey(key.key ?? null); setAPIKeyName(""); toast.success("API key created"); },
      onError: (err) => toast.error(err.message),
    });
  };

  return (
    <>
      <Card className="shadow-none">
        <CardHeader>
          <CardTitle className="text-sm font-medium">API Keys</CardTitle>
          <CardDescription className="text-xs">Create and manage API keys for programmatic access</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-2">
            {isLoading ? (
              Array.from({ length: 2 }).map((_, i) => (
                <div key={i} className="flex justify-between items-center p-3 border rounded-lg">
                  <div className="space-y-1"><Skeleton className="h-4 w-28" /><Skeleton className="h-3 w-40" /></div>
                  <Skeleton className="h-7 w-7" />
                </div>
              ))
            ) : apiKeys?.length === 0 ? (
              <div className="text-center py-6">
                <Key className="mx-auto size-8 text-muted-foreground/50 mb-2" />
                <p className="text-sm text-muted-foreground">No API keys created</p>
              </div>
            ) : (
              apiKeys?.map((key) => (
                <div key={key.id} className="flex justify-between items-center p-3 border rounded-lg">
                  <div>
                    <h3 className="text-sm font-medium">{key.name}</h3>
                    <p className="text-xs text-muted-foreground">
                      <span className="font-mono">{key.key_prefix}...</span>
                      <span> &middot; {new Date(key.created_at).toLocaleDateString()}</span>
                      {key.last_used && (<span> &middot; Used {new Date(key.last_used).toLocaleDateString()}</span>)}
                    </p>
                  </div>
                  <Dialog>
                    <DialogTrigger render={<Button variant="ghost" size="sm" className="h-7 w-7 p-0 text-destructive hover:text-destructive" />}>
                      <Trash2 className="size-3.5" />
                    </DialogTrigger>
                    <DialogContent>
                      <DialogHeader>
                        <DialogTitle>Delete API Key</DialogTitle>
                        <DialogDescription>Delete &quot;{key.name}&quot;? This will break any integrations using this key.</DialogDescription>
                      </DialogHeader>
                      <DialogFooter>
                        <Button variant="outline" size="sm">Cancel</Button>
                        <Button variant="destructive" size="sm" onClick={() => deleteAPIKey.mutate(key.id, { onSuccess: () => toast.success("Deleted"), onError: (err) => toast.error(err.message) })} disabled={deleteAPIKey.isPending}>
                          Delete
                        </Button>
                      </DialogFooter>
                    </DialogContent>
                  </Dialog>
                </div>
              ))
            )}

            <div className="pt-3 border-t">
              <Dialog>
                <DialogTrigger render={<Button variant="outline" size="sm" />}>
                  <Plus className="mr-2 size-3.5" />
                  Create API Key
                </DialogTrigger>
                <DialogContent className="sm:max-w-md">
                  <DialogHeader>
                    <DialogTitle>Create API Key</DialogTitle>
                  </DialogHeader>
                  <div>
                    <Label htmlFor="api-name" className="text-xs">Name</Label>
                    <Input id="api-name" placeholder="CI/CD Pipeline" value={apiKeyName} onChange={(e) => setAPIKeyName(e.target.value)} />
                  </div>
                  <DialogFooter>
                    <Button size="sm" onClick={handleCreate} disabled={createAPIKey.isPending}>
                      {createAPIKey.isPending ? "Creating..." : "Create Key"}
                    </Button>
                  </DialogFooter>
                </DialogContent>
              </Dialog>
            </div>
          </div>
        </CardContent>
      </Card>

      {newAPIKey && (
        <Card className="border-green-500/30 shadow-none">
          <CardHeader>
            <CardTitle className="text-sm font-medium text-green-500">API Key Created</CardTitle>
            <CardDescription className="text-xs">Save this key now &mdash; you won&apos;t see it again</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex items-center gap-2">
              <Input value={newAPIKey} readOnly className="font-mono text-xs" />
              <Button size="sm" variant="outline" onClick={() => { navigator.clipboard.writeText(newAPIKey); toast.success("Copied"); }}>
                <Copy className="size-3.5" />
              </Button>
            </div>
            <Button variant="outline" size="sm" className="mt-3 w-full" onClick={() => setNewAPIKey(null)}>
              I&apos;ve saved this key
            </Button>
          </CardContent>
        </Card>
      )}
    </>
  );
}

// ─── Main Page ───────────────────────────────────────────────────────────────

export default function SettingsPage() {
  return (
    <div className="space-y-6">
      <h1 className="font-heading text-3xl tracking-tight">Settings</h1>

      <Tabs defaultValue="ssh-keys" className="space-y-4">
        <TabsList>
          <TabsTrigger value="ssh-keys">SSH Keys</TabsTrigger>
          <TabsTrigger value="api-keys">API Keys</TabsTrigger>
          <TabsTrigger value="billing">Billing</TabsTrigger>
        </TabsList>

        <TabsContent value="ssh-keys" className="space-y-4">
          <SSHKeysTab />
        </TabsContent>

        <TabsContent value="api-keys" className="space-y-4">
          <APIKeysTab />
        </TabsContent>

        <TabsContent value="billing" className="space-y-4">
          <BillingTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}
