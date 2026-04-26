'use client';

import { Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useStore } from '@/lib/store';
import { PageHeader } from '@/components/ui/page-header';
import { Card, CardHeader } from '@/components/ui/card';
import { Tag } from '@/components/ui/tag';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Empty } from '@/components/ui/empty';
import { Status } from '@/components/ui/status';
import { CreateMachineDialog } from '@/components/features/create-machine-dialog';
import { MachineDetail } from '@/components/features/machine-detail';
import { cn, shortId, statusTone } from '@/lib/utils';
import { Plus, RefreshCw, Search, Trash2, Zap } from 'lucide-react';

function MachinesContent() {
  const { state, request, runAction, refreshAll, setSelectedMachineId } = useStore();
  const router = useRouter();
  const searchParams = useSearchParams();
  const idParam = searchParams.get('id');
  const [filter, setFilter] = useState('');
  const [createOpen, setCreateOpen] = useState(false);

  useEffect(() => {
    setSelectedMachineId(idParam || null);
  }, [idParam, setSelectedMachineId]);

  const selected = state.machines.find((m) => m.id === state.selectedMachineId) ?? null;

  const filtered = useMemo(() => {
    if (!filter.trim()) return state.machines;
    const lower = filter.trim().toLowerCase();
    return state.machines.filter((m) => `${m.name ?? ''} ${m.id} ${m.region ?? ''} ${m.status ?? ''} ${m.cluster?.region ?? ''}`.toLowerCase().includes(lower));
  }, [filter, state.machines]);

  const containerCount = state.machines.filter((m) => m.type === 'container').length;
  const vmCount = state.machines.filter((m) => m.type === 'vm').length;

  const selectMachine = useCallback((id: string) => {
    setSelectedMachineId(id);
    router.push(`/machines?id=${encodeURIComponent(id)}`);
  }, [router, setSelectedMachineId]);

  const closeDetail = useCallback(() => {
    setSelectedMachineId(null);
    router.push('/machines');
  }, [router, setSelectedMachineId]);

  async function cleanupTests() {
    await runAction('cleanup test resources', async () => {
      await refreshAll();
      const testMachines = state.machines.filter((m) => m.id.startsWith('v2e2e-') || (m.name ?? '').startsWith('v2e2e-'));
      const testImages = state.images.filter((image) => (image.aliases ?? []).some((alias) => alias.name.startsWith('img-ui-') || alias.name.startsWith('img-snap-')));
      let imagesDeleted = 0;
      for (const image of testImages) {
        const alias = image.aliases?.[0]?.name ?? image.fingerprint ?? image.id;
        try {
          await request(`/images/${encodeURIComponent(alias)}`, { method: 'DELETE' });
          imagesDeleted += 1;
        } catch {
          // ignore
        }
      }
      let machinesDeleted = 0;
      for (const m of testMachines) {
        try {
          await request(`/machines/${encodeURIComponent(m.id)}`, { method: 'DELETE' });
          machinesDeleted += 1;
        } catch {
          // ignore
        }
      }
      await refreshAll();
      return { machines_deleted: machinesDeleted, images_deleted: imagesDeleted };
    });
  }

  return (
    <section className="mx-auto flex w-full max-w-[1280px] flex-col gap-6 px-7 pb-10 pt-6" data-route="machines">
      <PageHeader
        title="Machines"
        description="Create, inspect, and manage Incus-backed machines across configured clusters."
        actions={
          <>
            <Button variant="secondary" leftIcon={<RefreshCw className="size-3.5" />} disabled={state.busy} onClick={() => refreshAll().catch(() => {})}>Refresh</Button>
            <Button variant="danger-ghost" leftIcon={<Trash2 className="size-3.5" />} disabled={state.busy} onClick={() => cleanupTests().catch(() => {})} id="cleanup-tests">Cleanup tests</Button>
            <Button leftIcon={<Plus className="size-3.5" />} disabled={state.busy} onClick={() => setCreateOpen(true)} id="open-create">Create machine</Button>
          </>
        }
      />

      <div className="grid grid-cols-4 gap-3.5 max-[1100px]:grid-cols-2 max-[720px]:grid-cols-1">
        <SummaryStat label="Total" value={state.machines.length} />
        <SummaryStat label="Containers" value={containerCount} />
        <SummaryStat label="VMs" value={vmCount} />
        <SummaryStat label="Running" value={state.machines.filter((m) => String(m.status ?? '').toLowerCase() === 'running').length} accent />
      </div>

      <Card>
        <CardHeader
          title="All machines"
          actions={
            <div className="w-[280px]">
              <Input id="machine-search" inputSize="sm" placeholder="Filter by name, id, region, status…" leftIcon={<Search className="size-3.5" />} value={filter} onChange={(event) => setFilter(event.target.value)} />
            </div>
          }
        />
        <div className="overflow-hidden rounded-[12px] border border-border bg-bg-1">
          <div className="overflow-auto">
            <table className="w-full min-w-[720px] border-collapse">
              <thead>
                <tr>
                  {['Name', 'Type', 'Status', 'Region', 'Member', 'Source', ''].map((h) => (
                    <th key={h} className="sticky top-0 bg-bg-1 px-3.5 py-2.5 text-left text-[11px] font-medium uppercase tracking-[0.06em] text-fg-muted">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody id="machines-tbody">
                {filtered.length === 0 ? (
                  <tr>
                    <td colSpan={7}>
                      <Empty
                        title={filter ? 'No machines match this filter' : 'No machines yet'}
                        description={filter ? 'Try a different search.' : 'Create a machine to populate this table.'}
                        action={!filter ? <Button leftIcon={<Zap className="size-3.5" />} onClick={() => setCreateOpen(true)}>Create machine</Button> : null}
                      />
                    </td>
                  </tr>
                ) : (
                  filtered.map((m) => {
                    const active = m.id === state.selectedMachineId;
                    return (
                      <tr
                        key={m.id}
                        className={cn('cursor-pointer border-b border-border last:border-0 hover:bg-bg-2', active && 'bg-surface-active')}
                        data-machine-id={m.id}
                        onClick={() => selectMachine(m.id)}
                      >
                        <td className="px-3.5 py-2.5">
                          <div className="font-medium">{m.name || m.id}</div>
                          <div className="font-mono text-[12px] text-fg-subtle">{shortId(m.id, 22)}</div>
                        </td>
                        <td className="px-3.5 py-2.5"><Tag tone={m.type === 'vm' ? 'violet' : 'ghost'}>{m.type ?? '?'}</Tag></td>
                        <td className="px-3.5 py-2.5"><Status tone={statusTone(m.status)} label={m.status} /></td>
                        <td className="px-3.5 py-2.5">{m.cluster?.region ?? m.region ?? '—'}</td>
                        <td className="px-3.5 py-2.5 font-mono text-fg-muted">{m.location ?? m.incus?.member_name ?? '—'}</td>
                        <td className="px-3.5 py-2.5"><span className="font-mono text-fg-muted">{(m.source as { type?: string } | undefined)?.type ?? '—'}</span></td>
                        <td className="px-3.5 py-2.5">
                          <div className="inline-flex" onClick={(event) => event.stopPropagation()}>
                            <Button variant="ghost" size="sm" onClick={(event) => { event.stopPropagation(); selectMachine(m.id); }}>Open</Button>
                          </div>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      </Card>

      {selected ? <MachineDetail machine={selected} onClose={closeDetail} /> : null}

      <CreateMachineDialog open={createOpen} onClose={() => setCreateOpen(false)} onCreated={(id) => { refreshAll().finally(() => selectMachine(id)); }} />
    </section>
  );
}

function SummaryStat({ label, value, accent }: { label: string; value: number; accent?: boolean }) {
  return (
    <div className="flex flex-col gap-1.5 rounded-[12px] border border-border bg-bg-1 p-4">
      <div className="flex items-center justify-between text-[12px] font-medium text-fg-muted">
        {label}
        {accent ? <Tag tone="ok">live</Tag> : null}
      </div>
      <div className="text-[26px] font-semibold leading-none tracking-[-0.04em]">{value}</div>
    </div>
  );
}

export default function MachinesPage() {
  return (
    <Suspense fallback={<div className="px-7 py-10 text-fg-muted">Loading…</div>}>
      <MachinesContent />
    </Suspense>
  );
}
