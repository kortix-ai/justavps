import { useStore } from '../lib/store';
import { PageHeader } from '../components/ui/PageHeader';
import { Card, CardHeader } from '../components/ui/Card';
import { Field } from '../components/ui/Field';
import { Input } from '../components/ui/Input';
import { Button } from '../components/ui/Button';
import { Tag } from '../components/ui/Tag';
import { IconRefresh } from '../components/ui/icons';

export function SettingsPage() {
  const { state, setBaseUrl, setToken, refreshAll } = useStore();
  return (
    <section className="page" data-route="settings">
      <PageHeader
        title="Settings"
        description="Connection to the V2 API. Stored in browser localStorage; never sent to the server."
      />

      <Card>
        <CardHeader title="V2 API connection" desc="The standalone apps/v2-api endpoint that this UI talks to." />
        <div className="form-grid form-grid--2">
          <Field label="V2 API base URL" htmlFor="api-url" span="full" help="Defaults to the same origin that serves this admin UI.">
            <Input id="api-url" value={state.baseUrl} onChange={(event) => setBaseUrl(event.target.value)} placeholder="http://localhost:4200" />
          </Field>
          <Field label="Admin token" htmlFor="admin-token" span="full" help="Sent as Authorization: Bearer ... on every mutating call. Required for any /admin/* surface.">
            <Input id="admin-token" type="password" autoComplete="off" value={state.token} onChange={(event) => setToken(event.target.value)} placeholder="v2 admin token" />
          </Field>
        </div>
        <div className="toolbar">
          <Button leftIcon={<IconRefresh />} disabled={state.busy} onClick={() => refreshAll().catch(() => {})}>
            Refresh now
          </Button>
          <span className="spacer" />
          <Tag tone={state.token ? 'violet' : 'ghost'}>{state.token ? 'token set' : 'no token'}</Tag>
          <Tag tone={state.health?.status === 'ok' ? 'ok' : state.health ? 'warn' : 'ghost'}>
            health · {state.health?.status ?? '—'}
          </Tag>
        </div>
      </Card>

      <Card>
        <CardHeader title="Diagnostics" desc="Last known V2 API health response." />
        <div className="log" style={{ minHeight: 180 }}>
          {state.health ? JSON.stringify(state.health, null, 2) : '— No /health response yet.'}
        </div>
      </Card>
    </section>
  );
}
