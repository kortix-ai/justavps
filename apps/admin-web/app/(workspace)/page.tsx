'use client';

import Link from 'next/link';
import { useStore } from '@/lib/store';
import { PageHeader } from '@/components/ui/page-header';
import { Stat } from '@/components/ui/stat';
import { Card, CardHeader } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Tag } from '@/components/ui/tag';
import { Status } from '@/components/ui/status';
import { ArrowRight, Boxes, Download, KeyRound, Plus } from 'lucide-react';
import { shortId, statusTone } from '@/lib/utils';

export default function OverviewPage() {
  const { state } = useStore();

  const runningMachines = state.machines.filter((m) => String(m.status ?? '').toLowerCase() === 'running').length;
  const stoppedMachines = state.machines.filter((m) => String(m.status ?? '').toLowerCase() === 'stopped').length;
  const dockerImages = state.images.filter((image) => (image.properties ?? {})['justavps.source'] === 'docker').length;
  const recentMachines = state.machines.slice(0, 5);
  const recent = state.workflowLog.slice(0, 8);

  return (
    <section className="mx-auto flex w-full max-w-[1280px] flex-col gap-6 px-7 pb-10 pt-6" data-route="dashboard">
      <PageHeader
        title="Overview"
        description="Spin up Incus-backed machines, pull Docker images, and watch live state across your regions."
        actions={
          <>
            <Link href="/images" className="contents">
              <Button variant="secondary" leftIcon={<Download className="size-3.5" />}>Pull image</Button>
            </Link>
            <Link href="/machines" className="contents">
              <Button leftIcon={<Plus className="size-3.5" />}>Create machine</Button>
            </Link>
          </>
        }
      />

      <div className="grid grid-cols-4 gap-3.5 max-[1100px]:grid-cols-2 max-[720px]:grid-cols-1">
        <Stat label="Machines" value={String(state.machines.length)} meta={`${runningMachines} running · ${stoppedMachines} stopped`} />
        <Stat label="Images" value={String(state.images.length)} meta={`${dockerImages} from Docker · ${state.images.length - dockerImages} from Incus`} />
        <Stat label="Regions" value={String(state.regions.length)} meta={state.regions.join(', ') || 'no regions configured'} />
        <Stat label="Health" value={state.health?.status ?? '—'} meta={state.health?.service ?? 'awaiting first refresh'} />
      </div>

      <div className="grid grid-cols-3 gap-3.5 max-[1100px]:grid-cols-1">
        <div className="col-span-2 max-[1100px]:col-span-1">
          <Card>
            <CardHeader
              title="Recent machines"
              desc="Newest first"
              actions={
                <Link href="/machines" className="contents">
                  <Button variant="ghost" size="sm" rightIcon={<ArrowRight className="size-3.5" />}>All machines</Button>
                </Link>
              }
            />
            {recentMachines.length === 0 ? (
              <div className="rounded-[12px] border border-dashed border-border-strong bg-bg-1 p-10 text-center">
                <div className="mx-auto mb-3 flex size-10 items-center justify-center rounded-[10px] border border-border bg-bg-2">
                  <Boxes className="size-4 text-fg-muted" />
                </div>
                <div className="text-[14px] font-medium text-fg">No machines yet</div>
                <div className="mt-1 text-[12.5px] text-fg-muted">Pull a Docker image and spin one up in seconds.</div>
                <div className="mt-3 inline-flex gap-2">
                  <Link href="/images" className="contents">
                    <Button variant="secondary" size="sm" leftIcon={<Download className="size-3.5" />}>Pull image</Button>
                  </Link>
                  <Link href="/machines" className="contents">
                    <Button size="sm" leftIcon={<Plus className="size-3.5" />}>Create machine</Button>
                  </Link>
                </div>
              </div>
            ) : (
              <div className="overflow-hidden rounded-[12px] border border-border bg-bg-1">
                <div className="overflow-auto">
                  <table className="w-full min-w-[640px] border-collapse">
                    <thead>
                      <tr>
                        {['Name', 'Type', 'Status', 'Region', ''].map((h) => (
                          <th key={h} className="sticky top-0 bg-bg-1 px-3.5 py-2.5 text-left text-[11px] font-medium uppercase tracking-[0.06em] text-fg-muted">{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {recentMachines.map((m) => (
                        <tr key={m.id} className="border-b border-border last:border-0 hover:bg-bg-2">
                          <td className="px-3.5 py-2.5">
                            <Link href={`/machines?id=${encodeURIComponent(m.id)}`}>
                              <span className="block font-medium hover:underline">{m.name || m.id}</span>
                              <span className="block font-mono text-[12px] text-fg-subtle">{shortId(m.id, 22)}</span>
                            </Link>
                          </td>
                          <td className="px-3.5 py-2.5"><Tag tone={m.type === 'vm' ? 'violet' : 'ghost'}>{m.type ?? '?'}</Tag></td>
                          <td className="px-3.5 py-2.5"><Status tone={statusTone(m.status)} label={m.status} /></td>
                          <td className="px-3.5 py-2.5 text-fg-muted">{m.cluster?.region ?? m.region ?? '—'}</td>
                          <td className="px-3.5 py-2.5 text-right">
                            <Link href={`/machines?id=${encodeURIComponent(m.id)}`} className="contents">
                              <Button variant="ghost" size="sm" rightIcon={<ArrowRight className="size-3.5" />}>Open</Button>
                            </Link>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </Card>
        </div>

        <Card>
          <CardHeader title="Quick start" desc="Common developer flows" />
          <Link href="/images" className="group flex items-center justify-between gap-3 rounded-[10px] border border-border bg-bg p-3 transition-colors hover:border-border-focus hover:bg-bg-2">
            <div>
              <div className="flex items-center gap-2 text-[13px] font-medium">
                <Download className="size-3.5 text-fg-muted" />
                Pull a Docker image
              </div>
              <div className="text-[12px] text-fg-muted">Native Incus OCI import — pin a tag (e.g. <code className="font-mono">ubuntu:22.04</code>).</div>
            </div>
            <ArrowRight className="size-3.5 shrink-0 text-fg-muted opacity-0 transition-opacity group-hover:opacity-100" />
          </Link>
          <Link href="/machines" className="group flex items-center justify-between gap-3 rounded-[10px] border border-border bg-bg p-3 transition-colors hover:border-border-focus hover:bg-bg-2">
            <div>
              <div className="flex items-center gap-2 text-[13px] font-medium">
                <Boxes className="size-3.5 text-fg-muted" />
                Create a machine
              </div>
              <div className="text-[12px] text-fg-muted">Choose an image, region, and resources.</div>
            </div>
            <ArrowRight className="size-3.5 shrink-0 text-fg-muted opacity-0 transition-opacity group-hover:opacity-100" />
          </Link>
          <Link href="/settings" className="group flex items-center justify-between gap-3 rounded-[10px] border border-border bg-bg p-3 transition-colors hover:border-border-focus hover:bg-bg-2">
            <div>
              <div className="flex items-center gap-2 text-[13px] font-medium">
                <KeyRound className="size-3.5 text-fg-muted" />
                Set your admin token
              </div>
              <div className="text-[12px] text-fg-muted">Required for every mutating call. Stored locally only.</div>
            </div>
            <ArrowRight className="size-3.5 shrink-0 text-fg-muted opacity-0 transition-opacity group-hover:opacity-100" />
          </Link>
        </Card>
      </div>

      <Card>
        <CardHeader title="Recent activity" desc="Newest first" />
        <pre
          id="workflow-log"
          data-testid="v2-workflow-log"
          className="max-h-[280px] overflow-auto whitespace-pre-wrap rounded-[8px] border border-border bg-bg p-3 font-mono text-[12px] leading-relaxed text-zinc-300"
        >
{recent.length === 0 ? '— No activity yet. Refresh to populate.' : recent.map((entry) => `${entry.ts}  ${entry.text}`).join('\n')}
        </pre>
      </Card>
    </section>
  );
}
