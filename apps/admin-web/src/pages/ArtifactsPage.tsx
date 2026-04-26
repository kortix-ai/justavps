import { EmptyState } from '../components/EmptyState';
import { useStore } from '../lib/store';
import { formatBytes, shortId } from '../lib/utils';

export function ArtifactsPage() {
  const { state, runAction, request, refreshAll } = useStore();

  async function deleteImage(id: string) {
    await runAction(`delete image ${id}`, async () => {
      const data = await request(`/images/${encodeURIComponent(id)}`, { method: 'DELETE' });
      await refreshAll();
      return data;
    });
  }

  return (
    <section className="page" data-route="artifacts">
      <div className="panel">
        <div className="panel-head">
          <h2>Images</h2>
          <span className="desc">/images</span>
        </div>
        <div className="scroll">
          <table className="table">
            <thead>
              <tr>
                <th>Aliases</th>
                <th>Type</th>
                <th>Public</th>
                <th>Size</th>
                <th>Cluster</th>
                <th>Fingerprint</th>
                <th></th>
              </tr>
            </thead>
            <tbody id="images-tbody">
              {state.images.length === 0 ? (
                <tr>
                  <td colSpan={7}>
                    <EmptyState>No images observed in any configured cluster.</EmptyState>
                  </td>
                </tr>
              ) : (
                state.images.map((image) => {
                  const aliases = (image.aliases ?? []).map((alias) => alias.name).join(', ') || image.fingerprint;
                  const deleteId = (image.aliases?.[0]?.name) ?? image.fingerprint ?? image.id;
                  return (
                    <tr key={image.fingerprint ?? image.id}>
                      <td>{aliases}</td>
                      <td>{image.type ?? '-'}</td>
                      <td>{image.public ? 'yes' : 'no'}</td>
                      <td>{formatBytes(image.size)}</td>
                      <td>{image.cluster?.id ?? '-'}</td>
                      <td>
                        <code>{shortId(image.fingerprint, 18)}</code>
                      </td>
                      <td>
                        <div className="row-actions">
                          <button
                            type="button"
                            className="button danger small"
                            disabled={state.busy}
                            onClick={() => deleteImage(deleteId).catch(() => {})}
                          >
                            delete
                          </button>
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
    </section>
  );
}
