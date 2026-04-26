'use client';

import { useMemo, useState } from 'react';
import { useStore } from '@/lib/store';
import { PageHeader } from '@/components/ui/page-header';
import { Card, CardHeader } from '@/components/ui/card';
import { Tag } from '@/components/ui/tag';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Empty } from '@/components/ui/empty';
import { RefreshCw, Search, Trash2 } from 'lucide-react';
import { formatBytes, shortId } from '@/lib/utils';

export default function ArtifactsPage() {
  const { state, runAction, request, refreshAll } = useStore();
  const [filter, setFilter] = useState('');

  const filtered = useMemo(() => {
    if (!filter.trim()) return state.images;
    const lower = filter.trim().toLowerCase();
    return state.images.filter((image) => {
      const aliases = (image.aliases ?? []).map((a) => a.name).join(' ');
      return `${aliases} ${image.fingerprint} ${image.cluster?.id ?? ''} ${image.type ?? ''}`.toLowerCase().includes(lower);
    });
  }, [filter, state.images]);

  async function deleteImage(id: string) {
    await runAction(`delete image ${id}`, async () => {
      const data = await request(`/images/${encodeURIComponent(id)}`, { method: 'DELETE' });
      await refreshAll();
      return data;
    });
  }

  const publicCount = state.images.filter((i) => i.public).length;
  const totalBytes = state.images.reduce((acc, i) => acc + (typeof i.size === 'number' ? i.size : 0), 0);

  return (
    <section className="mx-auto flex w-full max-w-[1280px] flex-col gap-6 px-7 pb-10 pt-6" data-route="artifacts">
      <PageHeader
        title="Artifacts"
        description="Image catalog observed across all configured Incus clusters."
        actions={
          <Button variant="secondary" leftIcon={<RefreshCw className="size-3.5" />} disabled={state.busy} onClick={() => refreshAll().catch(() => {})}>
            Refresh
          </Button>
        }
      />

      <div className="grid grid-cols-3 gap-3.5 max-[1100px]:grid-cols-2 max-[720px]:grid-cols-1">
        <div className="flex flex-col gap-1.5 rounded-[12px] border border-border bg-bg-1 p-4">
          <div className="text-[12px] font-medium text-fg-muted">Images</div>
          <div className="text-[26px] font-semibold leading-none tracking-[-0.04em]">{state.images.length}</div>
          <div className="text-[12px] text-fg-subtle">{publicCount} public · {state.images.length - publicCount} private</div>
        </div>
        <div className="flex flex-col gap-1.5 rounded-[12px] border border-border bg-bg-1 p-4">
          <div className="text-[12px] font-medium text-fg-muted">Clusters covered</div>
          <div className="text-[26px] font-semibold leading-none tracking-[-0.04em]">{new Set(state.images.map((i) => i.cluster?.id).filter(Boolean)).size}</div>
          <div className="text-[12px] text-fg-subtle">{state.clusters.length} configured</div>
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
            <div className="w-[280px]">
              <Input inputSize="sm" placeholder="Filter by alias, cluster, fingerprint…" leftIcon={<Search className="size-3.5" />} value={filter} onChange={(event) => setFilter(event.target.value)} />
            </div>
          }
        />
        <div className="overflow-hidden rounded-[12px] border border-border bg-bg-1">
          <div className="overflow-auto">
            <table className="w-full min-w-[720px] border-collapse">
              <thead>
                <tr>
                  {['Aliases', 'Type', 'Visibility', 'Size', 'Cluster', 'Fingerprint', ''].map((h) => (
                    <th key={h} className="sticky top-0 bg-bg-1 px-3.5 py-2.5 text-left text-[11px] font-medium uppercase tracking-[0.06em] text-fg-muted">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody id="images-tbody">
                {filtered.length === 0 ? (
                  <tr>
                    <td colSpan={7}>
                      <Empty title={filter ? 'No images match' : 'No images'} description={filter ? 'Try a different search.' : 'Once an image is published or pulled into a cluster it shows up here.'} />
                    </td>
                  </tr>
                ) : filtered.map((image) => {
                  const aliases = (image.aliases ?? []).map((alias) => alias.name).join(', ') || '—';
                  const deleteId = image.aliases?.[0]?.name ?? image.fingerprint ?? image.id;
                  return (
                    <tr key={image.fingerprint ?? image.id} className="border-b border-border last:border-0">
                      <td className="px-3.5 py-2.5 font-medium">{aliases}</td>
                      <td className="px-3.5 py-2.5"><Tag tone="ghost">{image.type ?? '—'}</Tag></td>
                      <td className="px-3.5 py-2.5">{image.public ? <Tag tone="info">public</Tag> : <Tag>private</Tag>}</td>
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
    </section>
  );
}
