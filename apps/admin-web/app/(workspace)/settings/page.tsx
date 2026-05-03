'use client';
import { useStore } from '@/lib/store';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { useUiPrefs } from '@/lib/ui-prefs';
import { useState } from 'react';

export default function SettingsPage() {
  const { state, setBaseUrl, setToken } = useStore();
  const {
    defaultFullBackups,
    setDefaultFullBackups,
    defaultOptimizedBackups,
    setDefaultOptimizedBackups,
  } = useUiPrefs();
  const [base, setBase] = useState(state.baseUrl);
  const [token, setTokenLocal] = useState(state.token);
  return (
    <div className="flex flex-col gap-6">
      <header><h1 className="text-2xl font-semibold tracking-tight">Settings</h1><p className="text-sm text-muted-foreground">API base URL and admin token.</p></header>
      <Card>
        <CardHeader><CardTitle>API connection</CardTitle><CardDescription>Stored in localStorage; survives reloads.</CardDescription></CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="base">V2 API base URL</Label>
            <Input id="base" value={base} onChange={(e) => setBase(e.target.value)} className="font-mono text-sm" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="token">Admin token</Label>
            <Input id="token" type="password" value={token} onChange={(e) => setTokenLocal(e.target.value)} className="font-mono text-sm" />
          </div>
          <div className="flex items-center gap-2">
            <Button onClick={() => { setBaseUrl(base); setToken(token); }}>Save</Button>
            <Badge variant={state.health?.status === 'ok' ? 'default' : 'secondary'}>
              {state.health?.status ?? 'unknown'}
            </Badge>
          </div>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Artifact defaults</CardTitle>
          <CardDescription>Defaults for snapshot and backup dialogs. Stored locally in this admin browser.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-start justify-between gap-4 rounded-lg border p-3">
            <div className="space-y-1">
              <Label htmlFor="default-full-backups" className="cursor-pointer">Create full backups by default</Label>
              <p className="text-xs text-muted-foreground">Full backups include the instance and its snapshots. Turn off for smaller instance-only backups.</p>
            </div>
            <Switch id="default-full-backups" checked={defaultFullBackups} onCheckedChange={setDefaultFullBackups} />
          </div>
          <div className="flex items-start justify-between gap-4 rounded-lg border p-3">
            <div className="space-y-1">
              <Label htmlFor="default-optimized-backups" className="cursor-pointer">Use optimized storage backups by default</Label>
              <p className="text-xs text-muted-foreground">Faster/native Incus backup format where supported; best for same-storage-driver restores.</p>
            </div>
            <Switch id="default-optimized-backups" checked={defaultOptimizedBackups} onCheckedChange={setDefaultOptimizedBackups} />
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
