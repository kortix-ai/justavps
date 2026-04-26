import { useEffect, useMemo, useState } from 'react';
import { Modal } from '../../components/Modal';
import { useStore } from '../../lib/store';
import type { ImageItem, Machine, SnapshotItem } from '../../lib/api';
import { cx, randomSuffix } from '../../lib/utils';

type SourceType = 'image' | 'snapshot' | 'empty' | 'backup';

type ImageOption = {
  value: string;
  label: string;
  hint: string;
  region?: string;
  type?: string | null;
};

function imageOptions(images: ImageItem[]): ImageOption[] {
  const list: ImageOption[] = [];
  for (const image of images) {
    for (const alias of image.aliases ?? []) {
      list.push({
        value: alias.name,
        label: alias.name,
        hint: `${image.cluster?.id ?? '?'} · ${image.type ?? 'image'} · ${image.fingerprint?.slice(0, 12) ?? ''}`,
        region: image.cluster?.region,
        type: image.type ?? null,
      });
    }
    if (!image.aliases || image.aliases.length === 0) {
      list.push({
        value: image.fingerprint,
        label: image.fingerprint?.slice(0, 18) ?? image.id,
        hint: `${image.cluster?.id ?? '?'} · fingerprint only`,
        region: image.cluster?.region,
        type: image.type ?? null,
      });
    }
  }
  return list.sort((a, b) => a.label.localeCompare(b.label));
}

export type CreateMachineDialogProps = {
  open: boolean;
  onClose: () => void;
  onCreated: (id: string) => void;
};

