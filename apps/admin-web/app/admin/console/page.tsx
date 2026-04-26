'use client';

import { useState } from 'react';
import { useStore } from '@/lib/store';
import { PageHeader } from '@/components/ui/page-header';
import { Card, CardHeader } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input, Select, Textarea } from '@/components/ui/input';
import { Field } from '@/components/ui/field';
import { Tag } from '@/components/ui/tag';
import { cn } from '@/lib/utils';
import { Zap } from 'lucide-react';

type Method = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

export default function ConsolePage() {
  const { state } = useStore();
  const [method, setMethod] = useState<Method>('GET');
  const [path, setPath] = useState('/health');
  const [body, setBody] = useState('');
  const [auth, setAuth] = useState<'auto' | 'yes' | 'no'>('auto');
  const [statusLabel, setStatusLabel] = useState<string>('idle');
  const [statusTone, setStatusTone] = useState<'ok' | 'bad' | ''>('');
  const [response, setResponse] = useState<string>('');
  const [busy, setBusy] = useState(false);

  async function send() {
    setBusy(true);
    try {
      const headers: Record<string, string> = { Accept: 'application/json' };
      const trimmedBody = body.trim();
      let payload: unknown = undefined;
      if (trimmedBody) {
        payload = JSON.parse(trimmedBody);
        headers['Content-Type'] = 'application/json';
      }
      const useToken = auth === 'yes' || (auth === 'auto' && state.token);
      if (useToken && state.token) headers.Authorization = `Bearer ${state.token}`;
      const target = `${state.baseUrl.replace(/\/$/, '')}${path.startsWith('/') ? path : `/${path}`}`;
      const res = await fetch(target, { method, headers, body: payload === undefined ? undefined : JSON.stringify(payload) });
      const text = await res.text();
      setStatusLabel(String(res.status));
      setStatusTone(res.ok ? 'ok' : 'bad');
      try {
        setResponse(JSON.stringify(JSON.parse(text), null, 2));
      } catch {
        setResponse(text);
      }
    } catch (error) {
      setStatusLabel('error');
      setStatusTone('bad');
      setResponse(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="mx-auto flex w-full max-w-[1280px] flex-col gap-6 px-7 pb-10 pt-6" data-route="console">
      <PageHeader title="API Console" description="Send raw requests to any V2 API path. Token from settings is used automatically." />
      <div className="grid grid-cols-2 gap-3.5 max-[1100px]:grid-cols-1">
        <Card>
          <CardHeader title="Request" />
          <div className="grid grid-cols-2 gap-3 max-[720px]:grid-cols-1">
            <Field label="Method" htmlFor="console-method">
              <Select id="console-method" value={method} onChange={(event) => setMethod(event.target.value as Method)}>
                {(['GET', 'POST', 'PUT', 'PATCH', 'DELETE'] as Method[]).map((m) => (
                  <option key={m} value={m}>{m}</option>
                ))}
              </Select>
            </Field>
            <Field label="Auth" htmlFor="console-auth">
              <Select id="console-auth" value={auth} onChange={(event) => setAuth(event.target.value as 'auto' | 'yes' | 'no')}>
                <option value="auto">auto (when token set)</option>
                <option value="yes">always</option>
                <option value="no">never</option>
              </Select>
            </Field>
            <Field label="Path" htmlFor="console-path" span="full" help="Relative to the V2 API base URL configured in Settings.">
              <Input id="console-path" value={path} onChange={(event) => setPath(event.target.value)} />
            </Field>
            <Field label="Body (JSON)" htmlFor="console-body" span="full">
              <Textarea id="console-body" placeholder={`{\n  "region": "eu"\n}`} value={body} onChange={(event) => setBody(event.target.value)} />
            </Field>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button id="console-send" leftIcon={<Zap className="size-3.5" />} disabled={busy} onClick={() => send()}>Send</Button>
            <Button id="console-clear" variant="ghost" onClick={() => { setResponse(''); setStatusLabel('idle'); setStatusTone(''); }}>Clear</Button>
          </div>
        </Card>

        <Card>
          <CardHeader
            title="Response"
            actions={
              <span
                id="console-status"
                className={cn(
                  'inline-flex items-center gap-1.5 rounded-full border px-2 py-[1.5px] text-[11px] font-medium',
                  statusTone === 'ok' && 'border-emerald-500/30 bg-emerald-500/10 text-emerald-400',
                  statusTone === 'bad' && 'border-red-500/30 bg-red-500/10 text-red-400',
                  !statusTone && 'border-border-strong bg-bg-1 text-fg-muted',
                )}
              >
                {statusLabel}
              </span>
            }
          />
          <div id="console-response" data-testid="v2-json-output" className="min-h-[320px] overflow-auto whitespace-pre-wrap rounded-[8px] border border-border bg-bg p-3 font-mono text-[12px] leading-relaxed text-zinc-300">
            {response || '— No response yet.'}
          </div>
        </Card>
      </div>

      <Card>
        <CardHeader title="Last action result" desc={state.lastResult?.label ?? '—'} />
        <pre id="result-json" className="min-h-[200px] overflow-auto whitespace-pre-wrap rounded-[8px] border border-border bg-bg p-3 font-mono text-[12px] leading-relaxed text-zinc-300">
          {state.lastResult ? JSON.stringify(state.lastResult.data, null, 2) : '— No actions executed yet.'}
        </pre>
        <div className="flex flex-wrap items-center gap-2 text-[12px] text-fg-subtle">
          <Tag tone="ghost">base url</Tag>
          <code className="font-mono">{state.baseUrl || 'unset'}</code>
          <span className="flex-1" />
          <Tag tone={state.token ? 'violet' : 'ghost'}>{state.token ? 'token attached' : 'no token'}</Tag>
        </div>
      </Card>
    </section>
  );
}
