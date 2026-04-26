import { useState } from 'react';
import { useStore } from '../lib/store';
import { PageHeader } from '../components/ui/PageHeader';
import { Card, CardHeader } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Input, Select, Textarea } from '../components/ui/Input';
import { Field } from '../components/ui/Field';
import { Tag } from '../components/ui/Tag';
import { cx } from '../lib/utils';
import { IconBolt } from '../components/ui/icons';

type Method = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

export function ConsolePage() {
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
    <section className="page" data-route="console">
      <PageHeader
        title="API Console"
        description="Send raw requests to any V2 API path. Token from settings is used automatically."
      />
      <div className="card-grid card-grid--2">
        <Card>
          <CardHeader title="Request" />
          <div className="form-grid form-grid--2">
            <Field label="Method" htmlFor="console-method">
              <Select id="console-method" value={method} onChange={(event) => setMethod(event.target.value as Method)}>
                <option>GET</option>
                <option>POST</option>
                <option>PUT</option>
                <option>PATCH</option>
                <option>DELETE</option>
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
          <div className="toolbar">
            <Button id="console-send" leftIcon={<IconBolt />} disabled={busy} onClick={() => send()}>
              Send
            </Button>
            <Button id="console-clear" variant="ghost" onClick={() => { setResponse(''); setStatusLabel('idle'); setStatusTone(''); }}>
              Clear
            </Button>
          </div>
        </Card>

        <Card>
          <CardHeader
            title="Response"
            actions={
              <span className={cx('tag', statusTone === 'ok' && 'tag--ok', statusTone === 'bad' && 'tag--bad')} id="console-status">
                {statusLabel}
              </span>
            }
          />
          <div className="log" id="console-response" data-testid="v2-json-output" style={{ minHeight: 320 }}>
            {response || '— No response yet.'}
          </div>
        </Card>
      </div>

      <Card>
        <CardHeader title="Last action result" desc={state.lastResult?.label ?? '—'} />
        <div className="log" id="result-json" style={{ minHeight: 200 }}>
          {state.lastResult ? JSON.stringify(state.lastResult.data, null, 2) : '— No actions executed yet.'}
        </div>
        <div className="toolbar text-subtle text-sm">
          <Tag tone="ghost">base url</Tag>
          <code className="mono">{state.baseUrl || 'unset'}</code>
          <span className="spacer" />
          <Tag tone={state.token ? 'violet' : 'ghost'}>{state.token ? 'token attached' : 'no token'}</Tag>
        </div>
      </Card>
    </section>
  );
}
