import { useEffect, useMemo, useState } from 'react';
import { Dialog } from '../../components/ui/Dialog';
import { Button } from '../../components/ui/Button';
import { Input, Select } from '../../components/ui/Input';
import { Field } from '../../components/ui/Field';
import { Tag } from '../../components/ui/Tag';
import { Empty } from '../../components/ui/Empty';
import { useStore } from '../../lib/store';
import type { ImageItem, Machine, SnapshotItem } from '../../lib/api';
import { cx, randomSuffix, shortId } from '../../lib/utils';

type SourceType = 'image' | 'snapshot' | 'empty' | 'backup';

type ImageOption = {
  value: string;
  label: string;
  hint: string;
};

function imageOptions(images: ImageItem[]): ImageOption[] {
  const list: ImageOption[] = [];
  for (const image of images) {
    for (const alias of image.aliases ?? []) {
      list.push({
        value: alias.name,
        label: alias.name,
        hint: `${image.cluster?.id ?? '?'} · ${image.type ?? 'image'} · ${shortId(image.fingerprint, 14)}`,
      });
    }
    if (!image.aliases || image.aliases.length === 0) {
      list.push({
        value: image.fingerprint,
        label: shortId(image.fingerprint, 18),
        hint: `${image.cluster?.id ?? '?'} · fingerprint only`,
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

  useEffect(() => {
    if (!open || sourceType !== 'snapshot' || !snapshotMachineId) return;
    setSnapshotsLoading(true);
    setSnapshotList([]);
    setSnapshotId('');
    request<{ snapshots: SnapshotItem[] | unknown }>(`/machines/${encodeURIComponent(snapshotMachineId)}/snapshots`)
      .then((data) => setSnapshotList(Array.isArray(data.snapshots) ? (data.snapshots as SnapshotItem[]) : []))
      .catch(() => setSnapshotList([]))
      .finally(() => setSnapshotsLoading(false));
  }, [open, sourceType, snapshotMachineId, request]);

  const filteredImages = useMemo(() => {
    const all = imageOptions(state.images);
    const lower = imageQuery.trim().toLowerCase();
    return lower ? all.filter((opt) => `${opt.value} ${opt.label} ${opt.hint}`.toLowerCase().includes(lower)) : all;
  }, [imageQuery, state.images]);

  const machinesForSnapshot: Machine[] = useMemo(() => {
    return state.machines.filter((m) => {
      const r = m.cluster?.region ?? m.region;
      if (region && r && r !== region) return false;
      if (m.type && m.type !== type) return false;
      return true;
    });
  }, [region, state.machines, type]);

  function buildSource() {
    if (sourceType === 'image') return { type: 'image' as const, image_id: imageId.trim() };
    if (sourceType === 'snapshot') return { type: 'snapshot' as const, snapshot_id: snapshotId ? `${snapshotMachineId}/${snapshotId}` : '' };
    if (sourceType === 'backup') return { type: 'backup' as const, backup_id: '' };
    return { type: 'empty' as const };
  }

  const validation = useMemo(() => {
    const errors: string[] = [];
    if (!name.trim()) errors.push('Name is required.');
    if (!region.trim()) errors.push('Region is required.');
    if (sourceType === 'image' && !imageId.trim()) errors.push('Pick an image alias or fingerprint.');
    if (sourceType === 'snapshot') {
      if (!snapshotMachineId) errors.push('Pick the source machine for the snapshot.');
      if (!snapshotId) errors.push('Pick a snapshot from that machine.');
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
      onCreated(name.trim());
      onClose();
    } catch {
      // surfaced via runAction
    } finally {
      setSubmitting(false);
    }
  }

  const sourceTabs: Array<{ id: SourceType; label: string; sub?: string }> = [
    { id: 'image', label: 'Image' },
    { id: 'snapshot', label: 'Snapshot' },
    { id: 'empty', label: 'Empty' },
    { id: 'backup', label: 'Backup', sub: '501' },
  ];

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Create machine"
      description="POST /machines with the chosen source. Backup is locked until Incus backup import is wired."
      testId="v2-create-machine-modal"
      footer={
        <>
          <Button variant="ghost" onClick={onClose} id="create-cancel">
            Cancel
          </Button>
          <Button
            id="create-confirm"
            disabled={submitting || isBackup || validation.length > 0 || state.busy}
            onClick={() => submit()}
          >
            {submitting ? 'Creating…' : 'Create'}
          </Button>
        </>
      }
    >
      <div className="form-grid form-grid--2">
        <Field label="Name" htmlFor="create-name" span="full">
          <Input id="create-name" value={name} onChange={(event) => setName(event.target.value)} />
        </Field>
        <Field label="Region" htmlFor="create-region">
          <Select id="create-region" value={region} onChange={(event) => setRegion(event.target.value)}>
            {(state.regions.length ? state.regions : ['eu']).map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Type" htmlFor="create-type">
          <Select id="create-type" value={type} onChange={(event) => setType(event.target.value as 'container' | 'vm')}>
            <option value="container">container</option>
            <option value="vm">vm</option>
          </Select>
        </Field>
        <Field label="vCPU" htmlFor="create-vcpu">
          <Input id="create-vcpu" type="number" min={1} value={vcpu} onChange={(event) => setVcpu(Number(event.target.value) || 1)} />
        </Field>
        <Field label="Memory (GB)" htmlFor="create-memory">
          <Input id="create-memory" type="number" min={1} value={memoryGb} onChange={(event) => setMemoryGb(Number(event.target.value) || 1)} />
        </Field>
        <Field label="Disk (GB)" htmlFor="create-disk" span="full">
          <Input id="create-disk" type="number" min={1} value={diskGb} onChange={(event) => setDiskGb(Number(event.target.value) || 10)} />
        </Field>

        <div className="span-full">
          <div className="field-label" style={{ marginBottom: 6 }}>Source</div>
          <div className="segmented" role="tablist" aria-label="Source type">
            {sourceTabs.map((tab) => (
              <button
                key={tab.id}
                type="button"
                role="tab"
                aria-selected={sourceType === tab.id}
                className={cx(sourceType === tab.id && 'is-active')}
                data-source-tab={tab.id}
                onClick={() => setSourceType(tab.id)}
              >
                {tab.label}
                {tab.sub ? <Tag tone="ghost">{tab.sub}</Tag> : null}
              </button>
            ))}
          </div>
        </div>

        {sourceType === 'image' && (
          <div className="span-full form-grid">
            <Field label="Search catalog" htmlFor="create-image-search">
              <Input id="create-image-search" placeholder="Filter by alias / fingerprint / cluster" value={imageQuery} onChange={(event) => setImageQuery(event.target.value)} />
            </Field>
            <Field
              label="Image alias or fingerprint"
              htmlFor="create-source-id"
              help={
                filteredImages.length
                  ? `${filteredImages.length} alias${filteredImages.length === 1 ? '' : 'es'} available across configured clusters.`
                  : 'No images visible. Type the alias manually — Incus will resolve it on the cluster.'
              }
            >
              <Input id="create-source-id" list="create-image-options" placeholder="e.g. justavps-golden-container" value={imageId} onChange={(event) => setImageId(event.target.value)} />
              <datalist id="create-image-options">
                {filteredImages.map((option) => (
                  <option key={option.value} value={option.value} label={option.hint} />
                ))}
              </datalist>
            </Field>
            {filteredImages.length > 0 ? (
              <div className="table-wrap">
                <div className="table-scroll" style={{ maxHeight: 220 }}>
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
                        <tr
                          key={option.value}
                          className={cx('is-clickable', imageId === option.value && 'is-active')}
                          onClick={() => setImageId(option.value)}
                        >
                          <td className="mono">{option.label}</td>
                          <td><Tag tone="ghost">{option.hint}</Tag></td>
                          <td>
                            <Button
                              variant="secondary"
                              size="sm"
                              onClick={(event) => {
                                event.stopPropagation();
                                setImageId(option.value);
                              }}
                            >
                              Use
                            </Button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            ) : null}
          </div>
        )}

        {sourceType === 'snapshot' && (
          <div className="span-full form-grid form-grid--2">
            <Field label="Source machine" htmlFor="create-snapshot-machine" help="Snapshots clone from machines in the same Incus cluster + matching type.">
              <Select id="create-snapshot-machine" value={snapshotMachineId} onChange={(event) => setSnapshotMachineId(event.target.value)}>
                <option value="">Select a machine</option>
                {machinesForSnapshot.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name || m.id} · {m.type ?? 'container'}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Snapshot" htmlFor="create-snapshot-id">
              <Select id="create-snapshot-id" value={snapshotId} disabled={!snapshotMachineId || snapshotsLoading} onChange={(event) => setSnapshotId(event.target.value)}>
                <option value="">
                  {!snapshotMachineId
                    ? 'Pick a machine first'
                    : snapshotsLoading
                      ? 'Loading…'
                      : snapshotList.length === 0
                        ? 'No snapshots'
                        : 'Select a snapshot'}
                </option>
                {snapshotList.map((snap) => (
                  <option key={snap.name} value={snap.name}>
                    {snap.name}
                    {snap.created_at ? ` · ${snap.created_at}` : ''}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
        )}

        {sourceType === 'empty' && (
          <div className="span-full">
            <Empty title="No source" description="Creates an Incus instance with no rootfs source. Useful for VM ISO installs or empty containers." />
          </div>
        )}

        {sourceType === 'backup' && (
          <div className="span-full">
            <Empty
              title={<span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>Backup source <Tag tone="bad">blocked · 501</Tag></span>}
              description="Backup-source creation requires Incus backup import/export plumbing. The V2 API explicitly returns 501 Not Implemented until that flow is wired and approved."
            />
          </div>
        )}

        {validation.length > 0 ? (
          <div className="span-full">
            <Empty
              title={<span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>Fix before create <Tag tone="warn">{validation.length}</Tag></span>}
              description={
                <ul style={{ margin: '4px 0 0', paddingLeft: 18, color: 'var(--fg-muted)', fontSize: 12.5, textAlign: 'left' }}>
                  {validation.map((line) => (
                    <li key={line}>{line}</li>
                  ))}
                </ul>
              }
            />
          </div>
        ) : null}
      </div>
    </Dialog>
  );
}
