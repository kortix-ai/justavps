import { useCallback, useState } from 'react';
import { useStore } from '../../lib/store';
import { randomSuffix } from '../../lib/utils';

export const E2E_DEFAULT_IMAGE = 'justavps-golden-container';

export function useFullWorkflow() {
  const { state, request, runAction, refreshAll, setStatus, appendLog, pushToast, showResult, setBusy } = useStore();
  const [running, setRunning] = useState(false);

  const run = useCallback(async () => {
    if (!state.token) {
      pushToast('Admin token required for full workflow.', 'bad');
      return;
    }
    setRunning(true);
    setBusy(true);
    setStatus({ label: 'full workflow', tone: 'warn' });
    appendLog('full workflow start');

    const id = randomSuffix();
    const sourceName = `v2e2e-ui-${id}`;
    const cloneName = `v2e2e-ui-clone-${id}`;
    const emptyName = `v2e2e-ui-empty-${id}`;
    const snapName = `snap-ui-${id}`;
    const imageName = `img-ui-${id}`;
    const backupName = `backup-ui-${id}`;

    let machine = '';
    let clone = '';
    let empty = '';
    let createdImage = '';

    const region = state.regions[0] ?? 'eu';

    async function safeDelete(path: string, label: string) {
      try {
        await request(path, { method: 'DELETE' });
        appendLog(`${label} cleanup ok`);
      } catch (error) {
        appendLog(`${label} cleanup skipped: ${error instanceof Error ? error.message : String(error)}`);
      }
    }

    try {
      appendLog('workflow: refresh + sync vendor + sync cluster');
      await refreshAll();
      await request('/admin/vendors/hetzner/sync', { method: 'POST' });
      const cluster = state.clusters[0];
      if (cluster?.id) {
        await request(`/admin/clusters/${encodeURIComponent(cluster.id)}/sync`, { method: 'POST' });
      }
      await refreshAll();

      // unauthenticated /admin/clusters must 401
      await request('/admin/clusters', { auth: false, expectedStatus: 401 });

      // backup source must 501
      await request('/machines', {
        method: 'POST',
        expectedStatus: 501,
        body: {
          region,
          type: 'container',
          resources: { vcpu: 1, memory_gb: 1, disk_gb: 10 },
          source: { type: 'backup', backup_id: 'missing' },
        },
      });

      appendLog(`workflow: create source ${sourceName}`);
      const created = await request<{ machine?: { id?: string } }>('/machines', {
        method: 'POST',
        body: {
          region,
          type: 'container',
          name: sourceName,
          resources: { vcpu: 1, memory_gb: 1, disk_gb: 10 },
          source: { type: 'image', image_id: E2E_DEFAULT_IMAGE },
        },
      });
      if (!created.machine?.id) throw new Error('create did not return machine.id');
      machine = created.machine.id;

      await request(`/machines/${encodeURIComponent(machine)}`);
      await request(`/machines/${encodeURIComponent(machine)}/start`, { method: 'POST' });
      await request(`/machines/${encodeURIComponent(machine)}/stop`, { method: 'POST' });

      appendLog('workflow: snapshot + restore + image + clone + empty + backup');
      const snap = await request<{ snapshot?: { id?: string } }>(
        `/machines/${encodeURIComponent(machine)}/snapshots`,
        { method: 'POST', body: { name: snapName } },
      );
      const snapId = snap.snapshot?.id ?? `${machine}/${snapName}`;
      await request(`/machines/${encodeURIComponent(machine)}/snapshots`);
      await request(
        `/machines/${encodeURIComponent(machine)}/snapshots/${encodeURIComponent(snapName)}/restore`,
        { method: 'POST', body: {} },
      );

      const imageResponse = await request<{ image?: { id?: string } }>('/images', {
        method: 'POST',
        body: { machine_id: machine, snapshot_id: snapName, name: imageName },
      });
      createdImage = imageResponse.image?.id ?? imageName;

      const cloneResp = await request<{ machine?: { id?: string } }>('/machines', {
        method: 'POST',
        body: {
          region,
          type: 'container',
          name: cloneName,
          resources: { vcpu: 1, memory_gb: 1, disk_gb: 10 },
          source: { type: 'snapshot', snapshot_id: snapId },
        },
      });
      if (!cloneResp.machine?.id) throw new Error('clone create did not return machine.id');
      clone = cloneResp.machine.id;
      await request(`/machines/${encodeURIComponent(clone)}`);

      const emptyResp = await request<{ machine?: { id?: string } }>('/machines', {
        method: 'POST',
        body: {
          region,
          type: 'container',
          name: emptyName,
          resources: { vcpu: 1, memory_gb: 1, disk_gb: 10 },
          source: { type: 'empty' },
        },
      });
      if (!emptyResp.machine?.id) throw new Error('empty create did not return machine.id');
      empty = emptyResp.machine.id;
      await request(`/machines/${encodeURIComponent(empty)}`);

      await request(`/machines/${encodeURIComponent(machine)}/backups`, {
        method: 'POST',
        body: { name: backupName },
      });
      await request(`/machines/${encodeURIComponent(machine)}/backups`);
      await request(
        `/machines/${encodeURIComponent(machine)}/backups/${encodeURIComponent(backupName)}/restore`,
        { method: 'POST', body: {}, expectedStatus: 501 },
      );

      appendLog('workflow: cleanup');
      await safeDelete(`/machines/${encodeURIComponent(clone)}`, 'clone');
      clone = '';
      await safeDelete(`/machines/${encodeURIComponent(empty)}`, 'empty');
      empty = '';
      await safeDelete(`/images/${encodeURIComponent(createdImage)}`, 'image');
      createdImage = '';
      await safeDelete(
        `/machines/${encodeURIComponent(machine)}/backups/${encodeURIComponent(backupName)}`,
        'backup',
      );
      await safeDelete(
        `/machines/${encodeURIComponent(machine)}/snapshots/${encodeURIComponent(snapName)}`,
        'snapshot',
      );
      await safeDelete(`/machines/${encodeURIComponent(machine)}`, 'source');
      machine = '';

      await refreshAll();
      setStatus({ label: 'workflow ok', tone: 'ok' });
      appendLog('workflow passed and cleanup complete');
      showResult('full workflow', {
        ok: true,
        source: sourceName,
        clone: cloneName,
        empty: emptyName,
        snapshot: snapName,
        image: imageName,
        backup: backupName,
      });
      pushToast('Full E2E passed', 'ok');
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setStatus({ label: 'workflow failed', tone: 'bad' });
      appendLog(`workflow failed: ${message}`);
      pushToast(message, 'bad');
      showResult('workflow failed', { message });
    } finally {
      if (clone) await safeDelete(`/machines/${encodeURIComponent(clone)}`, 'clone');
      if (empty) await safeDelete(`/machines/${encodeURIComponent(empty)}`, 'empty');
      if (createdImage) await safeDelete(`/images/${encodeURIComponent(createdImage)}`, 'image');
      if (machine) {
        await safeDelete(
          `/machines/${encodeURIComponent(machine)}/backups/${encodeURIComponent(backupName)}`,
          'backup',
        );
        await safeDelete(
          `/machines/${encodeURIComponent(machine)}/snapshots/${encodeURIComponent(snapName)}`,
          'snapshot',
        );
        await safeDelete(`/machines/${encodeURIComponent(machine)}`, 'source');
      }
      setBusy(false);
      setRunning(false);
      // referenced for hooks happiness
      void runAction;
    }
  }, [
    appendLog,
    pushToast,
    refreshAll,
    request,
    runAction,
    setBusy,
    setStatus,
    showResult,
    state.clusters,
    state.regions,
    state.token,
  ]);

  return { run, running };
}
