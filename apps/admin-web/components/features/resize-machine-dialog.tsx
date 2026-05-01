'use client';

import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import type { Machine } from '@/lib/api';

type ResizeResources = { vcpu: number; memory_gb: number; disk_gb: number };

function resourceNumber(value: unknown, fallback: number) {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) return Math.ceil(value);
  if (typeof value === 'string') {
    const parsed = Number(value);
    if (Number.isFinite(parsed) && parsed > 0) return Math.ceil(parsed);
  }
  return fallback;
}

function integerOrError(label: string, value: number, min: number, max: number) {
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new Error(`${label} must be an integer between ${min} and ${max}.`);
  }
}

export function ResizeMachineDialog({
  open,
  onOpenChange,
  machine,
  busy,
  onResize,
}: {
  open: boolean;
  onOpenChange: (value: boolean) => void;
  machine: Machine | null;
  busy?: boolean;
  onResize: (resources: ResizeResources) => Promise<void>;
}) {
  const [vcpu, setVcpu] = useState(1);
  const [memoryGb, setMemoryGb] = useState(1);
  const [diskGb, setDiskGb] = useState(10);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open || !machine) return;
    setVcpu(resourceNumber(machine.resources?.vcpu, 1));
    setMemoryGb(resourceNumber(machine.resources?.memory_gb, 1));
    setDiskGb(resourceNumber(machine.resources?.disk_gb, 10));
    setError(null);
    setSubmitting(false);
  }, [machine, open]);

  const close = () => {
    setError(null);
    setSubmitting(false);
    onOpenChange(false);
  };

  const submit = async () => {
    if (!machine) return;
    setError(null);
    try {
      integerOrError('vCPU', vcpu, 1, 256);
      integerOrError('RAM', memoryGb, 1, 2048);
      integerOrError('Disk', diskGb, 1, 100_000);
      const currentDisk = resourceNumber(machine.resources?.disk_gb, 0);
      if (currentDisk > 0 && diskGb < currentDisk) {
        throw new Error(`Disk can only grow here (${currentDisk} GB current). Create a smaller machine and migrate data to shrink.`);
      }
      setSubmitting(true);
      await onResize({ vcpu, memory_gb: memoryGb, disk_gb: diskGb });
      close();
    } catch (submitError) {
      setSubmitting(false);
      setError(submitError instanceof Error ? submitError.message : String(submitError));
    }
  };

  return (
    <Dialog open={open} onOpenChange={(next) => (next ? onOpenChange(true) : close())}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Resize machine</DialogTitle>
          <DialogDescription>
            Change vCPU, RAM, and root disk for {machine?.name ?? 'this machine'}. CPU/RAM can move up or down; disk is grow-only.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4">
          <div className="grid grid-cols-3 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="resize-vcpu">vCPU</Label>
              <Input id="resize-vcpu" type="number" value={vcpu} onChange={(event) => setVcpu(Number(event.target.value) || 1)} min={1} max={256} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="resize-memory">RAM GB</Label>
              <Input id="resize-memory" type="number" value={memoryGb} onChange={(event) => setMemoryGb(Number(event.target.value) || 1)} min={1} max={2048} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="resize-disk">Disk GB</Label>
              <Input id="resize-disk" type="number" value={diskGb} onChange={(event) => setDiskGb(Number(event.target.value) || 1)} min={1} max={100000} />
            </div>
          </div>
          <div className="rounded-md border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
            Applies via Incus PATCH to <code className="rounded bg-muted px-1">limits.cpu</code>, <code className="rounded bg-muted px-1">limits.memory</code>, and the root disk size, then refreshes observed resources.
          </div>
          {error ? <div className="whitespace-pre-line rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">{error}</div> : null}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={close} disabled={submitting || busy}>Cancel</Button>
          <Button onClick={submit} disabled={submitting || busy || !machine}>{submitting || busy ? 'Resizing…' : 'Apply resize'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
