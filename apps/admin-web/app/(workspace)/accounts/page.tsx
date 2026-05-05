'use client';

import { useEffect, useMemo, useState } from 'react';
import { Building2, Calculator, MailPlus, Plus, RefreshCw, Shield, Trash2, UserPlus } from 'lucide-react';
import { useStore } from '@/lib/store';
import { formatBytes } from '@/lib/utils';
import type { Account, AccountCostBreakdown } from '@/lib/api';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';

type Role = 'owner' | 'admin' | 'member';

function fmtEur(value?: number | null, max = 3) {
  if (value === null || value === undefined || !Number.isFinite(value)) return '€0';
  return `€${value.toLocaleString(undefined, { maximumFractionDigits: max })}`;
}

function fmtDate(value?: string | null) {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString();
}

export default function AccountsPage() {
  const { request, runAction, state } = useStore();
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [selectedId, setSelectedId] = useState<string>('system');
  const [cost, setCost] = useState<AccountCostBreakdown | null>(null);
  const [loadingCost, setLoadingCost] = useState(false);
  const selected = useMemo(() => accounts.find((account) => account.id === selectedId) ?? accounts[0] ?? null, [accounts, selectedId]);

  const load = async () => {
    const data = await request<{ accounts: Account[] }>('/admin/accounts');
    const rows = data.accounts ?? [];
    setAccounts(rows);
    if (!rows.some((account) => account.id === selectedId)) setSelectedId(rows[0]?.id ?? 'system');
  };

  const loadCost = async (accountId: string) => {
    setLoadingCost(true);
    try {
      const data = await request<AccountCostBreakdown>(`/admin/accounts/${encodeURIComponent(accountId)}/cost-breakdown`);
      setCost(data);
    } finally {
      setLoadingCost(false);
    }
  };

  useEffect(() => {
    load().catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!selected?.id) return;
    loadCost(selected.id).catch(() => setCost(null));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected?.id]);

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight"><Building2 className="size-6" /> Accounts & organizations</h1>
          <p className="text-sm text-muted-foreground">V1-style account graph in V2: personal accounts are auto-created for users; organizations have owners, roles, invitations, safeguards, and scoped costs.</p>
        </div>
        <Button variant="outline" onClick={() => runAction('refresh accounts', load).catch(() => undefined)} disabled={state.busy}>
          <RefreshCw className="size-3.5" /> Refresh
        </Button>
      </header>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,0.85fr)_minmax(360px,1.15fr)]">
        <div className="space-y-4">
          <CreateUserCard onCreate={load} />
          <CreateAccountCard onCreate={load} />
          <Card>
            <CardHeader>
              <CardTitle>Accounts</CardTitle>
              <CardDescription>{accounts.length} account{accounts.length === 1 ? '' : 's'} configured.</CardDescription>
            </CardHeader>
            <CardContent>
              {accounts.length === 0 ? (
                <p className="text-sm text-muted-foreground">No accounts yet.</p>
              ) : (
                <div className="space-y-2">
                  {accounts.map((account) => (
                    <button
                      key={account.id}
                      type="button"
                      onClick={() => setSelectedId(account.id)}
                      className={`w-full rounded-xl border p-3 text-left transition hover:bg-muted/40 ${selected?.id === account.id ? 'border-primary bg-primary/5' : ''}`}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <div className="flex items-center gap-2 font-medium">
                            {account.name}
                            <Badge variant={account.type === 'organization' ? 'default' : 'secondary'}>{account.type}</Badge>
                          </div>
                          <div className="mt-1 font-mono text-xs text-muted-foreground">{account.id} · {account.slug}</div>
                        </div>
                        <div className="text-right text-xs text-muted-foreground">
                          <div>{account.counts?.machines ?? 0} machines</div>
                          <div>{fmtEur(Number(account.cost_summary?.total_eur_per_month ?? 0))}/mo</div>
                        </div>
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {selected ? (
          <div className="space-y-4">
            <AccountOverview account={selected} />
            <CostBreakdown cost={cost} loading={loadingCost} />
            {selected.type === 'organization' ? (
              <>
                <MembersCard account={selected} reload={load} />
                <InvitationsCard account={selected} reload={load} />
              </>
            ) : <PersonalAccountNotice account={selected} />}
          </div>
        ) : null}
      </div>
    </div>
  );
}

function CreateUserCard({ onCreate }: { onCreate: () => void }) {
  const { request, runAction, state } = useStore();
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');

  const submit = async () => {
    if (!email.trim()) return;
    await runAction(`create ${email.trim()} user`, async () => {
      await request('/admin/users', {
        method: 'POST',
        body: { email: email.trim(), name: name.trim() || undefined },
      });
      setEmail(''); setName('');
      onCreate();
    });
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2"><UserPlus className="size-4" /> Create user</CardTitle>
        <CardDescription>Mirrors V1 login setup: creating a user also creates their personal account and owner membership.</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-3 sm:grid-cols-[1fr_1fr_auto]">
        <div className="space-y-1.5"><Label>Email</Label><Input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="owner@example.com" /></div>
        <div className="space-y-1.5"><Label>Name</Label><Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Jane Doe" /></div>
        <Button className="sm:self-end" onClick={submit} disabled={state.busy || !email.trim()}>Create user</Button>
      </CardContent>
    </Card>
  );
}

function CreateAccountCard({ onCreate }: { onCreate: () => void }) {
  const { request, runAction, state } = useStore();
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [ownerEmail, setOwnerEmail] = useState('');
  const [billingEmail, setBillingEmail] = useState('');

  const submit = async () => {
    if (!name.trim() || !ownerEmail.trim()) return;
    await runAction(`create ${name.trim()} organization`, async () => {
      await request('/admin/accounts', {
        method: 'POST',
        body: {
          type: 'organization',
          name: name.trim(),
          slug: slug.trim() || undefined,
          owner_email: ownerEmail.trim() || undefined,
          billing_email: billingEmail.trim() || ownerEmail.trim() || undefined,
        },
      });
      setName(''); setSlug(''); setOwnerEmail(''); setBillingEmail('');
      onCreate();
    });
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2"><Plus className="size-4" /> Create organization</CardTitle>
        <CardDescription>V1 organizations always start from a real owner. Personal accounts come from the Create user flow above.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5"><Label>Name</Label><Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Acme GmbH" /></div>
          <div className="space-y-1.5"><Label>Slug</Label><Input value={slug} onChange={(e) => setSlug(e.target.value)} placeholder="auto" className="font-mono text-xs" /></div>
          <div className="space-y-1.5"><Label>Owner email</Label><Input value={ownerEmail} onChange={(e) => setOwnerEmail(e.target.value)} placeholder="owner@example.com" /></div>
          <div className="space-y-1.5 sm:col-span-2"><Label>Billing email</Label><Input value={billingEmail} onChange={(e) => setBillingEmail(e.target.value)} placeholder="billing@example.com" /></div>
        </div>
        <Button onClick={submit} disabled={state.busy || !name.trim() || !ownerEmail.trim()}>Create organization</Button>
      </CardContent>
    </Card>
  );
}

function PersonalAccountNotice({ account }: { account: Account }) {
  const owner = account.members.find((member) => member.role === 'owner') ?? account.members[0];
  return (
    <Card>
      <CardHeader>
        <CardTitle>Personal account</CardTitle>
        <CardDescription>Like V1, personal accounts are single-user workspaces. Create an organization to add members or send invitations.</CardDescription>
      </CardHeader>
      <CardContent className="rounded-lg border bg-muted/20 p-3 text-sm">
        Owner: <span className="font-medium">{owner?.name ?? owner?.email ?? '—'}</span>
      </CardContent>
    </Card>
  );
}

function AccountOverview({ account }: { account: Account }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{account.name}</CardTitle>
        <CardDescription className="font-mono">{account.id}</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-3 sm:grid-cols-4">
        <Stat label="Type" value={account.type} />
        <Stat label="Members" value={String(account.counts?.members ?? account.members.length)} />
        <Stat label="Machines" value={String(account.counts?.machines ?? 0)} />
        <Stat label="Auto-backups" value={`${account.counts?.auto_backup_enabled ?? 0}/${account.counts?.auto_backup_policies ?? 0}`} />
        <div className="sm:col-span-4 rounded-lg border bg-muted/20 p-3 text-xs text-muted-foreground">
          Billing email: <span className="text-foreground">{account.billing_email ?? '—'}</span> · Created {fmtDate(account.created_at)}
        </div>
      </CardContent>
    </Card>
  );
}

function CostBreakdown({ cost, loading }: { cost: AccountCostBreakdown | null; loading: boolean }) {
  if (!cost) {
    return (
      <Card>
        <CardHeader><CardTitle className="flex items-center gap-2"><Calculator className="size-4" /> Cost breakdown</CardTitle></CardHeader>
        <CardContent><p className="text-sm text-muted-foreground">{loading ? 'Loading cost breakdown…' : 'No cost data loaded.'}</p></CardContent>
      </Card>
    );
  }
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2"><Calculator className="size-4" /> Full cost breakdown</CardTitle>
        <CardDescription>Running vCPU/RAM plus GB disk storage for machines, backups, snapshots, templates, and warm pools.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-4">
          <Stat label="Projected total" value={`${fmtEur(cost.total_eur_per_month)}/mo`} />
          <Stat label="Machines" value={String(cost.machines.length)} />
          <Stat label="Backups" value={String(cost.artifacts.backups.length)} />
          <Stat label="Snapshots" value={String(cost.artifacts.snapshots.length)} />
        </div>
        <Table>
          <TableHeader><TableRow><TableHead>Component</TableHead><TableHead>Pricing key</TableHead><TableHead className="text-right">€/mo</TableHead></TableRow></TableHeader>
          <TableBody>
            {cost.components.map((component) => (
              <TableRow key={component.key}>
                <TableCell>{component.label}</TableCell>
                <TableCell className="font-mono text-xs text-muted-foreground">{component.pricing_key ?? '—'}</TableCell>
                <TableCell className="text-right font-medium">{fmtEur(component.eur_per_month)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        <div className="rounded-lg border bg-muted/20 p-3 text-xs text-muted-foreground">{cost.note}</div>
        {cost.artifacts.backups.length ? (
          <div className="space-y-2">
            <div className="text-sm font-medium">Backup storage</div>
            <div className="grid gap-2 sm:grid-cols-2">
              {cost.artifacts.backups.slice(0, 6).map((backup, index) => (
                <div key={`${backup.name}-${index}`} className="rounded-lg border p-2 text-xs">
                  <div className="font-mono text-foreground">{String(backup.name ?? 'backup')}</div>
                  <div className="text-muted-foreground">{formatBytes(Number(backup.metered_bytes ?? 0))} · {fmtEur(Number(backup.eur_per_month ?? 0))}/mo</div>
                </div>
              ))}
            </div>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

function MembersCard({ account, reload }: { account: Account; reload: () => Promise<void> }) {
  const { request, runAction, state } = useStore();
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [role, setRole] = useState<Role>('member');
  const add = async () => {
    if (!email.trim()) return;
    await runAction(`add ${email.trim()} to ${account.name}`, async () => {
      await request(`/admin/accounts/${encodeURIComponent(account.id)}/members`, { method: 'POST', body: { email: email.trim(), name: name.trim() || undefined, role } });
      setEmail(''); setName(''); setRole('member');
      await reload();
    });
  };
  return (
    <Card>
      <CardHeader><CardTitle className="flex items-center gap-2"><UserPlus className="size-4" /> Members</CardTitle><CardDescription>Roles mirror V1: owner, admin, member.</CardDescription></CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-2 md:grid-cols-[1fr_1fr_140px_auto]">
          <Input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="user@example.com" />
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Name (optional)" />
          <RoleSelect value={role} onChange={setRole} />
          <Button onClick={add} disabled={state.busy || !email.trim()}>Add</Button>
        </div>
        <Table>
          <TableHeader><TableRow><TableHead>User</TableHead><TableHead>Role</TableHead><TableHead className="text-right">Actions</TableHead></TableRow></TableHeader>
          <TableBody>
            {account.members.map((member) => (
              <TableRow key={member.id}>
                <TableCell><div className="font-medium">{member.name ?? member.email}</div><div className="font-mono text-xs text-muted-foreground">{member.email}</div></TableCell>
                <TableCell><Badge variant={member.role === 'owner' ? 'default' : 'secondary'}>{member.role}</Badge></TableCell>
                <TableCell className="space-x-1 text-right">
                  {(['owner', 'admin', 'member'] as Role[]).map((nextRole) => (
                    <Button key={nextRole} size="sm" variant="outline" disabled={member.role === nextRole || state.busy} onClick={() => runAction(`set ${member.email} ${nextRole}`, async () => { await request(`/admin/accounts/${account.id}/members/${member.id}`, { method: 'PATCH', body: { role: nextRole } }); await reload(); }).catch(() => undefined)}>{nextRole}</Button>
                  ))}
                  <Button size="sm" variant="ghost" disabled={state.busy} onClick={() => runAction(`remove ${member.email}`, async () => { await request(`/admin/accounts/${account.id}/members/${member.id}`, { method: 'DELETE' }); await reload(); }).catch(() => undefined)}><Trash2 className="size-3.5" /></Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

function InvitationsCard({ account, reload }: { account: Account; reload: () => Promise<void> }) {
  const { request, runAction, state, showResult } = useStore();
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<Role>('member');
  const invite = async () => {
    if (!email.trim()) return;
    await runAction(`invite ${email.trim()}`, async () => {
      const data = await request<{ invitation: { token?: string } & Record<string, unknown> }>(`/admin/accounts/${encodeURIComponent(account.id)}/invitations`, { method: 'POST', body: { email: email.trim(), role } });
      showResult('invitation token', data);
      setEmail(''); setRole('member');
      await reload();
      return data;
    });
  };
  return (
    <Card>
      <CardHeader><CardTitle className="flex items-center gap-2"><MailPlus className="size-4" /> Invitations</CardTitle><CardDescription>Create/revoke account invites. The token is shown once in the workflow result.</CardDescription></CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-2 md:grid-cols-[1fr_140px_auto]">
          <Input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="invitee@example.com" />
          <RoleSelect value={role} onChange={setRole} />
          <Button onClick={invite} disabled={state.busy || !email.trim()}>Invite</Button>
        </div>
        <Table>
          <TableHeader><TableRow><TableHead>Email</TableHead><TableHead>Role</TableHead><TableHead>Status</TableHead><TableHead className="text-right">Actions</TableHead></TableRow></TableHeader>
          <TableBody>
            {account.invitations.map((invitation) => {
              const status = invitation.revoked_at ? 'revoked' : invitation.accepted_at ? 'accepted' : 'pending';
              return (
                <TableRow key={invitation.id}>
                  <TableCell className="font-mono text-xs">{invitation.email}</TableCell>
                  <TableCell><Badge variant="secondary">{invitation.role}</Badge></TableCell>
                  <TableCell><Badge variant={status === 'pending' ? 'default' : 'outline'}>{status}</Badge><div className="text-xs text-muted-foreground">expires {fmtDate(invitation.expires_at)}</div></TableCell>
                  <TableCell className="text-right"><Button size="sm" variant="outline" disabled={state.busy || status !== 'pending'} onClick={() => runAction(`revoke invite ${invitation.email}`, async () => { await request(`/admin/accounts/${account.id}/invitations/${invitation.id}/revoke`, { method: 'PATCH' }); await reload(); }).catch(() => undefined)}>Revoke</Button></TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

function RoleSelect({ value, onChange }: { value: Role; onChange: (role: Role) => void }) {
  return (
    <Select value={value} onValueChange={(next) => onChange(next as Role)}>
      <SelectTrigger><Shield className="size-3.5" /><SelectValue /></SelectTrigger>
      <SelectContent><SelectItem value="owner">Owner</SelectItem><SelectItem value="admin">Admin</SelectItem><SelectItem value="member">Member</SelectItem></SelectContent>
    </Select>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border bg-muted/20 p-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-1 truncate text-sm font-semibold">{value}</div>
    </div>
  );
}
