import { useState } from 'react';
import { useStore } from '../lib/store';
import { cx } from '../lib/utils';

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
      const res = await fetch(target, {
        method,
        headers,
        body: payload === undefined ? undefined : JSON.stringify(payload),
      });
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
      <div className="panel">
        <div className="panel-head">
          <h2>API Console</h2>
          <span className="desc">Send raw V2 API requests</span>
        </div>
        <div className="console">
          <div className="form-grid">
            <div className="field">
              <label className="field-label" htmlFor="console-method">Method</label>
              <select
                id="console-method"
                className="input"
                value={method}
                onChange={(event) => setMethod(event.target.value as Method)}
              >
                <option>GET</option>
                <option>POST</option>
                <option>PUT</option>
                <option>PATCH</option>
                <option>DELETE</option>
              </select>
            </div>
            <div className="field">
              <label className="field-label" htmlFor="console-path">Path</label>
              <input id="console-path" className="input" value={path} onChange={(event) => setPath(event.target.value)} />
            </div>
            <div className="field">
              <label className="field-label" htmlFor="console-auth">Use admin token</label>
              <select
                id="console-auth"
                className="input"
                value={auth}
                onChange={(event) => setAuth(event.target.value as 'auto' | 'yes' | 'no')}
              >
                <option value="auto">auto</option>
                <option value="yes">always</option>
                <option value="no">never</option>
              </select>
            </div>
            <div className="field">
              <label className="field-label" htmlFor="console-body">Body</label>
              <textarea
                id="console-body"
                className="input"
                placeholder='{"region":"eu"}'
                value={body}
                onChange={(event) => setBody(event.target.value)}
              />
            </div>
            <div className="toolbar">
              <button id="console-send" type="button" className="button" disabled={busy} onClick={() => send()}>
                Send
              </button>
              <button
                id="console-clear"
                type="button"
                className="button ghost"
                onClick={() => {
                  setResponse('');
                  setStatusLabel('idle');
                  setStatusTone('');
                }}
              >
                Clear
              </button>
            </div>
          </div>
          <div className="form-grid">
            <div className="field">
              <label className="field-label">Status</label>
              <div id="console-status" className={cx('badge', statusTone)}>
                {statusLabel}
              </div>
            </div>
            <div className="field">
              <label className="field-label" htmlFor="console-response">Response</label>
              <textarea
                id="console-response"
                className="input log"
                data-testid="v2-json-output"
                readOnly
                style={{ minHeight: 320 }}
                value={response}
              />
            </div>
          </div>
        </div>
      </div>

      <div className="panel">
        <div className="panel-head">
          <h2>Last Result</h2>
          <span className="desc" id="result-label">
            {state.lastResult?.label ?? 'none'}
          </span>
        </div>
        <textarea
          id="result-json"
          className="input log"
          readOnly
          style={{ minHeight: 220 }}
          value={state.lastResult ? JSON.stringify(state.lastResult.data, null, 2) : ''}
        />
      </div>
    </section>
  );
}
