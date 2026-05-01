import MachineDetailClient from './MachineDetailClient';

// Required for `output: 'export'` to allow this dynamic route. We don't
// know machine IDs at build time, so we emit no static paths and rely on
// the v2-api SPA fallback (apps/v2-api/src/admin-ui-static.ts) to serve
// `out/index.html` for any /machines/<id>/ URL — Next's client router
// then resolves to MachineDetailClient.
// Single placeholder param so Next emits one shell HTML at
// `out/machines/__placeholder__/index.html`. Real navigation never lands
// there — the v2-api SPA fallback (apps/v2-api/src/admin-ui-static.ts)
// serves `out/index.html` for any /machines/<id>/ URL, and Next's client
// router then resolves to MachineDetailClient using the actual id from
// the URL.
export async function generateStaticParams(): Promise<{ id: string }[]> {
  return [{ id: '__placeholder__' }];
}

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <MachineDetailClient id={id} />;
}
