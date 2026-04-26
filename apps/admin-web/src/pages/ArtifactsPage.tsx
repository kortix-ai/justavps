import { useMemo, useState } from 'react';
import { useStore } from '../lib/store';
import { PageHeader } from '../components/ui/PageHeader';
import { Card, CardHeader } from '../components/ui/Card';
import { Tag } from '../components/ui/Tag';
import { Button } from '../components/ui/Button';
import { Input } from '../components/ui/Input';
import { Empty } from '../components/ui/Empty';
import { IconRefresh, IconSearch, IconTrash } from '../components/ui/icons';
import { formatBytes, shortId } from '../lib/utils';

export function ArtifactsPage() {
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

  return (
    <section className="page" data-route="artifacts">
      <PageHeader
        title="Artifacts"
        description="Image catalog observed across all configured Incus clusters."
        actions={
          <Button variant="secondary" leftIcon={<IconRefresh />} disabled={state.busy} onClick={() => refreshAll().catch(() => {})}>
            Refresh
          </Button>
        }
      />

      <div className="card-grid card-grid--3">
        <div className="stat">
          <div className="stat-label">Images</div>
          <div className="stat-value">{state.images.length}</div>
          <div className="stat-meta">{publicCount} public · {state.images.length - publicCount} private</div>
        </div>
        <div className="stat">
          <div className="stat-label">Clusters covered</div>
          <div className="stat-value">{new Set(state.images.map((i) => i.cluster?.id).filter(Boolean)).size}</div>
          <div className="stat-meta">{state.clusters.length} configured</div>
        </div>
        <div className="stat">
          <div className="stat-label">Total size</div>
          <div className="stat-value">{formatBytes(state.images.reduce((acc, i) => acc + (typeof i.size === 'number' ? i.size : 0), 0))}</div>
          <div className="stat-meta">approximate</div>
        </div>
      </div>

      <Card>
        <CardHeader
          title="Image catalog"
          desc="/images endpoint"
          actions={
            <div className="search" style={{ width: 280 }}>
              <span className="search-icon"><IconSearch /></span>
              <Input inputSize="sm" placeholder="Filter by alias, cluster, fingerprint…" value={filter} onChange={(event) => setFilter(event.target.value)} />
            </div>
          }
        />
        <div className="table-wrap">
          <div className="table-scroll">
            <table className="table">
              <thead>
                <tr>
                  <th>Aliases</th>
                  <th>Type</th>
                  <th>Visibility</th>
                  <th>Size</th>
                  <th>Cluster</th>
                  <th>Fingerprint</th>
                  <th></th>
                </tr>
              </thead>
              <tbody id="images-tbody">
                {filtered.length === 0 ? (
                  <tr>
                    <td colSpan={7}>
                      <Empty title={filter ? 'No images match' : 'No images'} description={filter ? 'Try a different search.' : 'Once an image is published or pulled into a cluster it shows up here.'} />
                    </td>
                  </tr>
                ) : (
                  filtered.map((image) => {
                    const aliases = (image.aliases ?? []).map((alias) => alias.name).join(', ') || '—';
                    const deleteId = image.aliases?.[0]?.name ?? image.fingerprint ?? image.id;
                    return (
                      <tr key={image.fingerprint ?? image.id}>
                        <td className="cell-primary">{aliases}</td>
                        <td><Tag tone="ghost">{image.type ?? '—'}</Tag></td>
                        <td>{image.public ? <Tag tone="info">public</Tag> : <Tag>private</Tag>}</td>
                        <td className="text-muted">{formatBytes(image.size)}</td>
                        <td className="text-muted text-mono">{image.cluster?.id ?? '—'}</td>
                        <td><code className="mono text-muted">{shortId(image.fingerprint, 18)}</code></td>
                        <td>
                          <div className="cell-actions">
                            <Button variant="danger-ghost" size="sm" leftIcon={<IconTrash />} disabled={state.busy} onClick={() => deleteImage(deleteId).catch(() => {})}>
                              Delete
                            </Button>
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
    </section>
  );
}
