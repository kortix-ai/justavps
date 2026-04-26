'use client';

import { useStore } from '@/lib/store';
import { PageHeader } from '@/components/ui/page-header';
import { Card, CardHeader } from '@/components/ui/card';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Tag } from '@/components/ui/tag';
import { RefreshCw } from 'lucide-react';

export default function SettingsPage() {
  const { state, setBaseUrl, setToken, refreshAll } = useStore();
  return (
    <section className="mx-auto flex w-full max-w-[1280px] flex-col gap-6 px-7 pb-10 pt-6" data-route="settings">
      <PageHeader
        title="Settings"
        description="Connection to the V2 API. Stored in browser localStorage; never sent to the server."
      />

      <Card>
        <CardHeader title="V2 API connection" desc="The standalone apps/v2-api endpoint that this UI talks to." />
        <div className="grid grid-cols-2 gap-3 max-[720px]:grid-cols-1">
          <Field label="V2 API base URL" htmlFor="api-url" span="full" help="Defaults to the same origin that serves this admin UI.">
            <Input id="api-url" value={state.baseUrl} onChange={(event) => setBaseUrl(event.target.value)} placeholder="http://localhost:4200" />
          </Field>
          <Field label="Admin token" htmlFor="admin-token" span="full" help="Sent as Authorization: Bearer ... on every mutating call. Required for any /admin/* surface.">
            <Input id="admin-token" type="password" autoComplete="off" value={state.token} onChange={(event) => setToken(event.target.value)} placeholder="v2 admin token" />
          </Field>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button leftIcon={<RefreshCw className="size-3.5" />} disabled={state.busy} onClick={() => refreshAll().catch(() => {})}>Refresh now</Button>
          <span className="flex-1" />
          <Tag tone={state.token ? 'violet' : 'ghost'}>{state.token ? 'token set' : 'no token'}</Tag>
          <Tag tone={state.health?.status === 'ok' ? 'ok' : state.health ? 'warn' : 'ghost'}>health · {state.health?.status ?? '—'}</Tag>
        </div>
      </Card>

      <Card>
        <CardHeader title="Diagnostics" desc="Last known V2 API health response." />
        <pre className="min-h-[180px] overflow-auto whitespace-pre-wrap rounded-[8px] border border-border bg-bg p-3 font-mono text-[12px] leading-relaxed text-zinc-300">
          {state.health ? JSON.stringify(state.health, null, 2) : '— No /health response yet.'}
        </pre>
      </Card>
    </section>
  );
}
