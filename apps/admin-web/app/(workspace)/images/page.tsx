'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useStore } from '@/lib/store';
import {
  Card, CardContent, CardDescription, CardHeader, CardTitle,
} from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { useConfirm } from '@/components/confirm';
import { toast } from 'sonner';
import { formatBytes } from '@/lib/utils';
import type { ImageItem } from '@/lib/api';
import {
  CATALOG_IMAGES,
  catalogForImage,
  imageAliases,
  imageClusterLabel,
  imageDisplayName,
  imageIdForCreate,
  imageTypeLabel,
} from '@/lib/image-sources';
import { Trash2, Plus, RefreshCw } from 'lucide-react';

type ImageClusterState = { id: string; cached: boolean; fingerprint: string | null; size: number | null };
type EnrichedCatalogImage = { id: string; clusters: ImageClusterState[] };

export default function ImagesPage() {
  const { state, request, runAction, refreshAll } = useStore();
  const { confirm } = useConfirm();
  const [enrichment, setEnrichment] = useState<Record<string, EnrichedCatalogImage>>({});
  const [liveImages, setLiveImages] = useState<ImageItem[]>([]);
  const [pullOpen, setPullOpen] = useState(false);

  // Fetch cluster cache state in the background. Never blocks render —
  // the static catalog is the source of truth for what's available.
  useEffect(() => {
    if (!state.baseUrl) return;
    let cancelled = false;
    async function tick() {
      try {
        const [templateData, imageData] = await Promise.all([
          request<{ templates: EnrichedCatalogImage[] }>('/templates'),
          request<{ images: ImageItem[] }>('/images', { auth: false }),
        ]);
        if (cancelled) return;
        const map: Record<string, EnrichedCatalogImage> = {};
        for (const t of templateData.templates) map[t.id] = t;
        setEnrichment(map);
        setLiveImages(imageData.images ?? []);
      } catch { /* surfaced via store */ }
    }
    tick();
    const id = setInterval(tick, 8000);
    return () => { cancelled = true; clearInterval(id); };
  }, [request, state.baseUrl, state.token]);

  const imageRows = (liveImages.length > 0 ? liveImages : state.images).filter((image) => !image.type || image.type === 'container');

  const extras = useMemo(() => {
    const catalogIds = new Set(CATALOG_IMAGES.map((t) => t.id));
    return imageRows.filter((i) => !((i.aliases ?? []).some((a) => catalogIds.has(a.name))));
  }, [imageRows]);

  async function purgeExtras() {
    if (!await confirm({
      title: `Clear ${extras.length} non-catalog image(s) from cluster cache?`,
      description: 'Sweeps every Incus cluster cache. Catalog images above are kept. Running instances are not affected.',
      confirmLabel: 'Clear cache',
      destructive: true,
    })) return;
    await runAction('clear cache extras', async () => {
      const r = await request<{ deleted: number; kept: number; errors: { message: string }[] }>('/templates/cache/extras', { method: 'DELETE' });
      await refreshAll();
      toast.success(`Cleared ${r.deleted} image(s)`);
      return r;
    });
  }

  return (
    <div className="space-y-6">
      <div className="flex items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Images</h1>
          <p className="text-sm text-muted-foreground">
            Simple launch images first. Incus aliases and fingerprints are tucked away under technical details.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="icon" onClick={() => refreshAll().catch(() => {})} title="Refresh">
            <RefreshCw className="size-4" />
          </Button>
          <Button onClick={() => setPullOpen(true)}>
            <Plus className="size-3.5" /> Pull image
          </Button>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        {imageRows.map((image) => {
          const catalog = catalogForImage(image);
          const aliases = imageAliases(image);
          const createId = imageIdForCreate(image);
          const e = catalog ? enrichment[catalog.id] : null;
          const description = catalog?.description || image.properties?.description || 'Cached Incus image.';
          const poolHref = `/pools?source=image&image_id=${encodeURIComponent(createId)}&type=container`;
          return (
            <Card key={`${image.cluster?.id ?? 'cluster'}-${image.fingerprint}`}>
              <CardHeader>
                <div className="flex items-start justify-between gap-2">
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <CardTitle className="text-base">{imageDisplayName(image)}</CardTitle>
                      {catalog ? <Badge variant="default" className="text-2xs">base</Badge> : <Badge variant="secondary" className="text-2xs">cached</Badge>}
                    </div>
                    <CardDescription className="text-xs">{description}</CardDescription>
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-1">
                    <Badge variant="outline" className="font-mono text-xs">{imageTypeLabel(image.type)}</Badge>
                    <Badge variant="outline" className="font-mono text-2xs">{imageClusterLabel(image)}</Badge>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                  {image.size != null ? <span className="font-mono">{formatBytes(Number(image.size))}</span> : null}
                  {image.uploaded_at ? <span>uploaded {new Date(image.uploaded_at).toLocaleString()}</span> : null}
                </div>
                <details className="rounded-md border bg-muted/20 px-3 py-2 text-xs">
                  <summary className="cursor-pointer select-none text-muted-foreground">Technical details</summary>
                  <div className="mt-2 space-y-2">
                    <code className="block truncate rounded bg-background px-2 py-1 text-2xs">launch id: {createId}</code>
                    <code className="block truncate rounded bg-background px-2 py-1 text-2xs">fingerprint: {image.fingerprint}</code>
                    {aliases.length > 0 ? (
                      <div className="flex flex-wrap gap-1.5">
                        {aliases.map((alias) => (
                          <Badge key={alias} variant={alias === createId ? 'default' : 'secondary'} className="font-mono text-2xs">{alias}</Badge>
                        ))}
                      </div>
                    ) : null}
                  </div>
                </details>
                {e && e.clusters.length > 0 ? (
                  <div className="flex flex-wrap items-center gap-1.5 text-xs">
                    <span className="text-muted-foreground">Base image cached on</span>
                    {e.clusters.map((c) => (
                      <Badge key={c.id} variant={c.cached ? 'default' : 'secondary'} className="font-mono text-2xs">
                        {c.id}{c.cached ? ' ✓' : ' ·'}
                      </Badge>
                    ))}
                  </div>
                ) : null}
                <div className="flex items-center justify-between gap-3 rounded-md border bg-muted/20 px-3 py-2">
                  <div>
                    <div className="text-xs font-medium">Pool</div>
                    <div className="text-2xs text-muted-foreground">Prime target N stopped slots for this source; standby is storage-only until claim.</div>
                  </div>
                  <Button asChild variant="outline" size="sm">
                    <Link href={poolHref}>Configure pool</Link>
                  </Button>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {imageRows.length === 0 ? (
        <div className="rounded-lg border border-dashed py-10 text-center text-sm text-muted-foreground">
          No cached images returned by the API yet.
        </div>
      ) : null}

      {extras.length > 0 ? (
        <div className="flex items-center justify-between gap-4 rounded-lg border bg-muted/30 p-4">
          <div>
            <p className="text-sm font-medium">{extras.length} extra cached image(s)</p>
            <p className="text-xs text-muted-foreground">
              They are shown above too. Clear only if you intentionally want to purge non-base cache extras; running instances keep their copy.
            </p>
          </div>
          <Button variant="outline" size="sm" onClick={purgeExtras} disabled={state.busy}>
            <Trash2 className="size-3.5" /> Clear cache
          </Button>
        </div>
      ) : null}

      <PullImageDialog
        open={pullOpen}
        onOpenChange={setPullOpen}
        clusters={state.clusters.map((c) => c.id)}
        request={request}
        runAction={runAction}
        refreshAll={refreshAll}
        busy={state.busy}
      />
    </div>
  );
}

function PullImageDialog({
  open, onOpenChange, clusters, request, runAction, refreshAll, busy,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  clusters: string[];
  request: ReturnType<typeof useStore>['request'];
  runAction: ReturnType<typeof useStore>['runAction'];
  refreshAll: ReturnType<typeof useStore>['refreshAll'];
  busy: boolean;
}) {
  const [source, setSource] = useState<'docker' | 'simplestreams'>('simplestreams');
  const [name, setName] = useState('');
  const [ref, setRef] = useState('ubuntu/24.04');
  const [server, setServer] = useState('');
  const [clusterId, setClusterId] = useState('');
  const [error, setError] = useState<string | null>(null);

  // Sensible default servers per source. User can override.
  const defaultServer = source === 'docker' ? 'https://docker.io' : 'https://images.linuxcontainers.org';
  const effectiveServer = server.trim() || defaultServer;
  const placeholder = source === 'docker' ? 'kortix/computer:dev-latest' : 'ubuntu/24.04';

  async function pull() {
    setError(null);
    if (!ref.trim()) return setError('Image reference required.');
    const body: Record<string, unknown> = {
      name: name.trim() || undefined,
      cluster_id: clusterId || undefined,
    };
    if (source === 'docker') body.docker = { ref: ref.trim(), server: effectiveServer };
    else body.simplestreams = { ref: ref.trim(), server: effectiveServer };

    try {
      await runAction(`pull ${ref}`, async () => {
        const r = await request('/images', { method: 'POST', body: body as never });
        await refreshAll();
        toast.success(`Pulled ${name || ref}`);
        onOpenChange(false);
        setName('');
        setRef('ubuntu/24.04');
        return r;
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Pull image</DialogTitle>
          <DialogDescription>
            Pull from a public registry into the cluster cache. Use a local alias so it appears in the New Machine image picker.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4">
          <div className="space-y-1.5">
            <Label>Source</Label>
            <Select value={source} onValueChange={(v) => setSource(v as 'docker' | 'simplestreams')}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="simplestreams">Simplestreams (linuxcontainers.org — Ubuntu, Debian, Alpine)</SelectItem>
                <SelectItem value="docker">Docker / OCI registry (Docker Hub, GHCR, etc.)</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="ref">Reference</Label>
            <Input id="ref" value={ref} onChange={(e) => setRef(e.target.value)} placeholder={placeholder} className="font-mono" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="server">Server (optional)</Label>
            <Input id="server" value={server} onChange={(e) => setServer(e.target.value)} placeholder={defaultServer} className="font-mono text-xs" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="alias">Local alias (optional)</Label>
            <Input id="alias" value={name} onChange={(e) => setName(e.target.value)} placeholder="auto-generated" className="font-mono text-xs" />
            <p className="text-2xs text-muted-foreground">What appears in the New Machine → Images picker.</p>
          </div>
          <div className="space-y-1.5">
            <Label>Cluster</Label>
            <Select value={clusterId || 'first-available'} onValueChange={(v) => setClusterId(v === 'first-available' ? '' : v)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="first-available">First available</SelectItem>
                {clusters.map((id) => <SelectItem key={id} value={id}>{id}</SelectItem>)}
              </SelectContent>
            </Select>
            <p className="text-2xs text-muted-foreground">Image imports are container-only.</p>
          </div>
          {error ? (
            <div className="whitespace-pre-line rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">{error}</div>
          ) : null}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={pull} disabled={busy || !ref.trim()}>Pull</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
