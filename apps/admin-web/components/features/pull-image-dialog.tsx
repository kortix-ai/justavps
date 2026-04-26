'use client';

import { useEffect, useMemo, useState } from 'react';
import { Dialog } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Field } from '@/components/ui/field';
import { Input, Select } from '@/components/ui/input';
import { Tag } from '@/components/ui/tag';
import { useStore } from '@/lib/store';
import { randomSuffix } from '@/lib/utils';

export function PullImageDialog({
  open,
  onClose,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: (alias: string) => void;
}) {
  const { state, request, runAction, refreshAll } = useStore();
  const [ref, setRef] = useState('ubuntu:22.04');
  const [server, setServer] = useState('https://docker.io');
  const [alias, setAlias] = useState(`oci-${randomSuffix()}`);
  const [region, setRegion] = useState('');
  const [makePublic, setMakePublic] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!open) return;
    setRef('ubuntu:22.04');
    setServer('https://docker.io');
    setAlias(`oci-${randomSuffix()}`);
    setMakePublic(false);
    if (state.regions.length && !state.regions.includes(region)) {
      setRegion(state.regions[0] ?? '');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const errors = useMemo(() => {
    const out: string[] = [];
    if (!ref.trim()) out.push('Image reference is required (e.g. ubuntu:22.04).');
    if (!ref.includes(':') && !ref.includes('@sha')) out.push('Reference must include a tag (e.g. :22.04) or digest. The implicit "latest" tag is not allowed.');
    if (ref.includes(':latest')) out.push('Tag "latest" is not allowed. Pin to a specific tag or digest.');
    if (!alias.trim()) out.push('Alias is required.');
    if (!/^[a-z0-9][a-z0-9_.:-]*$/.test(alias)) out.push('Alias must match [a-z0-9][a-z0-9_.:-]*.');
    return out;
  }, [alias, ref]);

  async function submit() {
    setSubmitting(true);
    try {
      await runAction(`pull image ${alias}`, async () => {
        const data = await request<{ image?: { id?: string; name?: string } }>('/images', {
          method: 'POST',
          body: {
            docker: { ref: ref.trim(), server: server.trim() || undefined },
            region: region.trim() || undefined,
            name: alias.trim(),
            public: makePublic,
          },
        });
        await refreshAll();
        return data;
      });
      onCreated(alias.trim());
      onClose();
    } catch {
      // surfaced via runAction
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Pull image from registry"
      description="Native Incus OCI import. Pulls a Docker/OCI image into the chosen cluster's image catalog so it can be selected when creating a machine."
      testId="v2-pull-image-modal"
      footer={
        <>
          <Button variant="ghost" onClick={onClose} id="pull-image-cancel">Cancel</Button>
          <Button id="pull-image-confirm" disabled={submitting || errors.length > 0 || state.busy} onClick={() => submit()}>
            {submitting ? 'Pulling…' : 'Pull image'}
          </Button>
        </>
      }
    >
      <div className="grid grid-cols-2 gap-3 max-[720px]:grid-cols-1">
        <Field label="Image" htmlFor="pull-image-ref" span="full" help="Must include either a tag (e.g. ubuntu:22.04) or a digest. The tag &quot;latest&quot; is not allowed.">
          <Input id="pull-image-ref" value={ref} onChange={(event) => setRef(event.target.value)} placeholder="ubuntu:22.04" />
        </Field>
        <Field label="Registry" htmlFor="pull-image-server">
          <Input id="pull-image-server" value={server} onChange={(event) => setServer(event.target.value)} placeholder="https://docker.io" />
        </Field>
        <Field label="Region" htmlFor="pull-image-region" help="The region where the image will be available. Defaults to the first configured cluster.">
          <Select id="pull-image-region" value={region} onChange={(event) => setRegion(event.target.value)}>
            <option value="">Default cluster</option>
            {state.regions.map((r) => (
              <option key={r} value={r}>{r}</option>
            ))}
          </Select>
        </Field>
        <Field label="Alias" htmlFor="pull-image-alias" span="full" help="The alias your CLI/SDK will reference when launching machines from this image.">
          <Input id="pull-image-alias" value={alias} onChange={(event) => setAlias(event.target.value)} />
        </Field>
        <Field span="full">
          <label className="inline-flex cursor-pointer items-center gap-2 text-[13px] text-fg-muted">
            <input id="pull-image-public" type="checkbox" checked={makePublic} onChange={(event) => setMakePublic(event.target.checked)} />
            Make image public in this cluster
          </label>
        </Field>
        {errors.length > 0 ? (
          <div className="col-span-full rounded-[10px] border border-amber-500/30 bg-amber-500/5 p-3">
            <div className="mb-1 inline-flex items-center gap-2 text-[12.5px] font-medium text-amber-300">
              Fix before pulling <Tag tone="warn">{errors.length}</Tag>
            </div>
            <ul className="m-0 list-disc pl-5 text-[12.5px] text-fg-muted">
              {errors.map((line) => <li key={line}>{line}</li>)}
            </ul>
          </div>
        ) : null}
        <div className="col-span-full text-[12px] text-fg-subtle">
          The pull happens server-side via the native Incus OCI import. The dialog stays open until Incus reports the image as ready.
        </div>
      </div>
    </Dialog>
  );
}
