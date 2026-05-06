'use client';

import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, ReceiptText, RefreshCw, Search } from 'lucide-react';
import type { Account, BillingLedgerEntry, BillingStatement } from '@/lib/api';
import { useStore } from '@/lib/store';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';

function currentMonth() {
  const now = new Date();
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
}

function fmtEur(value?: number | null, max = 6) {
  if (value === null || value === undefined || !Number.isFinite(value)) return '€0';
  return `€${value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: max })}`;
}

function fmtDateTime(value?: string | null) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short', timeZone: 'UTC' }) + ' UTC';
}

function fmtUsage(quantity: number, unit: string) {
  const value = quantity.toLocaleString(undefined, { maximumFractionDigits: 3 });
  if (unit === 'vcpu_second') return `${value} vCPU·s`;
  if (unit === 'ram_gb_second') return `${value} GB RAM·s`;
  if (unit === 'storage_gib_second') return `${value} GiB·s`;
  return `${value} ${unit}`;
}

export default function BillingPage() {
  const { request, runAction, state } = useStore();
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [accountId, setAccountId] = useState('system');
  const [month, setMonth] = useState(currentMonth());
  const [statement, setStatement] = useState<BillingStatement | null>(null);
  const [ledger, setLedger] = useState<BillingLedgerEntry[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const account = params.get('account');
    const queryMonth = params.get('month');
    if (account) setAccountId(account);
    if (queryMonth && /^\d{4}-\d{2}$/.test(queryMonth)) setMonth(queryMonth);
  }, []);

  const selectedAccount = useMemo(() => accounts.find((account) => account.id === accountId) ?? null, [accounts, accountId]);

  const loadAccounts = async () => {
    const data = await request<{ accounts: Account[] }>('/admin/accounts');
    const rows = data.accounts ?? [];
    setAccounts(rows);
    if (!rows.some((account) => account.id === accountId)) setAccountId(rows[0]?.id ?? 'system');
  };

  const loadBilling = async () => {
    if (!accountId) return;
    setLoading(true);
    try {
      const query = `month=${encodeURIComponent(month)}`;
      const [statementData, ledgerData] = await Promise.all([
        request<BillingStatement>(`/admin/billing/v2/accounts/${encodeURIComponent(accountId)}/statement?${query}`),
        request<{ entries: BillingLedgerEntry[] }>(`/admin/billing/v2/accounts/${encodeURIComponent(accountId)}/ledger?${query}&limit=100`),
      ]);
      setStatement(statementData);
      setLedger(ledgerData.entries ?? []);
    } finally {
      setLoading(false);
    }
  };

  const reconcile = async () => {
    await runAction('finalize Billing API v2 statement', async () => {
      const result = await request('/admin/billing/v2/reconcile', {
        method: 'POST',
        body: { account_id: accountId, month, mode: 'finalize' },
      });
      await loadBilling();
      return result;
    });
  };

  useEffect(() => {
    loadAccounts().catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    loadBilling().catch(() => setStatement(null));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accountId, month]);

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight"><ReceiptText className="size-6" /> Cost Breakdown</h1>
          <p className="text-sm text-muted-foreground">Billing API v2 shows actual month-to-date usage from finalized ledger rows. Bursty compute is accounted from actual hourly intervals.</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => loadBilling().catch(() => undefined)} disabled={loading || state.busy}>
            <RefreshCw className="size-3.5" /> Refresh
          </Button>
          <Button onClick={reconcile} disabled={loading || state.busy || !accountId}>Finalize ledger</Button>
        </div>
      </header>

      <Card>
        <CardContent className="grid gap-3 p-4 md:grid-cols-[1fr_180px_auto] md:items-end">
          <div className="space-y-1.5">
            <Label>Account</Label>
            <Select value={accountId} onValueChange={setAccountId}>
              <SelectTrigger><SelectValue placeholder="Select account" /></SelectTrigger>
              <SelectContent>
                {accounts.map((account) => <SelectItem key={account.id} value={account.id}>{account.name} · {account.id}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>Month (UTC)</Label>
            <Input value={month} onChange={(event) => setMonth(event.target.value)} placeholder="YYYY-MM" className="font-mono" />
          </div>
          <div className="text-xs text-muted-foreground">
            {selectedAccount ? <div className="font-mono">{selectedAccount.slug}</div> : 'No account selected'}
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-3 md:grid-cols-4">
        <Stat label="Actual month-to-date" value={fmtEur(statement?.actual_mtd.eur)} />
        <Stat label="Finalized through" value={fmtDateTime(statement?.window.finalized_through)} compact />
        <Stat label="Current hour accumulating" value={fmtEur(statement?.unfinalized_current_hour.eur)} />
        <Stat label="Coverage" value={statement?.coverage.status ?? (loading ? 'loading' : '—')} sub={statement?.coverage.accuracy_model?.replace(/_/g, ' ')} badge />
      </div>

      {statement?.coverage.warnings.length || statement?.coverage.unmeasured_sources.length ? (
        <Card className="border-amber-300/60">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base"><AlertTriangle className="size-4 text-amber-500" /> Coverage warnings</CardTitle>
            <CardDescription>These sources are excluded from actual totals until exact measurements exist or ledger rows are finalized.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            {statement.coverage.warnings.map((warning) => <div key={warning} className="rounded-lg border bg-muted/20 p-2">{warning}</div>)}
            {statement.coverage.unmeasured_sources.map((source) => (
              <div key={`${source.source_type}:${source.source_id}:${source.reason}`} className="rounded-lg border bg-muted/20 p-2 font-mono text-xs">
                {source.source_type}:{source.source_id} — {source.reason}
              </div>
            ))}
          </CardContent>
        </Card>
      ) : null}

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
        <Card>
          <CardHeader>
            <CardTitle>Components</CardTitle>
            <CardDescription>Actual usage and amount by resource dimension for the selected window.</CardDescription>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader><TableRow><TableHead>Component</TableHead><TableHead>Usage this month</TableHead><TableHead className="text-right">Amount</TableHead></TableRow></TableHeader>
              <TableBody>
                {(statement?.components ?? []).map((component) => (
                  <TableRow key={component.key}>
                    <TableCell>{component.label}</TableCell>
                    <TableCell className="font-mono text-xs text-muted-foreground">{fmtUsage(component.quantity, component.quantity_unit)}</TableCell>
                    <TableCell className="text-right font-medium">{fmtEur(component.eur)}</TableCell>
                  </TableRow>
                ))}
                {statement && statement.components.length === 0 ? <TableRow><TableCell colSpan={3} className="py-8 text-center text-sm text-muted-foreground">No finalized Billing API v2 ledger rows for this window.</TableCell></TableRow> : null}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Sources</CardTitle>
            <CardDescription>Top machines, artifacts, and warm pool sources.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            {(statement?.sources ?? []).slice(0, 12).map((source) => (
              <div key={`${source.source_type}:${source.source_id}`} className="rounded-lg border p-2 text-sm">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="truncate font-medium">{source.name ?? source.source_id}</div>
                    <div className="truncate font-mono text-2xs text-muted-foreground">{source.source_type}:{source.source_id}</div>
                  </div>
                  <div className="font-mono text-xs">{fmtEur(source.eur)}</div>
                </div>
                <div className="mt-1 flex flex-wrap gap-1">{source.components.map((component) => <Badge key={component} variant="outline" className="text-2xs">{component}</Badge>)}</div>
              </div>
            ))}
            {statement && statement.sources.length === 0 ? <p className="text-sm text-muted-foreground">No sources yet.</p> : null}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <CardTitle>Hourly ledger</CardTitle>
              <CardDescription>Raw finalized rows powering this statement.</CardDescription>
            </div>
            <div className="relative w-full sm:w-72">
              <Search className="pointer-events-none absolute left-2.5 top-2.5 size-4 text-muted-foreground" />
              <Input placeholder="Latest 100 rows" className="pl-8" disabled />
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader><TableRow><TableHead>Interval</TableHead><TableHead>Source</TableHead><TableHead>Component</TableHead><TableHead>Usage</TableHead><TableHead className="text-right">Amount</TableHead></TableRow></TableHeader>
            <TableBody>
              {ledger.map((entry) => (
                <TableRow key={entry.id}>
                  <TableCell className="font-mono text-2xs text-muted-foreground">{new Date(entry.interval_start).toISOString().slice(0, 16)} → {new Date(entry.interval_end).toISOString().slice(11, 16)}</TableCell>
                  <TableCell className="font-mono text-xs">{entry.source_type}:{entry.source_id}</TableCell>
                  <TableCell>{entry.component}</TableCell>
                  <TableCell className="font-mono text-xs text-muted-foreground">{fmtUsage(Number(entry.quantity), entry.quantity_unit)}</TableCell>
                  <TableCell className="text-right font-medium">{fmtEur(entry.eur)}</TableCell>
                </TableRow>
              ))}
              {ledger.length === 0 ? <TableRow><TableCell colSpan={5} className="py-8 text-center text-sm text-muted-foreground">No ledger rows loaded.</TableCell></TableRow> : null}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}

function Stat({ label, value, compact, badge, sub }: { label: string; value: string; compact?: boolean; badge?: boolean; sub?: string }) {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="text-xs uppercase tracking-wide text-muted-foreground">{label}</div>
        <div className={`${compact ? 'text-sm' : 'text-2xl'} mt-1 font-semibold tabular-nums`}>{badge ? <Badge variant={value === 'complete' ? 'default' : 'secondary'}>{value}</Badge> : value}</div>
        {sub ? <div className="mt-1 text-2xs text-muted-foreground">{sub}</div> : null}
      </CardContent>
    </Card>
  );
}
