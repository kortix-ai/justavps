import type { ReactNode } from 'react';
import { Sidebar } from './sidebar';
import { Topbar } from './topbar';
import type { Scope } from './scope';

export function AppShell({ scope, children }: { scope: Scope; children: ReactNode }) {
  return (
    <div className="grid min-h-screen grid-cols-[240px_minmax(0,1fr)] bg-bg max-[880px]:grid-cols-[1fr]">
      <Sidebar scope={scope} />
      <main className="flex min-w-0 flex-col">
        <Topbar scope={scope} />
        {children}
        <div className="px-6 py-7 text-center text-[12px] text-fg-subtle">
          Standalone admin served by <code className="font-mono">apps/v2-api</code> · UI in <code className="font-mono">apps/admin-web</code>
        </div>
      </main>
    </div>
  );
}
