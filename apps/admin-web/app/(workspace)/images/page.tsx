'use client';

import { useMemo, useState } from 'react';
import { useStore } from '@/lib/store';
import { PageHeader } from '@/components/ui/page-header';
import { Card, CardHeader } from '@/components/ui/card';
import { Tag } from '@/components/ui/tag';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Empty } from '@/components/ui/empty';
import { Segmented } from '@/components/ui/segmented';
import { Download, ImageIcon, RefreshCw, Search, Trash2 } from 'lucide-react';
import { formatBytes, shortId } from '@/lib/utils';
import { PullImageDialog } from '@/components/features/pull-image-dialog';

type SourceFilter = 'all' | 'docker' | 'incus';

export default function ImagesPage() {
  const { state, runAction, request, refreshAll } = useStore();
  const [filter, setFilter] = useState('');
  const [source, setSource] = useState<SourceFilter>('all');
  const [pullOpen, setPullOpen] = useState(false);

  const filtered = useMemo(() => {
    const lower = filter.trim().toLowerCase();
    return state.images.filter((image) => {
      const sourceKind = (image.properties ?? {})['justavps.source'];
      if (source === 'docker' && sourceKind !== 'docker') return false;
      if (source === 'incus' && sourceKind === 'docker') return false;
      if (!lower) return true;
      const aliases = (image.aliases ?? []).map((a) => a.name).join(' ');
      return `${aliases} ${image.fingerprint} ${image.cluster?.id ?? ''} ${image.type ?? ''}`.toLowerCase().includes(lower);
    });
  }, [filter, source, state.images]);

  async function deleteImage(id: string) {
    await runAction(`delete image ${id}`, async () => {
      const data = await request(`/images/${encodeURIComponent(id)}`, { method: 'DELETE' });
      await refreshAll();
      return data;
    });
  }

  const dockerImages = state.images.filter((image) => (image.properties ?? {})['justavps.source'] === 'docker').length;
  const publicCount = state.images.filter((i) => i.public).length;
  const totalBytes = state.images.reduce((acc, i) => acc + (typeof i.size === 'number' ? i.size : 0), 0);

  return (
    <section className="mx-auto flex w-full max-w-[1280px] flex-col gap-6 px-7 pb-10 pt-6" data-route="images">
      <PageHeader
        title="Images"
        description="The image catalog this workspace can launch machines from. Pull a Docker image once, then pick it from the source picker when creating a machine."
        actions={
          <>
            <Button variant="secondary" leftIcon={<RefreshCw className="size-3.5" />} disabled={state.busy} onClick={() => refreshAll().catch(() => {})}>
              Refresh
            </Button>
            <Button leftIcon={<Download className="size-3.5" />} disabled={state.busy} onClick={() => setPullOpen(true)} id="open-pull-image">
              Pull from registry
            </Button>
          </>
        }
      />

      {state.images.length === 0 ? (
        <Card>
          <div className="flex flex-col items-start gap-4 p-2 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-start gap-3">
              <div className="mt-0.5 flex size-9 items-center justify-center rounded-[10px] border border-border bg-bg-2">
                <Download className="size-4 text-fg-muted" />
              </div>
              <div>
                <div className="text-[15px] font-semibold tracking-tight">Pull your first Docker image</div>
                <div className="mt-0.5 text-[12.5px] text-fg-muted">
                  Native Incus OCI import — pin a tag (e.g. <code className="font-mono">ubuntu:22.04</code>). The pull happens on the
                  cluster you choose; the alias becomes selectable when creating a machine.
                </div>
              </div>
            </div>
            <Button leftIcon={<Download className="size-3.5" />} onClick={() => setPullOpen(true)} id="open-pull-image-hero">
              Pull from registry
            </Button>
          </div>
        </Card>
      ) : null}

      <div className="grid grid-cols-3 gap-3.5 max-[1100px]:grid-cols-2 max-[720px]:grid-cols-1">
        <div className="flex flex-col gap-1.5 rounded-[12px] border border-border bg-bg-1 p-4">
          <div className="text-[12px] font-medium text-fg-muted">Images</div>
          <div className="text-[26px] font-semibold leading-none tracking-[-0.04em]">{state.images.length}</div>
          <div className="text-[12px] text-fg-subtle">{dockerImages} from Docker · {state.images.length - dockerImages} from Incus</div>
        </div>
        <div className="flex flex-col gap-1.5 rounded-[12px] border border-border bg-bg-1 p-4">
          <div className="text-[12px] font-medium text-fg-muted">Visibility</div>
          <div className="text-[26px] font-semibold leading-none tracking-[-0.04em]">{publicCount}</div>
          <div className="text-[12px] text-fg-subtle">{publicCount} public · {state.images.length - publicCount} private</div>
        </div>
        <div className="flex flex-col gap-1.5 rounded-[12px] border border-border bg-bg-1 p-4">
          <div className="text-[12px] font-medium text-fg-muted">Total size</div>
          <div className="text-[26px] font-semibold leading-none tracking-[-0.04em]">{formatBytes(totalBytes)}</div>
          <div className="text-[12px] text-fg-subtle">approximate</div>
        </div>
      </div>

      <Card>
        <CardHeader
          title="Image catalog"
          desc="/images endpoint"
          actions={
            <div className="flex flex-wrap items-center gap-2">
              <Segmented<SourceFilter>
                value={source}
                onChange={(id) => setSource(id)}
                ariaLabel="Source filter"
                items={[
                  { id: 'all', label: 'All' },
                  { id: 'docker', label: 'Docker' },
                  { id: 'incus', label: 'Incus' },
                ]}
              />
              <div className="w-[260px]">
                <Input inputSize="sm" placeholder="Filter by alias, cluster, fingerprint…" leftIcon={<Search className="size-3.5" />} value={filter} onChange={(event) => setFilter(event.target.value)} />
              </div>
            </div>
          }
        />
        <div className="overflow-hidden rounded-[12px] border border-border bg-bg-1">
          <div className="overflow-auto">
            <table className="w-full min-w-[720px] border-collapse">
              <thead>
                <tr>
                  {['Aliases', 'Type', 'Visibility', 'Source', 'Size', 'Cluster', 'Fingerprint', ''].map((h) => (
                    <th key={h} className="sticky top-0 bg-bg-1 px-3.5 py-2.5 text-left text-[11px] font-medium uppercase tracking-[0.06em] text-fg-muted">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody id="images-tbody">
                {filtered.length === 0 ? (
                  <tr>
                    <td colSpan={8}>
                      {state.images.length === 0 ? (
                        <Empty
                          title={
                            <span className="inline-flex items-center gap-2">
                              <ImageIcon className="size-4 text-fg-muted" />
                              No images yet
                            </span>
                          }
                          description="Once you pull a Docker image (or publish one from a running machine), it shows up here and becomes selectable when creating a machine."
                          action={<Button leftIcon={<Download className="size-3.5" />} onClick={() => setPullOpen(true)}>Pull from registry</Button>}
                        />
                      ) : (
                        <Empty title={filter || source !== 'all' ? 'No images match' : 'No images'} description="Try a different filter, or remove it to see all images." />
                      )}
                    </td>
                  </tr>
                ) : filtered.map((image) => {
                  const aliases = (image.aliases ?? []).map((alias) => alias.name).join(', ') || '—';
                  const deleteId = image.aliases?.[0]?.name ?? image.fingerprint ?? image.id;
                  const dockerRef = (image.properties ?? {})['justavps.docker_ref'];
                  const sourceKind = (image.properties ?? {})['justavps.source'];
                  return (
                    <tr key={image.fingerprint ?? image.id} className="border-b border-border last:border-0">
                      <td className="px-3.5 py-2.5">
                        <div className="font-medium">{aliases}</div>
                      </td>
                      <td className="px-3.5 py-2.5"><Tag tone="ghost">{image.type ?? '—'}</Tag></td>
                      <td className="px-3.5 py-2.5">{image.public ? <Tag tone="info">public</Tag> : <Tag>private</Tag>}</td>
                      <td className="px-3.5 py-2.5">
                        {sourceKind === 'docker' ? (
                          <span className="inline-flex flex-col gap-0.5">
                            <Tag tone="violet">docker</Tag>
                            {dockerRef ? <span className="font-mono text-[11px] text-fg-subtle">{dockerRef}</span> : null}
                          </span>
                        ) : (
                          <Tag tone="ghost">incus</Tag>
                        )}
                      </td>
                      <td className="px-3.5 py-2.5 text-fg-muted">{formatBytes(image.size)}</td>
                      <td className="px-3.5 py-2.5 font-mono text-fg-muted">{image.cluster?.id ?? '—'}</td>
                      <td className="px-3.5 py-2.5"><code className="font-mono text-fg-muted">{shortId(image.fingerprint, 18)}</code></td>
                      <td className="px-3.5 py-2.5">
                        <Button variant="danger-ghost" size="sm" leftIcon={<Trash2 className="size-3.5" />} disabled={state.busy} onClick={() => deleteImage(deleteId).catch(() => {})}>
                          Delete
                        </Button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      </Card>

      <PullImageDialog open={pullOpen} onClose={() => setPullOpen(false)} onCreated={() => setPullOpen(false)} />
    </section>
  );
}