export function CreateMachineDialog({ open, onClose, onCreated }: CreateMachineDialogProps) {
  const { state, request, runAction } = useStore();
  const [name, setName] = useState(`v2e2e-ui-${randomSuffix()}`);
  const [region, setRegion] = useState('eu');
  const [type, setType] = useState<'container' | 'vm'>('container');
  const [vcpu, setVcpu] = useState(1);
  const [memoryGb, setMemoryGb] = useState(1);
  const [diskGb, setDiskGb] = useState(10);
  const [sourceType, setSourceType] = useState<SourceType>('image');
  const [imageId, setImageId] = useState<string>('justavps-golden-container');
  const [imageQuery, setImageQuery] = useState('');
  const [snapshotMachineId, setSnapshotMachineId] = useState<string>('');
  const [snapshotId, setSnapshotId] = useState<string>('');
  const [snapshotList, setSnapshotList] = useState<SnapshotItem[]>([]);
  const [snapshotsLoading, setSnapshotsLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  // Reset state when opening/closing.
  useEffect(() => {
    if (!open) return;
    setName(`v2e2e-ui-${randomSuffix()}`);
    setSourceType('image');
    setSnapshotList([]);
    setSnapshotMachineId('');
    setSnapshotId('');
    setImageQuery('');
    if (state.regions.length && !state.regions.includes(region)) {
      setRegion(state.regions[0]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Load snapshots when a machine is selected on the snapshot tab.
  useEffect(() => {
    if (!open || sourceType !== 'snapshot' || !snapshotMachineId) return;
    setSnapshotsLoading(true);
    setSnapshotList([]);
    setSnapshotId('');
    request<{ snapshots: SnapshotItem[] | unknown }>(`/machines/${encodeURIComponent(snapshotMachineId)}/snapshots`)
      .then((data) => {
        const items = Array.isArray(data.snapshots) ? (data.snapshots as SnapshotItem[]) : [];
        setSnapshotList(items);
      })
      .catch(() => setSnapshotList([]))
      .finally(() => setSnapshotsLoading(false));
  }, [open, sourceType, snapshotMachineId, request]);

  // Default the source type to match current type (vm vs container).
  const filteredImages = useMemo(() => {
    const all = imageOptions(state.images);
    const lower = imageQuery.trim().toLowerCase();
    const filtered = lower
      ? all.filter((opt) => `${opt.value} ${opt.label} ${opt.hint}`.toLowerCase().includes(lower))
      : all;
    if (type === 'vm') return filtered;
    return filtered;
  }, [imageQuery, state.images, type]);

  const machinesForRegion: Machine[] = useMemo(() => {
    return state.machines.filter((m) => {
      const r = m.cluster?.region ?? m.region;
      if (region && r && r !== region) return false;
      if (m.type && m.type !== type) return false;
      return true;
    });
  }, [region, state.machines, type]);

  function buildSource(): { type: SourceType; image_id?: string; snapshot_id?: string; backup_id?: string } {
    if (sourceType === 'image') return { type: 'image', image_id: imageId.trim() };
    if (sourceType === 'snapshot') {
      const value = snapshotId
        ? `${snapshotMachineId}/${snapshotId}`
        : '';
      return { type: 'snapshot', snapshot_id: value };
    }
    if (sourceType === 'backup') return { type: 'backup', backup_id: '' };
    return { type: 'empty' };
  }

  const validation = useMemo(() => {
    const errors: string[] = [];
    if (!name.trim()) errors.push('Name is required.');
    if (!region.trim()) errors.push('Region is required.');
    if (sourceType === 'image' && !imageId.trim()) errors.push('Pick an image alias or fingerprint.');
    if (sourceType === 'snapshot') {
      if (!snapshotMachineId) errors.push('Pick the source machine for the snapshot.');
      if (!snapshotId) errors.push('Pick a snapshot from the source machine.');
    }
    return errors;
  }, [imageId, name, region, snapshotId, snapshotMachineId, sourceType]);

  const isBackup = sourceType === 'backup';

  async function submit() {
    setSubmitting(true);
    try {
      await runAction(`create machine ${name}`, async () => {
        const data = await request<{ machine?: { id?: string } }>('/machines', {
          method: 'POST',
          body: {
            region: region.trim(),
            type,
            name: name.trim(),
            resources: { vcpu, memory_gb: memoryGb, disk_gb: diskGb },
            source: buildSource(),
          },
        });
        if (!data.machine?.id) throw new Error('Create did not return a machine id');
        return data;
      });
      const id = name.trim();
      onCreated(id);
      onClose();
    } catch {
      // surfaced via runAction
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Create Machine"
      description="Calls POST /machines with the chosen source."
      testId="v2-create-machine-modal"
      footer={
        <>
          <button type="button" className="button ghost" onClick={onClose} id="create-cancel">
            Cancel
          </button>
          <button
            type="button"
            className="button"
            id="create-confirm"
            disabled={submitting || isBackup || validation.length > 0 || state.busy}
            onClick={() => submit()}
          >
            {submitting ? 'Creating…' : 'Create'}
          </button>
        </>
      }
    >
      <div className="form-grid cols-2">
        <div className="wide field">
          <label className="field-label" htmlFor="create-name">Name</label>
          <input id="create-name" className="input" value={name} onChange={(event) => setName(event.target.value)} />
          <div className="field-help">Use lowercase, digits, and dashes. Used as the Incus instance name.</div>
        </div>
        <div className="field">
          <label className="field-label" htmlFor="create-region">Region</label>
          <select
            id="create-region"
            className="input"
            value={region}
            onChange={(event) => setRegion(event.target.value)}
          >
            {(state.regions.length ? state.regions : ['eu']).map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label className="field-label" htmlFor="create-type">Type</label>
          <select
            id="create-type"
            className="input"
            value={type}
            onChange={(event) => setType(event.target.value as 'container' | 'vm')}
          >
            <option value="container">container</option>
            <option value="vm">vm</option>
          </select>
        </div>
        <div className="field">
          <label className="field-label" htmlFor="create-vcpu">vCPU</label>
          <input
            id="create-vcpu"
            className="input"
            type="number"
            min={1}
            value={vcpu}
            onChange={(event) => setVcpu(Number(event.target.value) || 1)}
          />
        </div>
        <div className="field">
          <label className="field-label" htmlFor="create-memory">Memory GB</label>
          <input
            id="create-memory"
            className="input"
            type="number"
            min={1}
            value={memoryGb}
            onChange={(event) => setMemoryGb(Number(event.target.value) || 1)}
          />
        </div>
        <div className="wide field">
          <label className="field-label" htmlFor="create-disk">Disk GB</label>
          <input
            id="create-disk"
            className="input"
            type="number"
            min={1}
            value={diskGb}
            onChange={(event) => setDiskGb(Number(event.target.value) || 10)}
          />
        </div>

        <div className="wide field">
          <label className="field-label">Source</label>
          <div className="tabs" role="tablist">
            {(['image', 'snapshot', 'empty', 'backup'] as SourceType[]).map((kind) => (
              <button
                key={kind}
                type="button"
                role="tab"
                aria-selected={sourceType === kind}
                className={cx(sourceType === kind && 'active', kind === 'backup' && 'disabled-tab')}
                data-source-tab={kind}
                onClick={() => setSourceType(kind)}
              >
                {kind === 'image' && 'Image'}
                {kind === 'snapshot' && 'Snapshot'}
                {kind === 'empty' && 'Empty'}
                {kind === 'backup' && 'Backup (501)'}
              </button>
            ))}
          </div>
        </div>

        {sourceType === 'image' && (
          <div className="wide form-grid">
            <div className="field">
              <label className="field-label" htmlFor="create-image-search">Search image catalog</label>
              <input
                id="create-image-search"
                className="input"
                placeholder="Type to filter aliases / fingerprints / clusters"
                value={imageQuery}
                onChange={(event) => setImageQuery(event.target.value)}
              />
            </div>
            <div className="field">
              <label className="field-label" htmlFor="create-source-id">Image alias or fingerprint</label>
              <input
                id="create-source-id"
                className="input"
                value={imageId}
                onChange={(event) => setImageId(event.target.value)}
                list="create-image-options"
                placeholder="e.g. justavps-golden-container"
              />
              <datalist id="create-image-options">
                {filteredImages.map((option) => (
                  <option key={option.value} value={option.value} label={option.hint} />
                ))}
              </datalist>
              {filteredImages.length === 0 ? (
                <div className="field-help">
                  No images found in /images. Type the alias manually — Incus will resolve it on the cluster.
                </div>
              ) : (
                <div className="field-help">
                  {filteredImages.length} image alias{filteredImages.length === 1 ? '' : 'es'} available across configured clusters.
                </div>
              )}
            </div>
            {filteredImages.length > 0 && (
              <div className="field">
                <label className="field-label">Pick from catalog</label>
                <div className="scroll" style={{ maxHeight: 220 }}>
                  <table className="table">
                    <thead>
                      <tr>
                        <th>Alias / fingerprint</th>
                        <th>Detail</th>
                        <th></th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredImages.slice(0, 80).map((option) => (
                        <tr key={option.value} className={cx('row-clickable', imageId === option.value && 'row-active')} onClick={() => setImageId(option.value)}>
                          <td><code>{option.label}</code></td>
                          <td><span className="badge">{option.hint}</span></td>
                          <td>
                            <button
                              type="button"
                              className="button small secondary"
                              onClick={(event) => {
                                event.stopPropagation();
                                setImageId(option.value);
                              }}
                            >
                              use
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        )}

        {sourceType === 'snapshot' && (
          <div className="wide form-grid cols-2">
            <div className="field">
              <label className="field-label" htmlFor="create-snapshot-machine">Source machine</label>
              <select
                id="create-snapshot-machine"
                className="input"
                value={snapshotMachineId}
                onChange={(event) => setSnapshotMachineId(event.target.value)}
              >
                <option value="">Select a machine in this region</option>
                {machinesForRegion.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name || m.id} · {m.type ?? 'container'}
                  </option>
                ))}
              </select>
              <div className="field-help">
                Snapshots can only be cloned from machines in the same Incus cluster and matching type.
              </div>
            </div>
            <div className="field">
              <label className="field-label" htmlFor="create-snapshot-id">Snapshot</label>
              <select
                id="create-snapshot-id"
                className="input"
                value={snapshotId}
                onChange={(event) => setSnapshotId(event.target.value)}
                disabled={!snapshotMachineId || snapshotsLoading}
              >
                <option value="">
                  {!snapshotMachineId
                    ? 'Pick a machine first'
                    : snapshotsLoading
                      ? 'Loading snapshots…'
                      : snapshotList.length === 0
                        ? 'No snapshots on this machine'
                        : 'Select a snapshot'}
                </option>
                {snapshotList.map((snap) => (
                  <option key={snap.name} value={snap.name}>
                    {snap.name}
                    {snap.created_at ? ` · ${snap.created_at}` : ''}
                  </option>
                ))}
              </select>
            </div>
          </div>
        )}

        {sourceType === 'empty' && (
          <div className="wide field">
            <div className="field-help">
              Creates an Incus instance with no source. Useful for VM ISO installs or container with empty rootfs.
            </div>
          </div>
        )}

        {sourceType === 'backup' && (
          <div className="wide field">
            <div className="badge bad" style={{ alignSelf: 'flex-start' }}>blocked · 501</div>
            <div className="field-help">
              Backup-source creation requires Incus backup import/export plumbing. The V2 API explicitly returns
              <code> 501 Not Implemented</code> for this path until a real import flow is wired and approved.
            </div>
          </div>
        )}

        {validation.length > 0 ? (
          <div className="wide field">
            <div className="badge warn" style={{ alignSelf: 'flex-start' }}>fix before create</div>
            <ul style={{ margin: '4px 0 0', paddingLeft: 18, color: 'var(--muted)', fontSize: 12 }}>
              {validation.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          </div>
        ) : null}
      </div>
    </Modal>
  );
}
