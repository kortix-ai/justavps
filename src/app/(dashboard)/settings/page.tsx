"use client";

import { useState, useEffect } from "react";
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
import { apiFetch } from "@/lib/api";

interface SSHKey {
  id: string;
  name: string;
  fingerprint: string;
  created_at: string;
}

interface APIKey {
  id: string;
  name: string;
  key?: string;
  key_prefix: string;
  created_at: string;
  last_used: string | null;
}

function BillingTab() {
  const [usage, setUsage] = useState<any>(null);
  const [billingUrl, setBillingUrl] = useState<string | null>(null);
  const [billingLoading, setBillingLoading] = useState(true);

  useEffect(() => {
    async function fetchBilling() {
      try {
        const [usageRes, billingRes] = await Promise.all([
          apiFetch('/account/usage'),
          apiFetch('/account/billing'),
        ]);
        if (usageRes.ok) setUsage(await usageRes.json());
        if (billingRes.ok) {
          const data = await billingRes.json();
          setBillingUrl(data.portal_url);
        }
      } catch {} finally {
        setBillingLoading(false);
      }
    }
    fetchBilling();
  }, []);

  const totalMachines = usage?.current_period?.total_machines ?? 0;
  const estimatedCost = usage?.current_period?.estimated_cost ?? 0;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Billing & Usage</CardTitle>
        <CardDescription>Manage your subscription and billing</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex justify-between items-center p-4 border rounded-lg">
          <div>
            <h3 className="font-medium">Active Machines</h3>
            <p className="text-sm text-muted-foreground">
              {totalMachines} machine{totalMachines !== 1 ? 's' : ''} running
            </p>
          </div>
          <Badge variant="secondary">{totalMachines > 0 ? 'Active' : 'No Machines'}</Badge>
        </div>

        <div className="flex justify-between items-center p-4 border rounded-lg">
          <div>
            <h3 className="font-medium">Estimated Monthly Cost</h3>
            <p className="text-sm text-muted-foreground">Based on current machines</p>
          </div>
          <div className="text-right">
            <div className="font-mono text-2xl font-bold">${estimatedCost}</div>
            <div className="text-xs text-muted-foreground">/month</div>
          </div>
        </div>

        {usage?.current_period?.machines?.length > 0 && (
          <div className="p-4 border rounded-lg">
            <h3 className="font-medium mb-3">Machine Breakdown</h3>
            <div className="space-y-2">
              {usage.current_period.machines.map((m: any) => (
                <div key={m.id} className="flex justify-between text-sm">
                  <span className="text-muted-foreground">{m.slug} ({m.server_type})</span>
                  <Badge variant={m.status === 'ready' ? 'default' : 'secondary'}>{m.status}</Badge>
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="pt-4">
          {billingUrl ? (
            <a href={billingUrl} target="_blank" rel="noopener noreferrer">
              <Button className="w-full">Manage Billing in Stripe</Button>
            </a>
          ) : (
            <Button className="w-full" disabled={billingLoading}>
              {billingLoading ? 'Loading...' : 'Create a machine to start billing'}
            </Button>
          )}
          <p className="text-sm text-muted-foreground mt-2 text-center">
            View invoices, update payment methods, and manage subscriptions
          </p>
        </div>
      </CardContent>
    </Card>
  );
}

export default function SettingsPage() {
  const [sshKeys, setSSHKeys] = useState<SSHKey[]>([]);
  const [apiKeys, setAPIKeys] = useState<APIKey[]>([]);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  
  // SSH Key form
  const [sshKeyName, setSSHKeyName] = useState("");
  const [sshKeyContent, setSSHKeyContent] = useState("");
  
  // API Key form  
  const [apiKeyName, setAPIKeyName] = useState("");
  const [newAPIKey, setNewAPIKey] = useState<string | null>(null);

  useEffect(() => {
    fetchData();
  }, []);

  const fetchData = async () => {
    try {
      const [sshResponse, apiResponse] = await Promise.all([
        apiFetch('/ssh-keys'),
        apiFetch('/api-keys'),
      ]);

      if (sshResponse.ok) {
        const sshData = await sshResponse.json();
        setSSHKeys(sshData.ssh_keys || []);
      }

      if (apiResponse.ok) {
        const apiData = await apiResponse.json();
        setAPIKeys(apiData.api_keys || []);
      }
    } catch (err) {
      toast.error('Failed to load settings');
    } finally {
      setLoading(false);
    }
  };

  const handleCreateSSHKey = async () => {
    if (!sshKeyName || !sshKeyContent) {
      toast.error('Please provide both name and public key');
      return;
    }

    setActionLoading('create-ssh');
    try {
      const response = await apiFetch('/ssh-keys', {
        method: 'POST',
        body: JSON.stringify({
          name: sshKeyName,
          public_key: sshKeyContent,
        }),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.message || 'Failed to create SSH key');
      }

      const newKey = await response.json();
      setSSHKeys([...sshKeys, newKey]);
      setSSHKeyName("");
      setSSHKeyContent("");
      toast.success('SSH key created successfully');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to create SSH key');
    } finally {
      setActionLoading(null);
    }
  };

  const handleDeleteSSHKey = async (keyId: string) => {
    setActionLoading(`delete-ssh-${keyId}`);
    try {
      const response = await apiFetch(`/ssh-keys/${keyId}`, {
        method: 'DELETE',
      });

      if (!response.ok) {
        const error = await response.json().catch(() => ({}));
        throw new Error(error.message || 'Failed to delete SSH key');
      }

      setSSHKeys(sshKeys.filter(key => key.id !== keyId));
      toast.success('SSH key deleted successfully');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to delete SSH key');
    } finally {
      setActionLoading(null);
    }
  };

  const handleCreateAPIKey = async () => {
    if (!apiKeyName) {
      toast.error('Please provide a name for the API key');
      return;
    }

    setActionLoading('create-api');
    try {
      const response = await apiFetch('/api-keys', {
        method: 'POST',
        body: JSON.stringify({
          name: apiKeyName,
        }),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.message || 'Failed to create API key');
      }

      const newKey = await response.json();
      setAPIKeys([...apiKeys, newKey]);
      setNewAPIKey(newKey.key);
      setAPIKeyName("");
      toast.success('API key created successfully');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to create API key');
    } finally {
      setActionLoading(null);
    }
  };

  const handleDeleteAPIKey = async (keyId: string) => {
    setActionLoading(`delete-api-${keyId}`);
    try {
      const response = await apiFetch(`/api-keys/${keyId}`, {
        method: 'DELETE',
      });

      if (!response.ok) {
        const error = await response.json().catch(() => ({}));
        throw new Error(error.message || 'Failed to delete API key');
      }

      setAPIKeys(apiKeys.filter(key => key.id !== keyId));
      toast.success('API key deleted successfully');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to delete API key');
    } finally {
      setActionLoading(null);
    }
  };

  const copyAPIKey = () => {
    if (newAPIKey) {
      navigator.clipboard.writeText(newAPIKey);
      toast.success('API key copied to clipboard');
    }
  };

  return (
    <div className="space-y-6">
      <h1 className="text-3xl font-bold">Settings</h1>

      <Tabs defaultValue="ssh-keys" className="space-y-4">
        <TabsList>
          <TabsTrigger value="ssh-keys">SSH Keys</TabsTrigger>
          <TabsTrigger value="api-keys">API Keys</TabsTrigger>
          <TabsTrigger value="billing">Billing</TabsTrigger>
        </TabsList>

        <TabsContent value="ssh-keys" className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>SSH Keys</CardTitle>
              <CardDescription>
                Manage SSH keys for secure access to your machines
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                {loading ? (
                  Array.from({ length: 3 }).map((_, i) => (
                    <div key={i} className="flex justify-between items-center p-4 border rounded">
                      <div className="space-y-1">
                        <Skeleton className="h-4 w-32" />
                        <Skeleton className="h-3 w-48" />
                      </div>
                      <Skeleton className="h-8 w-16" />
                    </div>
                  ))
                ) : sshKeys.length === 0 ? (
                  <div className="text-center py-8">
                    <p className="text-muted-foreground mb-4">No SSH keys configured yet</p>
                  </div>
                ) : (
                  sshKeys.map((key) => (
                    <div key={key.id} className="flex justify-between items-center p-4 border rounded">
                      <div>
                        <h3 className="font-medium">{key.name}</h3>
                        <p className="text-sm text-muted-foreground">
                          {key.fingerprint} • Created {new Date(key.created_at).toLocaleDateString()}
                        </p>
                      </div>
                      <Dialog>
                        <DialogTrigger className={cn(buttonVariants({variant:"destructive",size:"sm"}))}>Delete</DialogTrigger>
                        <DialogContent>
                          <DialogHeader>
                            <DialogTitle>Delete SSH Key</DialogTitle>
                            <DialogDescription>
                               Are you sure you want to delete &quot;{key.name}&quot;? This action cannot be undone.
                            </DialogDescription>
                          </DialogHeader>
                          <DialogFooter>
                            <Button variant="outline">Cancel</Button>
                            <Button 
                              variant="destructive" 
                              onClick={() => handleDeleteSSHKey(key.id)}
                              disabled={actionLoading === `delete-ssh-${key.id}`}
                            >
                              {actionLoading === `delete-ssh-${key.id}` ? 'Deleting...' : 'Delete'}
                            </Button>
                          </DialogFooter>
                        </DialogContent>
                      </Dialog>
                    </div>
                  ))
                )}

                <div className="pt-4 border-t">
                  <Dialog>
                    <DialogTrigger className={cn(buttonVariants())}>Add SSH Key</DialogTrigger>
                    <DialogContent className="sm:max-w-md">
                      <DialogHeader>
                        <DialogTitle>Add SSH Key</DialogTitle>
                        <DialogDescription>
                          Add a new SSH key to access your machines
                        </DialogDescription>
                      </DialogHeader>
                      <div className="space-y-4">
                        <div>
                          <Label htmlFor="ssh-name">Name</Label>
                          <Input
                            id="ssh-name"
                            placeholder="e.g., My Laptop"
                            value={sshKeyName}
                            onChange={(e) => setSSHKeyName(e.target.value)}
                          />
                        </div>
                        <div>
                          <Label htmlFor="ssh-key">Public Key</Label>
                          <Textarea
                            id="ssh-key"
                            placeholder="ssh-ed25519 AAAA... user@host"
                            value={sshKeyContent}
                            onChange={(e) => setSSHKeyContent(e.target.value)}
                            rows={3}
                          />
                        </div>
                      </div>
                      <DialogFooter>
                        <Button variant="outline">Cancel</Button>
                        <Button 
                          onClick={handleCreateSSHKey}
                          disabled={actionLoading === 'create-ssh'}
                        >
                          {actionLoading === 'create-ssh' ? 'Adding...' : 'Add Key'}
                        </Button>
                      </DialogFooter>
                    </DialogContent>
                  </Dialog>
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="api-keys" className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>API Keys</CardTitle>
              <CardDescription>
                Create and manage API keys for programmatic access
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                {loading ? (
                  Array.from({ length: 3 }).map((_, i) => (
                    <div key={i} className="flex justify-between items-center p-4 border rounded">
                      <div className="space-y-1">
                        <Skeleton className="h-4 w-32" />
                        <Skeleton className="h-3 w-48" />
                      </div>
                      <Skeleton className="h-8 w-16" />
                    </div>
                  ))
                ) : apiKeys.length === 0 ? (
                  <div className="text-center py-8">
                    <p className="text-muted-foreground mb-4">No API keys created yet</p>
                  </div>
                ) : (
                  apiKeys.map((key) => (
                    <div key={key.id} className="flex justify-between items-center p-4 border rounded">
                      <div>
                        <h3 className="font-medium">{key.name}</h3>
                        <p className="text-sm text-muted-foreground">
                          {key.key_prefix}... • Created {new Date(key.created_at).toLocaleDateString()}
                          {key.last_used && (
                            <> • Last used {new Date(key.last_used).toLocaleDateString()}</>
                          )}
                        </p>
                      </div>
                      <Dialog>
                        <DialogTrigger className={cn(buttonVariants({variant:"destructive",size:"sm"}))}>Delete</DialogTrigger>
                        <DialogContent>
                          <DialogHeader>
                            <DialogTitle>Delete API Key</DialogTitle>
                            <DialogDescription>
                               Are you sure you want to delete &quot;{key.name}&quot;? This action cannot be undone
                              and will break any integrations using this key.
                            </DialogDescription>
                          </DialogHeader>
                          <DialogFooter>
                            <Button variant="outline">Cancel</Button>
                            <Button 
                              variant="destructive" 
                              onClick={() => handleDeleteAPIKey(key.id)}
                              disabled={actionLoading === `delete-api-${key.id}`}
                            >
                              {actionLoading === `delete-api-${key.id}` ? 'Deleting...' : 'Delete'}
                            </Button>
                          </DialogFooter>
                        </DialogContent>
                      </Dialog>
                    </div>
                  ))
                )}

                <div className="pt-4 border-t">
                  <Dialog>
                    <DialogTrigger className={cn(buttonVariants())}>Create API Key</DialogTrigger>
                    <DialogContent className="sm:max-w-md">
                      <DialogHeader>
                        <DialogTitle>Create API Key</DialogTitle>
                        <DialogDescription>
                          Create a new API key for programmatic access to JustAVPS
                        </DialogDescription>
                      </DialogHeader>
                      <div className="space-y-4">
                        <div>
                          <Label htmlFor="api-name">Name</Label>
                          <Input
                            id="api-name"
                            placeholder="e.g., CI/CD Pipeline"
                            value={apiKeyName}
                            onChange={(e) => setAPIKeyName(e.target.value)}
                          />
                        </div>
                      </div>
                      <DialogFooter>
                        <Button variant="outline">Cancel</Button>
                        <Button 
                          onClick={handleCreateAPIKey}
                          disabled={actionLoading === 'create-api'}
                        >
                          {actionLoading === 'create-api' ? 'Creating...' : 'Create Key'}
                        </Button>
                      </DialogFooter>
                    </DialogContent>
                  </Dialog>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* New API Key Display */}
          {newAPIKey && (
            <Card className="border-green-500">
              <CardHeader>
                <CardTitle className="text-green-600">API Key Created!</CardTitle>
                <CardDescription>
                   Save this key now - you won&apos;t be able to see it again
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="flex items-center space-x-2">
                  <Input value={newAPIKey} readOnly />
                  <Button onClick={copyAPIKey}>Copy</Button>
                </div>
                <Button 
                  variant="outline" 
                  className="mt-4 w-full" 
                  onClick={() => setNewAPIKey(null)}
                >
                   I&apos;ve saved this key
                </Button>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        <TabsContent value="billing" className="space-y-6">
          <BillingTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}