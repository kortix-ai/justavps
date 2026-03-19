"use client";

import { useState } from "react";
import { Button, buttonVariants } from "@/components/ui/button";
import { cn, timeAgo } from "@/lib/utils";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";
import { useSSHKeys, useCreateSSHKey, useDeleteSSHKey } from "@/hooks/use-ssh-keys";
import { useAPIKeys, useCreateAPIKey, useDeleteAPIKey } from "@/hooks/use-api-keys";
import { useConfirm } from "@/hooks/use-confirm";
import { Plus, Trash2, Copy, Check, Key, KeyRound, Loader2, Clock, ShieldCheck } from "lucide-react";

export default function KeysPage() {
  return (
    <div className="space-y-6">
      <h1 className="font-heading text-3xl tracking-tight">Keys</h1>

      <Tabs defaultValue="api" className="space-y-6">
        <TabsList>
          <TabsTrigger value="api">API Keys</TabsTrigger>
          <TabsTrigger value="ssh">SSH Keys</TabsTrigger>
        </TabsList>

        <TabsContent value="api">
          <APIKeysSection />
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
            <Plus className="mr-2 size-4" />
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
              <Button onClick={handleCreate} disabled={createSSHKey.isPending || !sshKeyName || !sshKeyContent}>
                {createSSHKey.isPending ? <><Loader2 className="size-4 animate-spin mr-2" />Adding...</> : "Add Key"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      {isLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 2 }).map((_, i) => (
            <div key={i} className="p-4 rounded-xl bg-card space-y-2">
              <Skeleton className="h-4 w-28" />
              <Skeleton className="h-3 w-48" />
            </div>
          ))}
        </div>
      ) : sshKeys?.length === 0 ? (
        <div className="text-center py-16">
          <KeyRound className="mx-auto size-10 text-muted-foreground/40 mb-3" strokeWidth={1} />
          <p className="text-muted-foreground">No SSH keys configured</p>
        </div>
      ) : (
        <div className="space-y-2">
          {sshKeys?.map((key) => (
            <div key={key.id} className="group flex items-center justify-between p-4 rounded-xl bg-card transition-colors hover:bg-muted/40">
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
                  size="sm"
                  className="size-7 p-0 opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-destructive"
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
  const createAPIKey = useCreateAPIKey();
  const deleteAPIKey = useDeleteAPIKey();
  const [confirm, ConfirmDialog] = useConfirm();
  const [apiKeyName, setAPIKeyName] = useState("");
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

  const handleCreate = () => {
    if (!apiKeyName) { toast.error("Provide a name"); return; }
    createAPIKey.mutate(apiKeyName, {
      onSuccess: (key) => { setNewAPIKey(key.key ?? null); setAPIKeyName(""); setDialogOpen(false); toast.success("API key created"); },
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
        <div className="mb-6 rounded-xl border border-green-500/20 bg-green-500/5 overflow-hidden">
          <div className="flex items-center gap-2.5 px-4 py-3 border-b border-green-500/15">
            <ShieldCheck className="size-4 text-green-500 shrink-0" />
            <span className="text-sm font-medium text-green-500">API Key Created</span>
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
                  <><Check className="size-3.5 text-green-500" /><span className="text-green-500">Copied</span></>
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
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>Create API Key</DialogTitle>
              <DialogDescription>Give your key a name so you can identify it later.</DialogDescription>
            </DialogHeader>
            <div className="space-y-2">
              <Label htmlFor="api-name">Name</Label>
              <Input id="api-name" placeholder="CI/CD Pipeline" value={apiKeyName} onChange={(e) => setAPIKeyName(e.target.value)} />
            </div>
            <DialogFooter>
              <Button onClick={handleCreate} disabled={createAPIKey.isPending || !apiKeyName}>
                {createAPIKey.isPending ? <><Loader2 className="size-4 animate-spin mr-2" />Creating...</> : "Create Key"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      {isLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 2 }).map((_, i) => (
            <div key={i} className="p-4 rounded-xl bg-card space-y-2">
              <Skeleton className="h-4 w-28" />
              <Skeleton className="h-3 w-48" />
            </div>
          ))}
        </div>
      ) : apiKeys?.length === 0 ? (
        <div className="text-center py-16">
          <Key className="mx-auto size-10 text-muted-foreground/40 mb-3" strokeWidth={1} />
          <p className="text-muted-foreground">No API keys created</p>
        </div>
      ) : (
        <div className="space-y-2">
          {apiKeys?.map((key) => (
            <div key={key.id} className="group flex items-center justify-between p-4 rounded-xl bg-card transition-colors hover:bg-muted/40">
              <div className="flex items-center gap-3 min-w-0">
                <Key className="size-4 text-muted-foreground shrink-0" />
                <div className="min-w-0">
                  <div className="text-sm font-medium">{key.name}</div>
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <span className="font-mono">{key.key_prefix}...</span>
                    <span>&middot;</span>
                    <span>{timeAgo(key.created_at)}</span>
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
                size="sm"
                className="size-7 p-0 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-destructive"
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
